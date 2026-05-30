// supabase/scripts/migrate-agent-knowledge-tickets.mjs
//
// Migrate misplaced ticket rows out of agent_knowledge into ticket_examples.
//
// WHY: Historical sent replies were backfilled into agent_knowledge with
// source_type='ticket'. That table is the wrong home for them:
//   1. The v2 retriever EXCLUDES them (`.neq("source_type","ticket")`), so they
//      never reach the model as few-shot tone anchors.
//   2. They carry RAW customer PII (names, addresses, phones, emails, order
//      numbers, agent signatures) — a GDPR liability sitting unused.
// ticket_examples is the correct home: it has its own vector index + the
// match_ticket_examples RPC that feeds the writer prompt's few-shot block.
//
// WHAT this does, per row:
//   - Parses the single `content` blob ("Customer:\n...\n\nAgent reply:\n...")
//     into customer_msg / agent_reply.
//   - Redacts BOTH halves with the same GDPR redactor used by
//     store-reply-example + scrub-ticket-examples-pii (neutral placeholders).
//   - Re-embeds using the canonical formula (customer_msg, capped 4000).
//   - Upserts into ticket_examples (source_provider='agent_knowledge_migrated',
//     external_ticket_id=metadata.thread_id, tags=['pii_scrubbed']).
//
// Idempotent: onConflict (shop_id, source_provider, external_ticket_id) updates
// in place, and thread_ids already present in ticket_examples (any provider)
// are skipped so we never duplicate an existing example.
//
// Two-phase by design — insert and delete are DECOUPLED:
//   Phase 1 (default): migrate into ticket_examples only. Verify the result.
//   Phase 2 (--purge):  delete the source_type='ticket' rows from agent_knowledge.
//
// Run:
//   set -a && source apps/web/.env.local && set +a
//   node supabase/scripts/migrate-agent-knowledge-tickets.mjs --shop 38df5fef-2a23-47f3-803e-39f2d6f1ed99
//   node supabase/scripts/migrate-agent-knowledge-tickets.mjs --shop 38df5fef-... --dry
//   node supabase/scripts/migrate-agent-knowledge-tickets.mjs --shop 38df5fef-... --purge   # delete originals (after verifying)

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const EMBED_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
const REDACT_MODEL = process.env.OPENAI_REDACT_MODEL || "gpt-4o-mini";

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const PURGE = args.includes("--purge");
const shopIdx = args.indexOf("--shop");
const SHOP_ID = shopIdx >= 0 ? args[shopIdx + 1] : null;
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : null;

if (!SUPABASE_URL || !SERVICE_ROLE || !OPENAI_KEY) {
  console.error("Missing env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / OPENAI_API_KEY");
  process.exit(1);
}
if (!SHOP_ID) {
  console.error("Missing --shop <shop_id>");
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

// Split the "Customer:\n...\n\nAgent reply:\n..." blob into its two halves.
// Also strips the leading "Customer:" label and trailing quoted reply headers
// ("Den ... skrev AceZone Support ...:") that email clients append.
function parseContent(content) {
  const str = String(content || "");
  const m = str.match(/\n\s*Agent reply:\s*\n/i);
  if (!m) return null;
  const splitAt = m.index;
  let customer = str.slice(0, splitAt);
  let agent = str.slice(splitAt + m[0].length);
  customer = customer.replace(/^\s*Customer:\s*\n?/i, "").trim();
  // Drop a trailing "On <date> ... wrote:" / "Den ... skrev ...:" quote header.
  customer = customer
    .replace(/\n+(Den|On)\b[\s\S]*?:\s*$/i, "")
    .trim();
  agent = agent.trim();
  if (!customer || !agent) return null;
  return { customer_msg: customer, agent_reply: agent };
}

async function redact(input) {
  const cap = (s, n) => (s || "").slice(0, n);
  const body = {
    subject: cap(input.subject, 300),
    customer_msg: cap(input.customer_msg, 2500),
    agent_reply: cap(input.agent_reply, 2500),
    conversation_context: cap(input.conversation_context, 2500),
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
        { role: "user", content: JSON.stringify(body) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`redact failed ${res.status}: ${await res.text()}`);
  const payload = await res.json();
  const parsed = JSON.parse(payload.choices[0].message.content);
  if (!parsed.customer_msg || !parsed.agent_reply) throw new Error("redactor returned empty fields");
  return parsed;
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

async function fetchSourceRows() {
  const filters = [
    `shop_id=eq.${SHOP_ID}`,
    "source_type=eq.ticket",
    "select=id,shop_id,workspace_id,content,metadata,created_at",
    "order=created_at.asc",
  ];
  const res = await fetch(rest(`agent_knowledge?${filters.join("&")}`), { headers: restHeaders });
  if (!res.ok) throw new Error(`fetch agent_knowledge failed ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchExistingExternalIds() {
  const filters = [`shop_id=eq.${SHOP_ID}`, "select=external_ticket_id"];
  const res = await fetch(rest(`ticket_examples?${filters.join("&")}`), { headers: restHeaders });
  if (!res.ok) throw new Error(`fetch ticket_examples failed ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  return new Set(rows.map((r) => r.external_ticket_id).filter(Boolean));
}

async function upsertExample(row) {
  const res = await fetch(
    rest("ticket_examples?on_conflict=shop_id,source_provider,external_ticket_id"),
    {
      method: "POST",
      headers: { ...restHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(row),
    }
  );
  if (!res.ok) throw new Error(`upsert failed ${res.status}: ${await res.text()}`);
}

async function purgeSourceRows() {
  const res = await fetch(
    rest(`agent_knowledge?shop_id=eq.${SHOP_ID}&source_type=eq.ticket`),
    { method: "DELETE", headers: { ...restHeaders, Prefer: "return=representation" } }
  );
  if (!res.ok) throw new Error(`purge failed ${res.status}: ${await res.text()}`);
  return res.json();
}

(async () => {
  if (PURGE) {
    if (DRY) {
      const rows = await fetchSourceRows();
      console.log(`DRY PURGE: would delete ${rows.length} agent_knowledge ticket rows for shop ${SHOP_ID}`);
      return;
    }
    const deleted = await purgeSourceRows();
    console.log(`Purged ${deleted.length} agent_knowledge ticket rows for shop ${SHOP_ID}`);
    return;
  }

  const [rows, existing] = await Promise.all([fetchSourceRows(), fetchExistingExternalIds()]);
  let pending = rows;
  if (LIMIT) pending = pending.slice(0, LIMIT);
  console.log(
    `Source ticket rows: ${rows.length} | already in ticket_examples (by thread_id): ${rows.filter((r) => existing.has(r.metadata?.thread_id)).length} | to migrate: ${pending.length}${DRY ? " (DRY RUN)" : ""}`
  );

  let done = 0, skipped = 0, failed = 0;
  for (const row of pending) {
    const threadId = row.metadata?.thread_id || null;
    try {
      if (threadId && existing.has(threadId)) {
        skipped++;
        continue;
      }
      const parsed = parseContent(row.content);
      if (!parsed) {
        console.warn(`  [${row.id}] skipped: no "Agent reply:" delimiter`);
        skipped++;
        continue;
      }
      const scrubbed = await redact({
        subject: "",
        customer_msg: parsed.customer_msg,
        agent_reply: parsed.agent_reply,
        conversation_context: "",
      });
      const embedding = await embed(scrubbed.customer_msg);

      if (DRY) {
        console.log(`\n--- [${row.id}] thread=${threadId} DRY ---`);
        console.log("customer_msg:", (scrubbed.customer_msg || "").slice(0, 160));
        console.log("agent_reply :", (scrubbed.agent_reply || "").slice(0, 160));
      } else {
        await upsertExample({
          shop_id: row.shop_id,
          workspace_id: row.workspace_id ?? null,
          source_provider: "agent_knowledge_migrated",
          external_ticket_id: threadId ?? `ak_${row.id}`,
          customer_msg: scrubbed.customer_msg || "",
          agent_reply: scrubbed.agent_reply || "",
          conversation_context: null,
          subject: null,
          intent: null,
          language: null,
          csat_score: null,
          embedding: embedding ? `[${embedding.join(",")}]` : null,
          imported_at: new Date().toISOString(),
          tags: ["pii_scrubbed", "migrated_from_agent_knowledge"],
        });
      }
      done++;
      if (done % 10 === 0) console.log(`  migrated ${done}/${pending.length}`);
    } catch (err) {
      failed++;
      console.error(`  [${row.id}] ERROR:`, err.message);
    }
  }
  console.log(`\nDone. migrated=${done} skipped=${skipped} failed=${failed}${DRY ? " (dry)" : ""}`);
  if (!DRY && done > 0) {
    console.log(`\nVerify in ticket_examples, then run with --purge to delete the ${rows.length} source rows from agent_knowledge.`);
  }
})();
