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
const OPENAI_REDACT_MODEL = Deno.env.get("OPENAI_REDACT_MODEL") ?? "gpt-4o-mini";

const supabase =
  PROJECT_URL && SERVICE_ROLE_KEY ? createClient(PROJECT_URL, SERVICE_ROLE_KEY) : null;

// ticket_examples become few-shot tone anchors in the writer prompt. They MUST
// NOT carry real PII or the model can copy one customer's name/address/phone
// into another customer's reply. Every captured reply is redacted before store.
const REDACT_SYSTEM = `You are a strict GDPR redaction engine for customer-support transcripts.
You receive JSON with fields: subject, customer_msg, agent_reply, conversation_context.
Return JSON with the SAME fields, rewritten so that ALL personal data is replaced by neutral placeholders, while preserving meaning, tone, structure and any product/issue details.

Replace:
- Person names (customer AND agent/support names) -> neutral greeting/sign-off. Customer greeting becomes a neutral "Hi there" (same-language equivalent). Agent signature name becomes "[Agent]". Never invent a name.
- Email addresses -> [email]
- Phone numbers -> [phone]
- Postal/street addresses, postal codes, cities tied to a person -> [address]
- Order numbers / order IDs -> [order number]
- Tracking numbers / shipment IDs -> [tracking number]
- Any other directly identifying info -> [redacted]

KEEP intact: product names (A-Spire, A-Rise, A-Blaze, dongle, etc.), the nature of the issue, policy/procedure wording, tone, and language (do not translate).
Output ONLY the JSON object.`;

async function redactExample(input: {
  subject: string;
  customer_msg: string;
  agent_reply: string;
  conversation_context: string;
}): Promise<
  | { subject: string; customer_msg: string; agent_reply: string; conversation_context: string }
  | null
> {
  if (!OPENAI_API_KEY) return null;
  const cap = (s: string, n: number) => String(s || "").slice(0, n);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_REDACT_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: REDACT_SYSTEM },
          {
            role: "user",
            content: JSON.stringify({
              subject: cap(input.subject, 300),
              customer_msg: cap(input.customer_msg, 2500),
              agent_reply: cap(input.agent_reply, 2500),
              conversation_context: cap(input.conversation_context, 2500),
            }),
          },
        ],
      }),
    });
    if (!res.ok) {
      console.warn("store-reply-example: redaction failed", res.status);
      return null;
    }
    const payload = await res.json();
    const parsed = JSON.parse(payload.choices[0].message.content);
    if (!parsed.customer_msg || !parsed.agent_reply) return null;
    return {
      subject: String(parsed.subject ?? ""),
      customer_msg: String(parsed.customer_msg ?? ""),
      agent_reply: String(parsed.agent_reply ?? ""),
      conversation_context: String(parsed.conversation_context ?? ""),
    };
  } catch (err) {
    console.warn("store-reply-example: redaction error", err);
    return null;
  }
}

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
  const conversationContext = typeof body.conversation_context === "string"
    ? body.conversation_context.trim() || null
    : null;
  const subject = String(body.subject || "").trim();
  const workspaceId = String(body.workspace_id || "").trim() || null;
  const intent = String(body.intent || "").trim() || null;
  const language = String(body.language || "").trim() || null;
  const editDeltaPct = typeof body.edit_delta_pct === "number" ? body.edit_delta_pct : null;

  if (!threadId || !shopId || !sentReplyText || !customerMessageText) {
    return new Response("Missing required fields", { status: 400 });
  }

  // Convert edit_delta_pct → csat_score:
  // 0 = no edits (Sona was perfect) → 100
  // 1 = complete rewrite → 0
  // null = no AI draft to compare against → null
  const csatScore = editDeltaPct !== null
    ? Math.round((1 - Math.min(editDeltaPct, 1)) * 100)
    : null;

  // GDPR: redact PII before this reply becomes a few-shot example. If redaction
  // fails we DROP the example (fire-and-forget) rather than persist raw PII.
  const redacted = await redactExample({
    subject,
    customer_msg: customerMessageText,
    agent_reply: sentReplyText,
    conversation_context: conversationContext ?? "",
  });
  if (!redacted) {
    console.warn(`store-reply-example: skipped (redaction unavailable) thread ${threadId}`);
    return new Response(JSON.stringify({ ok: true, skipped: "redaction_failed" }), { status: 200 });
  }
  const safeCustomerMsg = redacted.customer_msg;
  const safeAgentReply = redacted.agent_reply;
  const safeContext = redacted.conversation_context || null;
  const safeSubject = redacted.subject || null;

  // Embed on context + customer message for better multi-turn retrieval.
  // Including prior conversation improves similarity matching for follow-up tickets.
  const embedInput = safeContext
    ? `${safeContext}\n[Kunde]: ${safeCustomerMsg}`.slice(0, 4000)
    : safeCustomerMsg;
  const embedding = await createEmbedding(embedInput);

  const { error } = await supabase.from("ticket_examples").upsert(
    {
      shop_id: shopId,
      workspace_id: workspaceId,
      source_provider: "sona_sent",
      external_ticket_id: threadId,
      customer_msg: safeCustomerMsg,
      agent_reply: safeAgentReply,
      conversation_context: safeContext,
      subject: safeSubject,
      intent: intent,
      language: language,
      csat_score: csatScore,
      embedding: embedding ?? null,
      imported_at: new Date().toISOString(),
      tags: ["pii_scrubbed"],
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
