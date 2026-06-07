// READ-ONLY baseline probe for the return-knowledge-consolidation review.
// Hits DEPLOYED v210 in eval mode (NO DB writes). Dumps pool membership +
// selection for focus + guard cases so we can establish the CURRENT state
// before any (gated) canonical-injection preview.
//   set -a && source apps/web/.env.local && set +a
//   node /tmp/probe-review.mjs
import { createClient } from "/Users/jonashoppe/Developer/INNO/node_modules/@supabase/supabase-js/dist/main/index.js";
import { readFileSync } from "node:fs";
const fx = JSON.parse(readFileSync("/Users/jonashoppe/Developer/INNO/supabase/eval/gold-eval-cases.acezone.json", "utf8"));
const URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SHOP = "38df5fef-2a23-47f3-803e-39f2d6f1ed99";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(c) {
  const body = JSON.stringify({ shop_id: SHOP, email_data: { subject: c.title || "", body: c.customer_message, from_email: "eval@eval.internal", conversation_history: c.thread_history_json || undefined }, eval_options: {} });
  for (let a = 1; a <= 4; a++) { try { const res = await fetch(`${URL}/functions/v1/generate-draft-v2`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` }, body }); return await res.json(); } catch (e) { await sleep(1500 * a); } }
  return {};
}
// focus = targets; guards = must-not-regress
const FOCUS = ["g-033", "g-047", "g-013", "g-028"];
const GUARD = ["g-012", "g-045", "g-002", "g-041"]; // exchange, exchange, technical_support, tracking
for (const id of [...FOCUS, ...GUARD]) {
  const c = (fx.cases || []).find((x) => x.source_case_id === id);
  if (!c) { console.log(`\n## ${id}: NOT FOUND`); continue; }
  const gold = (c.gold_knowledge_chunk_ids || []).map(String);
  const d = await call(c);
  const rd = d.retrieval_debug || {};
  const cd = rd.candidate_diagnostics || {};
  const pool = (cd.matcher_pool_top15 || []).map(String);
  const selected = (cd.matcher_selected_ids || []).map(String);
  const final = (cd.final_selected_ids || []).map(String);
  const goldInPool = gold.filter((g) => pool.includes(g));
  const goldInFinal = gold.filter((g) => final.includes(g));
  const tag = FOCUS.includes(id) ? "FOCUS" : "GUARD";
  console.log(`\n## ${id} [${tag}] intent=${c.expected_intent} gold=${gold.join(",")}`);
  console.log(`   planner_intent=${d.intent || rd.intent || "?"} abstain=${cd.matcher_abstain}`);
  console.log(`   pool15=${pool.join(",")}`);
  console.log(`   gold_in_pool=${goldInPool.join(",") || "(none)"}`);
  console.log(`   selected=${selected.join(",")} final=${final.join(",")}`);
  console.log(`   HIT@final=${goldInFinal.length > 0} (gold_in_final=${goldInFinal.join(",") || "none"})`);
  console.log(`   3919_in_pool=${pool.includes("3919")} 3919_selected=${selected.includes("3919")||final.includes("3919")} 3899_selected=${selected.includes("3899")||final.includes("3899")}`);
  const draft = (d.reply || d.draft_text || d.draft || "").replace(/\s+/g, " ").trim();
  console.log(`   skipped=${d.skipped===true} draft_len=${draft.length}`);
  if (FOCUS.includes(id)) console.log(`   DRAFT: ${draft.slice(0, 900)}`);
}
console.log("\n(baseline only — no canonical injection; see review doc for gated injection recipe)");
