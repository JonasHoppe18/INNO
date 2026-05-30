// supabase/scripts/build-golden-candidates.mjs
//
// Stratified sampler over ticket_examples → draft golden candidates for manual
// curation. NOT on the eval run path. Output is hand-pruned into golden-set.acezone.json.
//
// Run:
//   set -a && source apps/web/.env.local && set +a
//   node supabase/scripts/build-golden-candidates.mjs --shop 38df5fef-2a23-47f3-803e-39f2d6f1ed99 --per-intent 6 > supabase/eval/_candidates.json
import { ACEZONE_SHOP_ID } from "./lib/golden-eval-core.mjs";

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const args = process.argv.slice(2);
const val = (f, d) => (args.indexOf(f) >= 0 ? args[args.indexOf(f) + 1] : d);
const SHOP_ID = val("--shop", ACEZONE_SHOP_ID);
const PER_INTENT = parseInt(val("--per-intent", "6"), 10);

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const headers = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` };

const res = await fetch(
  `${SUPABASE_URL}/rest/v1/ticket_examples?shop_id=eq.${SHOP_ID}` +
    `&select=external_ticket_id,subject,customer_msg,agent_reply,intent,language&order=intent.asc`,
  { headers }
);
if (!res.ok) {
  console.error(`fetch failed ${res.status}: ${await res.text()}`);
  process.exit(1);
}
const rows = await res.json();

// Bucket by intent, take up to PER_INTENT per bucket.
const buckets = {};
for (const r of rows) {
  const k = r.intent || "unknown";
  (buckets[k] = buckets[k] || []).push(r);
}
const cases = [];
let n = 1;
for (const [intent, list] of Object.entries(buckets)) {
  for (const r of list.slice(0, PER_INTENT)) {
    cases.push({
      id: `g-${String(n++).padStart(3, "0")}`,
      tier: "historical",
      subject: r.subject || "",
      body: r.customer_msg || "",
      source_thread_id: r.external_ticket_id || null,
      human_reply: r.agent_reply || "",
      language: r.language || "da",
      intent,
    });
  }
}
console.log(JSON.stringify({ shop_id: SHOP_ID, cases }, null, 2));
