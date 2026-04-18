// Captures a sent support reply as a knowledge example for future AI draft retrieval.
// Called fire-and-forget from the web send route after a reply is successfully sent.
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
    console.warn("store-reply-example: embedding failed", payload?.error?.message ?? res.status);
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
    console.error("store-reply-example: missing Supabase config");
    return new Response("Server misconfigured", { status: 500 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const threadId = String(body.thread_id || "").trim();
  const shopId = String(body.shop_id || "").trim();
  const sentReplyText = String(body.sent_reply_text || "").trim();
  const customerMessageText = String(body.customer_message_text || "").trim();
  const subject = String(body.subject || "").trim();
  const workspaceId = String(body.workspace_id || "").trim() || null;

  if (!threadId || !shopId || !sentReplyText || !customerMessageText) {
    return new Response("Missing required fields", { status: 400 });
  }

  // Avoid storing duplicate examples for the same thread
  const { data: existing } = await supabase
    .from("agent_knowledge")
    .select("id")
    .eq("shop_id", shopId)
    .eq("source_type", "ticket")
    .eq("source_provider", "sent_reply")
    .filter("metadata->>'thread_id'", "eq", threadId)
    .maybeSingle();

  if (existing) {
    return new Response(JSON.stringify({ ok: true, skipped: true }), { status: 200 });
  }

  const embedding = await createEmbedding(customerMessageText);

  const content = `Customer:\n${customerMessageText}\n\nAgent reply:\n${sentReplyText}`;

  const { error } = await supabase.from("agent_knowledge").insert({
    shop_id: shopId,
    source_type: "ticket",
    source_provider: "sent_reply",
    content,
    embedding: embedding ?? null,
    metadata: {
      snippet_id: crypto.randomUUID(),
      title: subject || "Sent reply",
      thread_id: threadId,
      workspace_id: workspaceId,
      chunk_index: 0,
      chunk_count: 1,
      sent_at: new Date().toISOString(),
    },
  });

  if (error) {
    console.error("store-reply-example: insert failed", error.message);
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
});
