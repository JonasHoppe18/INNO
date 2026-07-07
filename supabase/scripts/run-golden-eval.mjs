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
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import {
  parseArgs, loadGoldenSet, runGates, computeAggregate, diffBaseline, computeCoherence,
  computeRetrievalMetrics, aggregateRetrievalMetrics, resolveSetPath,
  summarizeCandidateDiagnostics, formatCandidateDiagnosticsSummary,
  buildGoldenEvalResult,
} from "./lib/golden-eval-core.mjs";
import {
  generateDraftV2, judgeWithOpenAI, draftForJudge,
} from "../../apps/web/lib/server/eval-runner.js";
import { classifyAnchor } from "../../apps/web/lib/server/eval-anchor.js";
import { classifyLiveFactDependency } from "../../apps/web/lib/server/eval-live-fact.js";

const SET_PATH = "supabase/eval/golden-set.acezone.json";
const BASELINE_PATH = "supabase/eval/golden-baseline.acezone.json";
const RUNS_DIR = "supabase/eval/runs";
const GOLD_LABELS_PATH = "supabase/eval/gold-labels.acezone.json";

function readJsonOrNull(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

const opts = parseArgs(process.argv.slice(2));
// --set targets a curated subset (e.g. the 10-case pilot). A missing --set file
// throws instead of silently running the full golden set.
const setPath = resolveSetPath(opts, { defaultPath: SET_PATH, existsSync });
const set = JSON.parse(readFileSync(setPath, "utf8"));
const cases = loadGoldenSet(set, { tier: opts.tier, limit: opts.limit, intent: opts.intent });
console.log(`Case set: ${setPath} (${cases.length} cases)`);
const goldLabels = readJsonOrNull(GOLD_LABELS_PATH);
const goldById = new Map(
  (goldLabels?.labels || []).map((l) => [l.id, l.correct_snippet_ids || []]),
);
console.log(`Running ${cases.length} cases against deployed generate-draft-v2 (shop ${opts.shop})`);

const results = [];
let gateFailures = 0;
for (const c of cases) {
  try {
    const gen = await generateDraftV2(opts.shop, c.subject, c.body, {
      sourceThreadId: c.source_thread_id || undefined,
      writerModel: opts.writerModel ?? undefined,
      strongModel: opts.strongModel ?? undefined,
      writerEffort: opts.writerEffort ?? undefined,
      disableEscalation: opts.disableEscalation || undefined,
      retrievalAbsFloor: opts.retrievalAbsFloor ?? undefined,
      retrievalPqBudget: opts.retrievalPqBudget ?? undefined,
      retrievalIssueTiebreak: opts.retrievalIssueTiebreak || undefined,
      retrievalSourceConsolidate: opts.retrievalSourceConsolidate || undefined,
    });
    const anchorClass = c.anchor_class ||
      classifyAnchor({ humanReply: c.human_reply }).anchor_class;
    const judgeHuman = anchorClass === "non_comparable_anchor" ? null : c.human_reply;
    const judged = await judgeWithOpenAI(
      c.body, draftForJudge(gen.draft, gen.actions), judgeHuman, "gpt-4o-mini", anchorClass,
    );
    const gate = runGates(gen.draft, gen.actions, c);
    if (!gate.passed) gateFailures++;
    const coherence = computeCoherence(gen.retrievalDebug || []);
    const { live_fact_dependent } = classifyLiveFactDependency({
      body: c.body, humanReply: c.human_reply, intent: c.intent,
    });
    // Skip retrieval precision for live-fact cases: their gold label points at a
    // legacy/FAQ doc the live-commerce gate intentionally down-ranks, so a "miss"
    // here is by design, not a retrieval failure.
    const retrieval = goldById.has(c.id) && gen.matcherDebug && !live_fact_dependent
      ? computeRetrievalMetrics(goldById.get(c.id), gen.matcherDebug)
      : null;
    // Eval-only retrieval funnel diagnostics: localize where candidates collapse
    // to zero (raw -> scored -> dedupe -> pool -> final). Read-only; null when the
    // deployed function did not emit candidate_diagnostics.
    const candidateDiagnostics = gen.candidateDiagnostics || null;
    const retrievalFunnel = summarizeCandidateDiagnostics(candidateDiagnostics, {
      matcher: gen.matcherDebug || null,
    });
    results.push(buildGoldenEvalResult({
      testCase: c,
      gen,
      judged,
      gate,
      coherence,
      retrieval,
      candidateDiagnostics,
      retrievalFunnel,
      anchorClass,
      liveFactDependent: live_fact_dependent,
    }));
    const flag = c.tier === "edge" ? (gate.passed ? "gate:PASS" : "gate:FAIL") : "";
    console.log(`  [${c.id}] overall_10=${judged.overall_10} ${flag}`);
    console.log(formatCandidateDiagnosticsSummary(retrievalFunnel));
  } catch (err) {
    results.push({ id: c.id, intent: c.intent || null, tier: c.tier, status: "failed", error: err.message });
    console.error(`  [${c.id}] ERROR: ${err.message}`);
  }
}

const summary = computeAggregate(results);
const retrievalAgg = aggregateRetrievalMetrics(
  results.filter((r) => r.status === "scored" && r.retrieval).map((r) => r.retrieval),
);
const baseline = readJsonOrNull(BASELINE_PATH);
const diff = diffBaseline(summary, baseline);

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync(RUNS_DIR, { recursive: true });
const reportPath = `${RUNS_DIR}/${stamp}.json`;
writeFileSync(reportPath, JSON.stringify({ stamp, opts, summary, retrievalAgg, diff, results }, null, 2));

console.log("\n=== Aggregate ===");
console.log(summary.aggregate);
console.log("per_intent:", summary.per_intent);

if (summary.excluded_live_fact_dependent && summary.excluded_live_fact_dependent.n > 0) {
  console.log("\n=== Excluded: live_fact_dependent (unresolvable live data) ===");
  console.log({
    n: summary.excluded_live_fact_dependent.n,
    avg_overall_10: summary.excluded_live_fact_dependent.avg_overall_10,
    ids: summary.excluded_live_fact_dependent.ids,
    reason: summary.excluded_live_fact_dependent.reason,
  });
}

if (summary.coherence && summary.coherence.n > 0) {
  const coh = summary.coherence;
  console.log("\n=== Retrieval coherence ===");
  console.log({
    n: coh.n,
    grab_bag_rate: coh.grab_bag_rate,
    avg_distinct_sources: coh.avg_distinct_sources,
    avg_distinct_products: coh.avg_distinct_products,
    avg_top_source_share: coh.avg_top_source_share,
  });
  const scatterCases = results
    .filter((r) => r.status === "scored" && r.coherence)
    .sort((a, b) =>
      (b.coherence.distinct_sources - a.coherence.distinct_sources) ||
      (b.coherence.distinct_products - a.coherence.distinct_products)
    )
    .slice(0, 10)
    .filter((r) => r.coherence.is_grab_bag);
  if (scatterCases.length) {
    console.log("worst scatter (grab-bag) cases:");
    for (const r of scatterCases) {
      console.log(
        `  ${r.id}: sources=${r.coherence.distinct_sources} products=${r.coherence.distinct_products} top_share=${r.coherence.top_source_share}`,
      );
    }
  } else {
    console.log("no grab-bag cases");
  }
}
if (retrievalAgg.n_labeled > 0) {
  console.log("\n=== Retrieval precision (vs gold-labels) ===");
  console.log({
    n_labeled: retrievalAgg.n_labeled,
    recall_at_k: retrievalAgg.recall_at_k,
    precision_at_1: retrievalAgg.precision_at_1,
    mrr: retrievalAgg.mrr,
    abstention_correct: retrievalAgg.abstention_correct,
    n_abstain_cases: retrievalAgg.n_abstain_cases,
  });
} else {
  console.log("\n(no retrieval metrics — gold-labels missing or matcher not emitting yet)");
}
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
