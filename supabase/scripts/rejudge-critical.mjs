// supabase/scripts/rejudge-critical.mjs
//
// PHASE 2 — re-judge a SMALL set of stored eval drafts with the merged judge
// rubric (hard caps + judge_flags). It does NOT generate fresh drafts, does NOT
// run the eval worker, and does NOT write anything: it only SELECTs stored rows
// and calls the LLM judge on the already-stored draft_content.
//
// Cost: exactly one judge call per case. Default = 3 cases (281, 297, 276).
// A hard ceiling of 5 is enforced unless --allow-extra is passed.
//
// Run (locally, with secrets in env):
//   set -a && source apps/web/.env.local && set +a   # provides OPENAI_API_KEY + Supabase
//   node supabase/scripts/rejudge-critical.mjs
//   node supabase/scripts/rejudge-critical.mjs --cases ticket-example-281,ticket-example-297
//   node supabase/scripts/rejudge-critical.mjs --label "test efter deploy d. 3 juni"
//
// Required env: OPENAI_API_KEY, and Supabase URL + service role key
//   (NEXT_PUBLIC_SUPABASE_URL | SUPABASE_URL) + (SUPABASE_SERVICE_ROLE_KEY | SERVICE_ROLE_KEY).

import { judgeWithOpenAI, draftForJudge } from "../../apps/web/lib/server/eval-runner.js";
import { classifyAnchor } from "../../apps/web/lib/server/eval-anchor.js";

// ---- args -------------------------------------------------------------------
function parseArgs(argv) {
  const val = (f) => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : null;
  };
  const casesRaw = val("--cases");
  return {
    label: val("--label") || "test efter deploy d. 3 juni",
    cases: casesRaw
      ? casesRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : ["ticket-example-281", "ticket-example-297", "ticket-example-276"],
    judgeModel: val("--judge-model") || "gpt-4o-mini",
    allowExtra: argv.includes("--allow-extra"),
  };
}

// What we expect the merged rubric to do (printed alongside actuals; not asserted
// hard, since the judge is an LLM — the run reports PASS/WARN for review).
const EXPECTATIONS = {
  "ticket-example-281": { flag: "fabrication", maxOverall: 2, note: "invented 'A-LIVE sales leads' / named colleague" },
  "ticket-example-297": { flag: "unsupported_availability", maxOverall: 3, note: "implied earpads purchasable while page shows SOLD OUT" },
  "ticket-example-276": { flag: null, minOverall: 8, note: "comparable control — should stay high, no hard flag" },
  "ticket-example-287": { flag: null, minOverall: 6, note: "comparable control — informational reply" },
};

// ---- env --------------------------------------------------------------------
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";

function requireEnv() {
  const missing = [];
  if (!process.env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  if (!SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL|SUPABASE_URL");
  if (!SERVICE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY");
  if (missing.length) {
    console.error(`Missing required env: ${missing.join(", ")}`);
    process.exit(1);
  }
}

// Read-only fetch of the stored rows via PostgREST (SELECT only — no writes).
async function fetchRows(label, ids) {
  const inList = `(${ids.map((id) => `"${id}"`).join(",")})`;
  const params = new URLSearchParams({
    run_label: `eq.${label}`,
    zendesk_ticket_id: `in.${inList}`,
    select: "zendesk_ticket_id,ticket_body,draft_content,human_reply,proposed_actions,overall_10,send_ready,primary_gap,likely_root_cause",
  });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/eval_results?${params}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) {
    throw new Error(`eval_results fetch failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.cases.length > 5 && !opts.allowExtra) {
    console.error(`Refusing ${opts.cases.length} cases (>5). Pass --allow-extra to override.`);
    process.exit(1);
  }
  requireEnv();

  console.log(`Re-judge (READ-ONLY) — label="${opts.label}" cases=${opts.cases.length} judge=${opts.judgeModel}`);
  console.log(`This run will make exactly ${opts.cases.length} judge call(s). No drafts generated. No writes.\n`);

  const rows = await fetchRows(opts.label, opts.cases);
  const byId = new Map(rows.map((r) => [r.zendesk_ticket_id, r]));

  for (const id of opts.cases) {
    const row = byId.get(id);
    if (!row) { console.log(`[${id}] NOT FOUND in run — skipped (no judge call).`); continue; }

    // Derive anchor exactly as the worker does (from the human reply), and route
    // non-comparable anchors to standalone judging.
    const { anchor_class } = classifyAnchor({ humanReply: row.human_reply || "" });
    const judgeHuman = anchor_class === "non_comparable_anchor" ? null : (row.human_reply || null);

    const scores = await judgeWithOpenAI(
      row.ticket_body || "",
      draftForJudge(row.draft_content || "", row.proposed_actions || []),
      judgeHuman,
      opts.judgeModel,
      anchor_class,
    );

    const exp = EXPECTATIONS[id] || {};
    const flags = scores.judge_flags || {};
    const firedFlags = Object.entries(flags).filter(([, v]) => v).map(([k]) => k);
    let verdict = "INFO";
    if (exp.flag) {
      verdict = (flags[exp.flag] && scores.overall_10 <= exp.maxOverall && scores.send_ready === false) ? "PASS" : "WARN";
    } else if (typeof exp.minOverall === "number") {
      verdict = (firedFlags.length === 0 && scores.overall_10 >= exp.minOverall) ? "PASS" : "WARN";
    }

    console.log(`[${id}] ${verdict}  (${exp.note || ""})`);
    console.log(`   prior_overall_10=${row.overall_10}  ->  new_overall_10=${scores.overall_10}  send_ready=${scores.send_ready}`);
    console.log(`   anchor_class=${anchor_class}  judge_flags=[${firedFlags.join(", ") || "none"}]`);
    console.log(`   primary_gap=${scores.primary_gap}  root_cause=${scores.likely_root_cause}\n`);
  }

  console.log("Done. (read-only — nothing written to the database)");
}

main().catch((err) => { console.error(err); process.exit(1); });
