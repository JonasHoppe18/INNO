// One-time backfill: import existing sent replies into agent_knowledge as training examples.
// POST { shop_id, workspace_id?, batch_size?, dry_run? }
import { createClient } from "jsr:@supabase/supabase-js@2";

const PROJECT_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL");
const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const OPENAI_EMBEDDING_MODEL =
  Deno.env.get("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small";

const supabase =
  PROJECT_URL && SERVICE_ROLE_KEY ? createClient(PROJECT_URL, SERVICE_ROLE_KEY) : null;

async function createEmbedding(input: string): Promise<number[] | null> {
  const trimmed = String(input || "").trim();
  if (!trimmed || !OPENAI_API_KEY) return null;
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: OPENAI_EMBEDDING_MODEL, input: trimmed.slice(0, 4000) }),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    console.warn("backfill: embedding failed", payload?.error?.message ?? res.status);
    return null;
  }
  const embedding = payload?.data?.[0]?.embedding;
  return Array.isArray(embedding) ? embedding : null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!supabase) {
    return new Response("Server misconfigured", { status: 500 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const shopId = String(body.shop_id || "").trim();
  const workspaceId = String(body.workspace_id || "").trim() || null;
  const batchSize = Math.min(Number(body.batch_size) || 50, 100);
  const dryRun = Boolean(body.dry_run);

  if (!shopId) {
    return new Response("Missing shop_id", { status: 400 });
  }

  // Find mailbox IDs for this shop
  const { data: mailboxes, error: mbError } = await supabase
    .from("mail_accounts")
    .select("id")
    .eq("shop_id", shopId);

  if (mbError) {
    return new Response(JSON.stringify({ ok: false, error: mbError.message }), { status: 500 });
  }

  if (!mailboxes?.length) {
    return new Response(JSON.stringify({ ok: true, processed: 0, message: "No mailboxes found" }), { status: 200 });
  }

  const mailboxIds = mailboxes.map((m) => m.id);

  // Find threads belonging to those mailboxes
  const { data: threads, error: threadError } = await supabase
    .from("mail_threads")
    .select("id, subject")
    .in("mailbox_id", mailboxIds)
    .limit(500);

  if (threadError) {
    return new Response(JSON.stringify({ ok: false, error: threadError.message }), { status: 500 });
  }

  if (!threads?.length) {
    return new Response(JSON.stringify({ ok: true, processed: 0, message: "No threads found" }), { status: 200 });
  }

  const threadIds = threads.map((t) => t.id);
  const subjectByThread: Record<string, string> = {};
  for (const t of threads) {
    subjectByThread[t.id] = t.subject || "";
  }

  // Get already-backfilled thread IDs to skip
  const { data: existingKnowledge } = await supabase
    .from("agent_knowledge")
    .select("metadata")
    .eq("shop_id", shopId)
    .eq("source_type", "ticket")
    .eq("source_provider", "sent_reply");

  const alreadyStoredThreadIds = new Set<string>(
    (existingKnowledge ?? [])
      .map((k) => (k.metadata as Record<string, string> | null)?.thread_id)
      .filter(Boolean) as string[]
  );

  // Fetch messages in chunks to avoid URL length limits
  const CHUNK = 40;
  const allMessages: Array<{
    id: string; thread_id: string; clean_body_text: string | null;
    body_text: string | null; snippet: string | null;
    from_me: boolean; received_at: string | null; created_at: string | null;
  }> = [];

  for (let i = 0; i < threadIds.length; i += CHUNK) {
    const chunk = threadIds.slice(i, i + CHUNK);
    const { data: chunkMessages, error: msgError } = await supabase
      .from("mail_messages")
      .select("id, thread_id, clean_body_text, body_text, snippet, from_me, received_at, created_at")
      .in("thread_id", chunk)
      .eq("is_draft", false)
      .order("received_at", { ascending: true });

    if (msgError) {
      return new Response(JSON.stringify({ ok: false, error: msgError.message }), { status: 500 });
    }
    if (chunkMessages) allMessages.push(...chunkMessages);
  }

  const messages = allMessages;

  // Group messages by thread and pair inbound with the first sent reply
  const messagesByThread: Record<string, typeof messages> = {};
  for (const msg of messages ?? []) {
    if (!messagesByThread[msg.thread_id]) messagesByThread[msg.thread_id] = [];
    messagesByThread[msg.thread_id].push(msg);
  }

  type Pair = { threadId: string; subject: string; customerText: string; agentText: string };
  const pairs: Pair[] = [];

  for (const [threadId, msgs] of Object.entries(messagesByThread)) {
    if (alreadyStoredThreadIds.has(threadId)) continue;

    const inbound = msgs!.filter((m) => !m.from_me);
    const outbound = msgs!.filter((m) => m.from_me);

    if (!inbound.length || !outbound.length) continue;

    const firstOutbound = outbound[0];
    const firstOutboundTime = new Date(firstOutbound.received_at || firstOutbound.created_at || 0).getTime();

    // Last inbound message before the first outbound reply
    const relevantInbound = inbound.filter((m) => {
      const t = new Date(m.received_at || m.created_at || 0).getTime();
      return t <= firstOutboundTime;
    });

    const customerMsg = relevantInbound[relevantInbound.length - 1] ?? inbound[0];
    const customerText = (customerMsg.clean_body_text || customerMsg.body_text || customerMsg.snippet || "").trim();
    const agentText = (firstOutbound.clean_body_text || firstOutbound.body_text || firstOutbound.snippet || "").trim();

    if (!customerText || !agentText) continue;

    pairs.push({
      threadId,
      subject: subjectByThread[threadId] || "",
      customerText: customerText.slice(0, 2000),
      agentText: agentText.slice(0, 2000),
    });

    if (pairs.length >= batchSize) break;
  }

  if (dryRun) {
    return new Response(
      JSON.stringify({
        ok: true,
        dry_run: true,
        would_process: pairs.length,
        already_stored: alreadyStoredThreadIds.size,
        total_threads: threads.length,
      }),
      { status: 200 }
    );
  }

  let processed = 0;
  let failed = 0;

  for (const pair of pairs) {
    const embedding = await createEmbedding(pair.customerText);
    const content = `Customer:\n${pair.customerText}\n\nAgent reply:\n${pair.agentText}`;

    const { error } = await supabase.from("agent_knowledge").insert({
      shop_id: shopId,
      source_type: "ticket",
      source_provider: "sent_reply",
      content,
      embedding: embedding ?? null,
      metadata: {
        snippet_id: crypto.randomUUID(),
        title: pair.subject || "Sent reply",
        thread_id: pair.threadId,
        workspace_id: workspaceId,
        chunk_index: 0,
        chunk_count: 1,
        sent_at: new Date().toISOString(),
        backfilled: true,
      },
    });

    if (error) {
      console.error("backfill: insert failed", pair.threadId, error.message);
      failed++;
    } else {
      processed++;
    }

    // Small delay to avoid rate-limiting OpenAI embeddings
    await new Promise((r) => setTimeout(r, 50));
  }

  return new Response(
    JSON.stringify({
      ok: true,
      processed,
      failed,
      skipped: alreadyStoredThreadIds.size,
      total_pairs_found: pairs.length,
    }),
    { status: 200 }
  );
});
