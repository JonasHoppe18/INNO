// supabase/scripts/run-golden-eval.mjs
//
// Run the committed golden set against the DEPLOYED generate-draft-v2, judge each
// draft with the existing LLM judge, enforce edge-case gates, and report lift/
// regression vs the committed baseline.
//
// Run:
//   set -a && source apps/web/.env.local && set +a
//   node supabase/scripts/run-golden-eval.mjs                 # full run vs baseline
//   node supabase/scripts/run-golden-eval.mjs --tier edge     # gates only
//   node supabase/scripts/run-golden-eval.mjs --limit 2       # smoke test
//   node supabase/scripts/run-golden-eval.mjs --accept        # write current run as new baseline
//
// Exit code: non-zero if any edge gate fails. Baseline regressions are reported, not fatal.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
  parseArgs, loadGoldenSet, runGates, computeAggregate, diffBaseline,
} from "./lib/golden-eval-core.mjs";
import {
  generateDraftV2, judgeWithOpenAI, draftForJudge,
} from "../../apps/web/lib/server/eval-runner.js";

const SET_PATH = "supabase/eval/golden-set.acezone.json";
const BASELINE_PATH = "supabase/eval/golden-baseline.acezone.json";
const RUNS_DIR = "supabase/eval/runs";

function readJsonOrNull(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

const opts = parseArgs(process.argv.slice(2));
const set = JSON.parse(readFileSync(SET_PATH, "utf8"));
const cases = loadGoldenSet(set, { tier: opts.tier, limit: opts.limit });
console.log(`Running ${cases.length} cases against deployed generate-draft-v2 (shop ${opts.shop})`);

const results = [];
let gateFailures = 0;
for (const c of cases) {
  try {
    const gen = await generateDraftV2(opts.shop, c.subject, c.body, {
      sourceThreadId: c.source_thread_id || undefined,
    });
    const judged = await judgeWithOpenAI(
      c.body, draftForJudge(gen.draft, gen.actions), c.human_reply, "gpt-4o-mini"
    );
    const gate = runGates(gen.draft, gen.actions, c);
    if (!gate.passed) gateFailures++;
    results.push({
      id: c.id, intent: c.intent || null, tier: c.tier, status: "scored",
      scores: {
        correctness: judged.correctness, completeness: judged.completeness,
        tone: judged.tone, actionability: judged.actionability,
        overall_10: judged.overall_10, send_ready: judged.send_ready,
      },
      gate, draft: gen.draft, actions: gen.actions, latencyMs: gen.latencyMs,
    });
    const flag = c.tier === "edge" ? (gate.passed ? "gate:PASS" : "gate:FAIL") : "";
    console.log(`  [${c.id}] overall_10=${judged.overall_10} ${flag}`);
  } catch (err) {
    results.push({ id: c.id, intent: c.intent || null, tier: c.tier, status: "failed", error: err.message });
    console.error(`  [${c.id}] ERROR: ${err.message}`);
  }
}

const summary = computeAggregate(results);
const baseline = readJsonOrNull(BASELINE_PATH);
const diff = diffBaseline(summary, baseline);

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync(RUNS_DIR, { recursive: true });
const reportPath = `${RUNS_DIR}/${stamp}.json`;
writeFileSync(reportPath, JSON.stringify({ stamp, opts, summary, diff, results }, null, 2));

console.log("\n=== Aggregate ===");
console.log(summary.aggregate);
console.log("per_intent:", summary.per_intent);
if (diff.aggregateDeltas) {
  console.log("\n=== vs baseline ===");
  console.log("deltas:", diff.aggregateDeltas);
  if (diff.regressedCases.length) {
    console.log("REGRESSED:");
    for (const r of diff.regressedCases) console.log(`  ${r.id}: ${r.from} -> ${r.to}`);
  } else {
    console.log("no per-case regressions");
  }
} else {
  console.log("\n(no baseline yet — run with --accept to establish one)");
}
const failedRuns = results.filter((r) => r.status === "failed").length;
console.log(`\nReport: ${reportPath} | scored=${summary.n_cases} failed=${failedRuns} gateFailures=${gateFailures}`);

if (opts.accept) {
  const newBaseline = {
    accepted_at: new Date().toISOString(),
    n_cases: summary.n_cases,
    aggregate: summary.aggregate,
    per_intent: summary.per_intent,
    per_case: summary.per_case,
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(newBaseline, null, 2));
  console.log(`Baseline updated: ${BASELINE_PATH}`);
}

process.exit(gateFailures > 0 ? 1 : 0);
