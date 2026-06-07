// READ-ONLY deep audit of g-033 against DEPLOYED generate-draft-v2 (eval mode,
// NO DB writes). Dumps planner intent + queries, the full matcher pool with
// retrieval score breakdown, the matcher's per-candidate LLM relevance scores,
// abstain status, and the draft. Also dumps g-013 to check 3919 bleed.
//   set -a && source apps/web/.env.local && set +a
//   node scripts/local/probe-g033.mjs
import { createClient } from "/Users/jonashoppe/Developer/INNO/node_modules/@supabase/supabase-js/dist/main/index.js";
import { readFileSync } from "node:fs";
const fx = JSON.parse(readFileSync("/Users/jonashoppe/Developer/INNO/supabase/eval/gold-eval-cases.acezone.json", "utf8"));
const URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SHOP = "38df5fef-2a23-47f3-803e-39f2d6f1ed99";
const FOCUS = ["3919", "3913", "3651", "3192", "3899", "3054"]; // chunks of interest

async function call(c) {
  const body = JSON.stringify({ shop_id: SHOP, email_data: { subject: c.title || "", body: c.customer_message, from_email: "eval@eval.internal", conversation_history: c.thread_history_json || undefined }, eval_options: {} });
  const res = await fetch(`${URL}/functions/v1/generate-draft-v2`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` }, body });
  return await res.json();
}

function dump(id, full) {
  const c = (fx.cases || []).find((x) => x.source_case_id === id);
  const gold = (c.gold_knowledge_chunk_ids || []).map(String);
  return call(c).then((d) => {
    const rd = d.retrieval_debug || {};
    const cd = rd.candidate_diagnostics || {};
    const matcher = rd.matcher || {};
    const pool = (cd.matcher_pool_top15 || []).map(String);
    const ranked = matcher.ranked || []; // [{id, relevance, title}]
    const relById = Object.fromEntries(ranked.map((r) => [String(r.id), r.relevance]));
    const scored = cd.scored_candidates_pre_dedupe || [];
    const scoreById = Object.fromEntries(scored.map((s) => [String(s.chunk_id), s]));
    const selected = (cd.matcher_selected_ids || []).map(String);
    const final = (cd.final_selected_ids || []).map(String);

    console.log(`\n${"#".repeat(70)}\n## ${id}  expected_intent=${c.expected_intent}  gold=${gold.join(",")}`);
    if (full) console.log(`\nCUSTOMER MESSAGE:\n${c.customer_message}\n`);
    console.log(`planner_intent=${d.intent || rd.intent || "?"}  abstain=${cd.matcher_abstain}  THRESHOLD=0.6 MARGIN=0.15 POOL=15`);
    console.log(`planner_queries=${JSON.stringify(cd.planner_queries || cd.plannerQueries || rd.planner_queries || "(not exposed)")}`);
    console.log(`fallback_queries=${JSON.stringify(cd.fallback_queries || "(n/a)")}`);
    console.log(`mentioned_products_resolved=${JSON.stringify(cd.product_scoring?.mentioned_products_resolved || [])}`);
    console.log(`\nPOOL (rank: id  matcher_rel | base prodB issueB lexB srcB usableB xprodPen -> final | title)`);
    pool.forEach((pid, i) => {
      const s = scoreById[pid] || {};
      const rel = relById[pid];
      const mark = FOCUS.includes(pid) ? " <==" : "";
      console.log(
        `  #${String(i + 1).padStart(2)}: ${pid}  rel=${rel === undefined ? "—" : rel.toFixed(2)} | ` +
        `b=${(s.base_score ?? 0).toFixed(3)} pB=${(s.product_boost ?? 0).toFixed(2)} iB=${(s.issue_type_boost ?? 0).toFixed(2)} ` +
        `lxB=${(s.lexical_issue_boost ?? 0).toFixed(2)} srcB=${(s.source_type_boost ?? 0).toFixed(2)} uB=${(s.usable_as_boost ?? 0).toFixed(2)} ` +
        `xP=${(s.cross_product_penalty ?? 0).toFixed(2)} -> ${(s.final_score ?? 0).toFixed(3)}${mark}`
      );
    });
    // any focus chunk NOT in pool?
    const missing = FOCUS.filter((f) => !pool.includes(f));
    console.log(`focus_chunks_NOT_in_pool=${missing.join(",") || "(none)"}`);
    console.log(`\nmatcher_selected=${selected.join(",") || "(none)"}  final=${final.join(",") || "(none)"}  abstained=${cd.matcher_abstain}`);
    // top matcher relevances overall
    const topRel = [...ranked].sort((a, b) => b.relevance - a.relevance).slice(0, 6).map((r) => `${r.id}:${r.relevance.toFixed(2)}`);
    console.log(`matcher_top_relevances=${topRel.join(", ")}`);
    const draft = (d.reply || d.draft_text || d.draft || "").replace(/\s+/g, " ").trim();
    console.log(`\nDRAFT (${draft.length}): ${draft.slice(0, 700)}`);
  });
}

await dump("g-033", true);
await dump("g-013", true);
