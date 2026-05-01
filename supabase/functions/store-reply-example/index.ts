// Captures a sent support reply as a ticket example for future AI draft retrieval.
// Called fire-and-forget from the web send route after a reply is successfully sent.
// Stores into ticket_examples (not agent_knowledge) so v2 retriever finds it via match_ticket_examples.
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
  const intent = String(body.intent || "").trim() || null;
  const language = String(body.language || "").trim() || null;

  if (!threadId || !shopId || !sentReplyText || !customerMessageText) {
    return new Response("Missing required fields", { status: 400 });
  }

  // Embed on the customer message — retrieval finds similar customer situations
  const embedding = await createEmbedding(customerMessageText);

  const { error } = await supabase.from("ticket_examples").upsert(
    {
      shop_id: shopId,
      workspace_id: workspaceId,
      source_provider: "sona_sent",
      external_ticket_id: threadId,
      customer_msg: customerMessageText,
      agent_reply: sentReplyText,
      subject: subject || null,
      intent: intent,
      language: language,
      embedding: embedding ?? null,
      imported_at: new Date().toISOString(),
    },
    {
      onConflict: "shop_id,source_provider,external_ticket_id",
      ignoreDuplicates: false, // update agent_reply if re-sent (edited)
    }
  );

  if (error) {
    console.error("store-reply-example: insert failed", error.message);
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
  }

  console.log(`store-reply-example: stored example for thread ${threadId} shop ${shopId}`);
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
});
