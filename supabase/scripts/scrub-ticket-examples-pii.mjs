// supabase/scripts/scrub-ticket-examples-pii.mjs
//
// One-off + repeatable PII redaction pass over ticket_examples.
//
// WHY: ticket_examples rows are injected into the writer prompt as few-shot
// tone anchors. They contain REAL customer PII (names, addresses, phones,
// emails, agent signatures). A live test proved the model copies that PII into
// replies to OTHER customers (it greeted "Bastian" as "Christoffer"). This
// script rewrites customer_msg / agent_reply / conversation_context / subject
// with an LLM redactor that replaces every piece of personal data with neutral
// placeholders, then RE-EMBEDS using the same formula as store-reply-example
// (conversation_context + "\n[Kunde]: " + customer_msg, capped at 4000 chars).
//
// Idempotent: rows already carrying the "pii_scrubbed" tag are skipped, so the
// script can be re-run safely and pointed at future imports.
//
// Run:
//   set -a && source apps/web/.env.local && set +a
//   node supabase/scripts/scrub-ticket-examples-pii.mjs --shop 38df5fef-2a23-47f3-803e-39f2d6f1ed99
//   (add --dry to preview without writing)

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const EMBED_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
const REDACT_MODEL = process.env.OPENAI_REDACT_MODEL || "gpt-4o-mini";

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const shopIdx = args.indexOf("--shop");
const SHOP_ID = shopIdx >= 0 ? args[shopIdx + 1] : null;
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : null;

if (!SUPABASE_URL || !SERVICE_ROLE || !OPENAI_KEY) {
  console.error("Missing env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / OPENAI_API_KEY");
  process.exit(1);
}

const rest = (path) => `${SUPABASE_URL}/rest/v1/${path}`;
const restHeaders = {
  apikey: SERVICE_ROLE,
  Authorization: `Bearer ${SERVICE_ROLE}`,
  "Content-Type": "application/json",
};

const REDACT_SYSTEM = `You are a strict GDPR redaction engine for customer-support transcripts.
You receive JSON with fields: subject, customer_msg, agent_reply, conversation_context.
Return JSON with the SAME fields, rewritten so that ALL personal data is replaced by neutral placeholders, while preserving meaning, tone, structure and any product/issue details.

Replace:
- Person names (customer AND agent/support names) -> use a neutral greeting/sign-off. Customer greeting becomes "Hi there" (or the same language equivalent). Agent signature name becomes "[Agent]". Never invent a name.
- Email addresses -> [email]
- Phone numbers -> [phone]
- Postal/street addresses, postal codes, cities tied to a person -> [address]
- Order numbers / order IDs -> [order number]
- Tracking numbers / shipment IDs -> [tracking number]
- Any other directly identifying info (national IDs, full DOB) -> [redacted]

KEEP intact: product names (A-Spire, A-Rise, A-Blaze, dongle, etc.), the nature of the issue, policy/procedure wording, tone, and language (do not translate).
Do NOT add commentary. Output ONLY the JSON object.`;

async function redact(row) {
  // Cap each field — long transcripts can otherwise cause the redactor to emit
  // truncated/runaway JSON. The few-shot display caps customer_msg/agent_reply
  // far below these limits anyway (350/500 chars), so no useful signal is lost.
  const cap = (s, n) => (s || "").slice(0, n);
  const input = {
    subject: cap(row.subject, 300),
    customer_msg: cap(row.customer_msg, 2500),
    agent_reply: cap(row.agent_reply, 2500),
    conversation_context: cap(row.conversation_context, 2500),
  };
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: REDACT_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: REDACT_SYSTEM },
        { role: "user", content: JSON.stringify(input) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`redact failed ${res.status}: ${await res.text()}`);
  const payload = await res.json();
  return JSON.parse(payload.choices[0].message.content);
}

async function embed(text) {
  const trimmed = (text || "").slice(0, 4000);
  if (!trimmed) return null;
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: trimmed }),
  });
  if (!res.ok) throw new Error(`embed failed ${res.status}: ${await res.text()}`);
  const payload = await res.json();
  return payload.data?.[0]?.embedding ?? null;
}

async function fetchRows() {
  const filters = [
    "select=id,shop_id,subject,customer_msg,agent_reply,conversation_context,tags",
    "order=id.asc",
  ];
  if (SHOP_ID) filters.unshift(`shop_id=eq.${SHOP_ID}`);
  const res = await fetch(rest(`ticket_examples?${filters.join("&")}`), { headers: restHeaders });
  if (!res.ok) throw new Error(`fetch rows failed ${res.status}: ${await res.text()}`);
  return res.json();
}

async function patchRow(id, body) {
  const res = await fetch(rest(`ticket_examples?id=eq.${id}`), {
    method: "PATCH",
    headers: { ...restHeaders, Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`patch ${id} failed ${res.status}: ${await res.text()}`);
}

(async () => {
  const rows = await fetchRows();
  let pending = rows.filter((r) => !(Array.isArray(r.tags) && r.tags.includes("pii_scrubbed")));
  if (LIMIT) pending = pending.slice(0, LIMIT);
  console.log(`Total rows: ${rows.length} | already scrubbed: ${rows.length - pending.length} | to process: ${pending.length}${DRY ? " (DRY RUN)" : ""}`);

  let done = 0, failed = 0;
  for (const row of pending) {
    try {
      const scrubbed = await redact(row);
      const embedInput = scrubbed.conversation_context
        ? `${scrubbed.conversation_context}\n[Kunde]: ${scrubbed.customer_msg}`.slice(0, 4000)
        : scrubbed.customer_msg;
      const embedding = await embed(embedInput);
      const nextTags = Array.from(new Set([...(row.tags || []), "pii_scrubbed"]));

      if (DRY) {
        console.log(`\n--- [${row.id}] DRY ---`);
        console.log("customer_msg:", (scrubbed.customer_msg || "").slice(0, 160));
        console.log("agent_reply :", (scrubbed.agent_reply || "").slice(0, 160));
      } else {
        await patchRow(row.id, {
          subject: scrubbed.subject || null,
          customer_msg: scrubbed.customer_msg || "",
          agent_reply: scrubbed.agent_reply || "",
          conversation_context: scrubbed.conversation_context || null,
          embedding: embedding ? `[${embedding.join(",")}]` : null,
          tags: nextTags,
        });
      }
      done++;
      if (done % 10 === 0) console.log(`  processed ${done}/${pending.length}`);
    } catch (err) {
      failed++;
      console.error(`  [${row.id}] ERROR:`, err.message);
    }
  }
  console.log(`\nDone. scrubbed=${done} failed=${failed}${DRY ? " (dry)" : ""}`);
})();
