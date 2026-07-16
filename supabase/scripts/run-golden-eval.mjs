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
//   node supabase/scripts/run-golden-eval.mjs --accept        # accept a complete, clean full run only
//
// Exit code: non-zero on generation/judge errors, eval-integrity failures, or
// edge-gate failures. Baseline regressions are reported, not fatal.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import {
  parseArgs, overlayBenchmarkMetadata, selectGoldenCases, runGates,
  computeAggregate, diffBaseline, computeCoherence,
  computeRetrievalMetrics, aggregateRetrievalMetrics, resolveSetPath,
  summarizeCandidateDiagnostics, formatCandidateDiagnosticsSummary,
  buildGoldenEvalResult, buildDatasetProvenance, buildReviewedGoldLabelMap,
  assessTicketExampleLeakage, validateBaselineAcceptance, sha256Text,
  goldenEvalExitCode,
} from "./lib/golden-eval-core.mjs";
import {
  generateDraftV2, judgeWithOpenAI, draftForJudge, getJudgeMetadata,
} from "../../apps/web/lib/server/eval-runner.js";
import { classifyAnchor } from "../../apps/web/lib/server/eval-anchor.js";
import { classifyLiveFactDependency } from "../../apps/web/lib/server/eval-live-fact.js";

const SET_PATH = "supabase/eval/golden-set.acezone.json";
const BASELINE_PATH = "supabase/eval/golden-baseline.acezone.json";
const RUNS_DIR = "supabase/eval/runs";
const GOLD_LABELS_PATH = "supabase/eval/gold-labels.acezone.json";
const REVIEW_METADATA_PATH = "supabase/eval/gold-eval-cases.acezone.json";
const JUDGE_MODEL = "gpt-4o-mini";

function readJsonOrNull(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

const opts = parseArgs(process.argv.slice(2));
// --set targets a curated subset (e.g. the 10-case pilot). A missing --set file
// throws instead of silently running the full golden set.
const setPath = resolveSetPath(opts, { defaultPath: SET_PATH, existsSync });
const setSourceText = readFileSync(setPath, "utf8");
const baseSet = JSON.parse(setSourceText);
if (!existsSync(REVIEW_METADATA_PATH)) {
  throw new Error(`Manual review metadata not found: ${REVIEW_METADATA_PATH}`);
}
const reviewSourceText = readFileSync(REVIEW_METADATA_PATH, "utf8");
const reviewMetadata = JSON.parse(reviewSourceText);
const set = overlayBenchmarkMetadata(baseSet, reviewMetadata);
const selection = selectGoldenCases(set, {
  tier: opts.tier,
  limit: opts.limit,
  intent: opts.intent,
});
const cases = selection.cases;
const dataset = buildDatasetProvenance({
  set,
  cases,
  setPath,
  setSourceText,
  reviewSourceText,
  opts,
});
const judge = getJudgeMetadata(JUDGE_MODEL);
const provenance = { dataset, judge };
if (opts.accept) {
  const preflight = validateBaselineAcceptance({
    opts,
    scoredRuns: 1,
    runShopId: opts.shop,
    datasetShopId: set.shop_id ?? null,
  });
  if (!preflight.allowed) {
    throw new Error(
      `--accept requires the unfiltered full dataset: ${preflight.reasons.join("; ")}`,
    );
  }
}
console.log(`Case set: ${setPath} (${cases.length} cases)`);
if (selection.qualityGateExclusions.length) {
  console.log(
    `Manual quality gate excluded ${selection.qualityGateExclusions.length}: ${
      selection.qualityGateExclusions.map((entry) => entry.id).join(", ")
    }`,
  );
}
const goldLabelsSourceText = existsSync(GOLD_LABELS_PATH)
  ? readFileSync(GOLD_LABELS_PATH, "utf8")
  : null;
const goldLabels = goldLabelsSourceText
  ? JSON.parse(goldLabelsSourceText)
  : null;
const reviewedGold = buildReviewedGoldLabelMap(goldLabels);
const goldById = reviewedGold.byId;
const retrievalGoldLabels = {
  path: GOLD_LABELS_PATH,
  source_sha256: goldLabelsSourceText == null
    ? null
    : sha256Text(goldLabelsSourceText),
  reviewed_count: reviewedGold.reviewedIds.length,
  reviewed_ids: reviewedGold.reviewedIds,
  skipped_unreviewed_count: reviewedGold.skippedUnreviewedIds.length,
  skipped_unreviewed_ids: reviewedGold.skippedUnreviewedIds,
};
console.log(
  `Retrieval gold labels: ${retrievalGoldLabels.reviewed_count} reviewed, ` +
    `${retrievalGoldLabels.skipped_unreviewed_count} unreviewed skipped`,
);
console.log(`Running ${cases.length} cases against deployed generate-draft-v2 (shop ${opts.shop})`);

const results = [];
let gateFailures = 0;
let integrityFailures = 0;
let legacyTraceWarnings = 0;
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
    const leakage = assessTicketExampleLeakage(gen.ticketExampleTrace);
    if (leakage.status === "legacy_unavailable") legacyTraceWarnings++;
    if (!leakage.passed) {
      integrityFailures++;
      results.push({
        id: c.id,
        intent: c.intent || null,
        tier: c.tier,
        status: "integrity_failed",
        ticket_example_trace: gen.ticketExampleTrace,
        leakage_check: leakage,
      });
      console.error(`  [${c.id}] INTEGRITY ERROR: ${leakage.failures.join("; ")}`);
      continue;
    }
    const anchorClass = c.anchor_class ||
      classifyAnchor({ humanReply: c.human_reply }).anchor_class;
    const judgeHuman = anchorClass === "non_comparable_anchor" ? null : c.human_reply;
    const judged = await judgeWithOpenAI(
      c.body, draftForJudge(gen.draft, gen.actions), judgeHuman, JUDGE_MODEL, anchorClass,
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
      ticketExampleTrace: gen.ticketExampleTrace,
      leakage,
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
const diff = diffBaseline(summary, baseline, provenance);

const failedRuns = results.filter((r) => r.status === "failed").length;
const scoredRuns = results.filter((r) => r.status === "scored").length;
const acceptance = validateBaselineAcceptance({
  opts,
  failedRuns,
  gateFailures,
  integrityFailures,
  scoredRuns,
  runShopId: opts.shop,
  datasetShopId: set.shop_id ?? null,
});

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync(RUNS_DIR, { recursive: true });
const reportPath = `${RUNS_DIR}/${stamp}.json`;
writeFileSync(reportPath, JSON.stringify({
  stamp,
  opts,
  provenance,
  selection: {
    quality_gate_exclusions: selection.qualityGateExclusions,
  },
  retrievalGoldLabels,
  summary,
  retrievalAgg,
  diff,
  integrity: {
    failures: integrityFailures,
    legacy_trace_warnings: legacyTraceWarnings,
  },
  acceptance,
  results,
}, null, 2));

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
  const retrievalReason = retrievalGoldLabels.reviewed_count === 0
    ? "no human-reviewed retrieval labels (unreviewed proposals were skipped)"
    : "reviewed gold-labels missing from this cohort or matcher not emitting";
  console.log(`\n(no retrieval metrics — ${retrievalReason})`);
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
  const why = diff.mismatchReasons?.length
    ? `: ${diff.mismatchReasons.join("; ")}`
    : "";
  console.log(`\n(no comparable baseline${why})`);
}
if (legacyTraceWarnings > 0) {
  console.warn(
    `\nWARNING: ${legacyTraceWarnings} case(s) came from an older deployed ` +
      "generate-draft-v2 without ticket-example trace; leakage was not verifiable.",
  );
}
console.log(
  `\nReport: ${reportPath} | scored=${summary.n_cases} failed=${failedRuns} ` +
    `gateFailures=${gateFailures} integrityFailures=${integrityFailures}`,
);

let acceptRejected = false;
if (opts.accept) {
  if (!acceptance.allowed) {
    acceptRejected = true;
    console.error("Baseline NOT updated:");
    for (const reason of acceptance.reasons) console.error(`  - ${reason}`);
  } else {
    const newBaseline = {
      accepted_at: new Date().toISOString(),
      provenance,
      n_cases: summary.n_cases,
      aggregate: summary.aggregate,
      per_intent: summary.per_intent,
      per_case: summary.per_case,
    };
    writeFileSync(BASELINE_PATH, JSON.stringify(newBaseline, null, 2));
    console.log(`Baseline updated: ${BASELINE_PATH}`);
  }
}

process.exit(goldenEvalExitCode({
  failedRuns,
  gateFailures,
  integrityFailures,
  acceptRejected,
}));
