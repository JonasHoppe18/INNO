// supabase/scripts/lib/golden-eval-core.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "./golden-eval-core.mjs";

test("parseArgs: defaults", () => {
  const a = parseArgs([]);
  assert.equal(a.shop, "38df5fef-2a23-47f3-803e-39f2d6f1ed99");
  assert.equal(a.tier, null);
  assert.equal(a.limit, null);
  assert.equal(a.accept, false);
});

test("parseArgs: flags", () => {
  const a = parseArgs(["--shop", "abc", "--tier", "edge", "--limit", "5", "--accept"]);
  assert.equal(a.shop, "abc");
  assert.equal(a.tier, "edge");
  assert.equal(a.limit, 5);
  assert.equal(a.accept, true);
});

test("parseArgs: rejects bad tier", () => {
  assert.throws(() => parseArgs(["--tier", "bogus"]), /tier must be/);
});

test("parseArgs: rejects missing and malformed filter values before a costly run", () => {
  assert.throws(() => parseArgs(["--set"]), /Missing value for --set/);
  assert.throws(() => parseArgs(["--limit", "0"]), /positive integer/);
  assert.throws(() => parseArgs(["--limit", "2.5"]), /positive integer/);
  assert.throws(() => parseArgs(["--intent", ","]), /at least one/);
  assert.throws(() => parseArgs(["--pq-budget", "many"]), /positive integer/);
});

import { validateCase, loadGoldenSet } from "./golden-eval-core.mjs";

const histCase = {
  id: "g-001", tier: "historical", subject: "s", body: "b",
  source_thread_id: "tid-1", human_reply: "r", language: "da", intent: "complaint",
};
const edgeCase = {
  id: "e-001", tier: "edge", subject: "s", body: "b",
  source_thread_id: null, human_reply: "r", language: "en",
  expected_action: "none", must_contain: ["photo"], must_not_contain: ["Bob"],
};

test("validateCase: accepts valid historical", () => {
  assert.deepEqual(validateCase(histCase).id, "g-001");
});

test("validateCase: accepts valid edge", () => {
  assert.deepEqual(validateCase(edgeCase).id, "e-001");
});

test("validateCase: requires id/body/human_reply", () => {
  assert.throws(() => validateCase({ ...histCase, body: "" }), /body/);
  assert.throws(() => validateCase({ ...histCase, human_reply: "" }), /human_reply/);
});

test("validateCase: historical requires source_thread_id", () => {
  assert.throws(() => validateCase({ ...histCase, source_thread_id: null }), /source_thread_id/);
});

test("validateCase: edge must have null source_thread_id", () => {
  assert.throws(() => validateCase({ ...edgeCase, source_thread_id: "x" }), /source_thread_id/);
});

test("loadGoldenSet: filters by tier and limit", () => {
  const set = { shop_id: "s", cases: [histCase, edgeCase] };
  assert.equal(loadGoldenSet(set, { tier: "edge", limit: null }).length, 1);
  assert.equal(loadGoldenSet(set, { tier: null, limit: 1 }).length, 1);
});

import { extractActionTypes, runGates } from "./golden-eval-core.mjs";

test("extractActionTypes: reads type/action_type/kind", () => {
  assert.deepEqual(
    extractActionTypes([{ type: "return" }, { action_type: "exchange" }, { kind: "refund" }]),
    ["return", "exchange", "refund"]
  );
  assert.deepEqual(extractActionTypes([]), []);
  assert.deepEqual(extractActionTypes(null), []);
});

const edge = {
  id: "e-001", tier: "edge",
  expected_action: "return", must_contain: ["photo", "30-day"], must_not_contain: ["Bob"],
};

test("runGates: passes when all conditions met", () => {
  const g = runGates("Please send a Photo so we can start the 30-DAY return.", [{ type: "return" }], edge);
  assert.equal(g.passed, true);
  assert.deepEqual(g.failures, []);
});

test("runGates: photo must_contain accepts conservative media synonyms", () => {
  const mediaTerms = [
    "photo",
    "photos",
    "picture",
    "pictures",
    "image",
    "images",
    "video",
    "videos",
    "short video",
    "video showing",
  ];

  for (const term of mediaTerms) {
    const g = runGates(
      `Please send ${term} of the issue so we can help.`,
      [{ type: "return" }],
      { ...edge, must_contain: ["photo"] },
    );
    assert.equal(g.passed, true, `${term} should satisfy must_contain photo`);
    assert.deepEqual(g.failures, []);
  }
});

test("runGates: must_not_contain photo remains strict", () => {
  const g = runGates(
    "Please send pictures or a short video of the issue.",
    [{ type: "return" }],
    { ...edge, must_contain: [], must_not_contain: ["photo"] },
  );
  assert.equal(g.passed, true);
  assert.deepEqual(g.failures, []);
});

test("runGates: photo must_contain synonyms do not match partial words", () => {
  const g = runGates(
    "Please send photography notes from the videographer.",
    [{ type: "return" }],
    { ...edge, must_contain: ["photo"] },
  );
  assert.equal(g.passed, false);
  assert.match(g.failures.join("|"), /must_contain.*photo/i);
});

test("runGates: fails missing must_contain", () => {
  const g = runGates("Send a photo please.", [{ type: "return" }], edge);
  assert.equal(g.passed, false);
  assert.match(g.failures.join("|"), /must_contain.*30-day/i);
});

test("runGates: fails on must_not_contain", () => {
  const g = runGates("Photo, 30-day, hi Bob", [{ type: "return" }], edge);
  assert.equal(g.passed, false);
  assert.match(g.failures.join("|"), /must_not_contain.*Bob/i);
});

test("runGates: expected_action none requires empty actions", () => {
  const c = { id: "e", tier: "edge", expected_action: "none" };
  assert.equal(runGates("hi", [], c).passed, true);
  assert.equal(runGates("hi", [{ type: "return" }], c).passed, false);
});

test("runGates: historical tier has no gates (always passes)", () => {
  const g = runGates("anything", [], { id: "h", tier: "historical" });
  assert.equal(g.passed, true);
});

import { buildGoldenEvalResult, computeAggregate, diffBaseline } from "./golden-eval-core.mjs";

const results = [
  { id: "g-001", intent: "complaint", status: "scored",
    scores: { correctness: 4, completeness: 4, tone: 5, actionability: 4, overall_10: 8, send_ready: false } },
  { id: "g-002", intent: "return", status: "scored",
    scores: { correctness: 3, completeness: 3, tone: 4, actionability: 3, overall_10: 6, send_ready: true } },
  { id: "g-003", intent: "complaint", status: "failed", error: "boom" },
];

test("computeAggregate: averages only scored, builds per_intent + per_case", () => {
  const a = computeAggregate(results);
  assert.equal(a.n_cases, 2);
  assert.equal(a.aggregate.overall_10, 7);          // (8+6)/2
  assert.equal(a.aggregate.tone, 4.5);              // (5+4)/2
  assert.equal(a.aggregate.send_ready_rate, 0.5);   // 1 of 2
  assert.equal(a.per_intent.complaint, 8);          // only the scored complaint
  assert.equal(a.per_case["g-001"], 8);
});

test("diffBaseline: reports aggregate deltas and regressed cases", () => {
  const current = computeAggregate(results);
  const baseline = { aggregate: { overall_10: 7.5 }, per_case: { "g-001": 9, "g-002": 6 } };
  const d = diffBaseline(current, baseline);
  assert.equal(d.aggregateDeltas.overall_10, -0.5);          // 7 - 7.5
  assert.deepEqual(d.regressedCases.map((r) => r.id), ["g-001"]); // 8 < 9; g-002 8>=6 not regressed
});

test("diffBaseline: null baseline yields no diff", () => {
  const d = diffBaseline(computeAggregate(results), null);
  assert.equal(d.aggregateDeltas, null);
  assert.deepEqual(d.regressedCases, []);
});

test("buildGoldenEvalResult: persists scan-friendly safety provenance fields", () => {
  const result = buildGoldenEvalResult({
    testCase: { id: "e-001", intent: "refund", tier: "edge" },
    gen: {
      draft: "Needs review.",
      actions: [],
      latencyMs: 123,
      routingHint: "review",
      blockSendRecommended: true,
      retrievalDebug: [],
      safety: {
        routing_hint: "review",
        block_send_recommended: true,
        live_fact_action_claim_check: {
          checked: true,
          compliant: false,
          violations: [{ type: "unsupported_refund_status" }],
          requires_review: true,
        },
        unsupported_commitment_check: {
          checked: true,
          compliant: true,
          violations: [],
          requires_review: false,
        },
        unsupported_assumption_check: {
          checked: true,
          compliant: true,
          violations: [],
          requires_review: false,
        },
        guardrails: [{ id: "live_fact_action_claim_check", status: "review" }],
      },
    },
    judged: {
      correctness: 3,
      completeness: 3,
      tone: 4,
      actionability: 3,
      overall_10: 6,
      send_ready: false,
    },
    gate: { passed: true, failures: [] },
    coherence: { n_chunks: 0 },
    retrieval: null,
    candidateDiagnostics: null,
    retrievalFunnel: { available: false },
    anchorClass: "comparable",
    liveFactDependent: false,
  });

  assert.equal(result.routing_hint, "review");
  assert.equal(result.block_send_recommended, true);
  assert.equal(result.safety.live_fact_action_claim_check.compliant, false);
  assert.deepEqual(result.safety.live_fact_action_claim_check.violations, [
    { type: "unsupported_refund_status" },
  ]);
  assert.equal(result.safety.unsupported_commitment_check.compliant, true);
  assert.equal(result.safety.unsupported_assumption_check.compliant, true);
  assert.deepEqual(result.safety.guardrails, [
    { id: "live_fact_action_claim_check", status: "review" },
  ]);
});

import { computeCoherence } from "./golden-eval-core.mjs";

test("computeCoherence: empty input is coherent", () => {
  const r = computeCoherence([]);
  assert.deepEqual(r, {
    n_chunks: 0, distinct_sources: 0, distinct_products: 0,
    top_source_share: 1, is_grab_bag: false,
  });
});

test("computeCoherence: single focused guide", () => {
  const r = computeCoherence([
    { title: "Warranty policy", source_id: "s1", products: ["a-spire"] },
    { title: "Warranty policy", source_id: "s1", products: ["a-spire"] },
  ]);
  assert.equal(r.n_chunks, 2);
  assert.equal(r.distinct_sources, 1);
  assert.equal(r.distinct_products, 1);
  assert.equal(r.top_source_share, 1);
  assert.equal(r.is_grab_bag, false);
});

test("computeCoherence: two-product scatter flags grab_bag", () => {
  const r = computeCoherence([
    { title: "Mic A-Spire", source_id: "s1", products: ["a-spire"] },
    { title: "Mic A-blaze", source_id: "s2", products: ["a-blaze"] },
  ]);
  assert.equal(r.distinct_products, 2);
  assert.equal(r.top_source_share, 0.5);
  assert.equal(r.is_grab_bag, true);
});

test("computeCoherence: three+ distinct sources flags grab_bag", () => {
  const r = computeCoherence([
    { title: "Privacy policy", source_id: "s1", products: [] },
    { title: "Shipping", source_id: "s2", products: [] },
    { title: "Terms", source_id: "s3", products: [] },
    { title: "Warranty", source_id: "s4", products: [] },
  ]);
  assert.equal(r.distinct_sources, 4);
  assert.equal(r.distinct_products, 0);
  assert.equal(r.top_source_share, 0.25);
  assert.equal(r.is_grab_bag, true);
});

test("computeCoherence: falls back to title when source_id missing", () => {
  const r = computeCoherence([
    { title: "DONGLE?", source_id: null, products: [] },
    { title: "DONGLE?", products: [] },
  ]);
  assert.equal(r.distinct_sources, 1);
  assert.equal(r.top_source_share, 1);
  assert.equal(r.is_grab_bag, false);
});

import { computeAggregate as computeAggregateForCoh } from "./golden-eval-core.mjs";

test("computeAggregate: coherence block over results", () => {
  const results = [
    { id: "g-1", status: "scored", intent: "x",
      scores: { correctness: 4, completeness: 4, tone: 4, actionability: 4, overall_10: 8, send_ready: true },
      coherence: { n_chunks: 2, distinct_sources: 1, distinct_products: 1, top_source_share: 1, is_grab_bag: false } },
    { id: "g-2", status: "scored", intent: "y",
      scores: { correctness: 3, completeness: 3, tone: 3, actionability: 3, overall_10: 6, send_ready: false },
      coherence: { n_chunks: 4, distinct_sources: 4, distinct_products: 0, top_source_share: 0.25, is_grab_bag: true } },
  ];
  const agg = computeAggregateForCoh(results);
  assert.equal(agg.coherence.n, 2);
  assert.equal(agg.coherence.grab_bag_rate, 0.5);
  assert.equal(agg.coherence.avg_distinct_sources, 2.5);
  assert.equal(agg.coherence.avg_distinct_products, 0.5);
  assert.equal(agg.coherence.avg_top_source_share, 0.63); // (1 + 0.25) / 2 = 0.625 → round2
  assert.deepEqual(agg.coherence.per_case["g-2"], {
    is_grab_bag: true, distinct_sources: 4, distinct_products: 0,
  });
});

test("computeAggregate: coherence block is zeros when results lack coherence", () => {
  const results = [
    { id: "g-1", status: "scored", intent: "x",
      scores: { correctness: 4, completeness: 4, tone: 4, actionability: 4, overall_10: 8, send_ready: true } },
  ];
  const agg = computeAggregateForCoh(results);
  assert.equal(agg.coherence.n, 0);
  assert.equal(agg.coherence.grab_bag_rate, 0);
  assert.deepEqual(agg.coherence.per_case, {});
});

import {
  computeRetrievalMetrics,
  aggregateRetrievalMetrics,
} from "./golden-eval-core.mjs";

test("computeRetrievalMetrics: recall hit, precision@1 hit, MRR 1", () => {
  const gold = ["snip-a"];
  const matcher = {
    candidates: [
      { id: "c1", source_id: "snip-a", title: "EQ" },
      { id: "c2", source_id: "snip-b", title: "Pairing" },
    ],
    ranked: [
      { id: "c1", source_id: "snip-a", title: "EQ", relevance: 0.8 },
      { id: "c2", source_id: "snip-b", title: "Pairing", relevance: 0.4 },
    ],
    selected_ids: ["c1"],
    abstained: false,
  };
  const m = computeRetrievalMetrics(gold, matcher);
  assert.equal(m.gold_empty, false);
  assert.equal(m.recall_at_k, 1);
  assert.equal(m.precision_at_1, 1);
  assert.equal(m.mrr, 1);
  assert.equal(m.abstention_correct, null);
});

test("computeRetrievalMetrics: correct ranked second → precision@1 0, MRR 0.5", () => {
  const gold = ["snip-a"];
  const matcher = {
    candidates: [
      { id: "c2", source_id: "snip-b", title: "Pairing" },
      { id: "c1", source_id: "snip-a", title: "EQ" },
    ],
    ranked: [
      { id: "c2", source_id: "snip-b", title: "Pairing", relevance: 0.7 },
      { id: "c1", source_id: "snip-a", title: "EQ", relevance: 0.65 },
    ],
    selected_ids: ["c2"],
    abstained: false,
  };
  const m = computeRetrievalMetrics(gold, matcher);
  assert.equal(m.recall_at_k, 1);
  assert.equal(m.precision_at_1, 0);
  assert.equal(m.mrr, 0.5);
});

test("computeRetrievalMetrics: correct not in pool → recall 0, MRR 0", () => {
  const gold = ["snip-z"];
  const matcher = {
    candidates: [{ id: "c1", source_id: "snip-a", title: "EQ" }],
    ranked: [{ id: "c1", source_id: "snip-a", title: "EQ", relevance: 0.9 }],
    selected_ids: ["c1"],
    abstained: false,
  };
  const m = computeRetrievalMetrics(gold, matcher);
  assert.equal(m.recall_at_k, 0);
  assert.equal(m.precision_at_1, 0);
  assert.equal(m.mrr, 0);
});

test("computeRetrievalMetrics: gold empty + abstained → abstention correct, recall null", () => {
  const matcher = {
    candidates: [{ id: "c1", source_id: "snip-a", title: "Mic" }],
    ranked: [{ id: "c1", source_id: "snip-a", title: "Mic", relevance: 0.3 }],
    selected_ids: [],
    abstained: true,
  };
  const m = computeRetrievalMetrics([], matcher);
  assert.equal(m.gold_empty, true);
  assert.equal(m.abstention_correct, 1);
  assert.equal(m.recall_at_k, null);
  assert.equal(m.precision_at_1, null);
  assert.equal(m.mrr, null);
});

test("computeRetrievalMetrics: gold empty but selected something → abstention wrong", () => {
  const matcher = {
    candidates: [{ id: "c1", source_id: "snip-a", title: "Mic" }],
    ranked: [{ id: "c1", source_id: "snip-a", title: "Mic", relevance: 0.7 }],
    selected_ids: ["c1"],
    abstained: false,
  };
  const m = computeRetrievalMetrics([], matcher);
  assert.equal(m.abstention_correct, 0);
});

test("computeRetrievalMetrics: identity falls back to title when source_id null", () => {
  const gold = ["why can't i change my eq"];
  const matcher = {
    candidates: [{ id: "c1", source_id: null, title: "Why can't I change my EQ" }],
    ranked: [{ id: "c1", source_id: null, title: "Why can't I change my EQ", relevance: 0.8 }],
    selected_ids: ["c1"],
    abstained: false,
  };
  const m = computeRetrievalMetrics(gold, matcher);
  assert.equal(m.recall_at_k, 1);
  assert.equal(m.precision_at_1, 1);
});

test("aggregateRetrievalMetrics: averages over non-null, counts abstention", () => {
  const per = [
    { gold_empty: false, recall_at_k: 1, precision_at_1: 1, mrr: 1, abstention_correct: null },
    { gold_empty: false, recall_at_k: 1, precision_at_1: 0, mrr: 0.5, abstention_correct: null },
    { gold_empty: true, recall_at_k: null, precision_at_1: null, mrr: null, abstention_correct: 1 },
    { gold_empty: true, recall_at_k: null, precision_at_1: null, mrr: null, abstention_correct: 0 },
  ];
  const agg = aggregateRetrievalMetrics(per);
  assert.equal(agg.n_labeled, 4);
  assert.equal(agg.recall_at_k, 1);      // 2/2
  assert.equal(agg.precision_at_1, 0.5); // 1/2
  assert.equal(agg.mrr, 0.75);           // (1+0.5)/2
  assert.equal(agg.abstention_correct, 0.5); // 1/2
  assert.equal(agg.n_abstain_cases, 2);
});

// --- cost-control: --set + unknown-flag guard (the 44-vs-10 bug) ---
import { readFileSync } from "node:fs";
import { resolveSetPath } from "./golden-eval-core.mjs";

const FULL_SET = "supabase/eval/golden-set.acezone.json";
const PILOT_SET = "supabase/eval/pilot-set.acezone.json";
const loadFile = (p) => JSON.parse(readFileSync(p, "utf8"));

test("parseArgs: captures --set, defaults to null", () => {
  assert.equal(parseArgs(["--set", PILOT_SET]).set, PILOT_SET);
  assert.equal(parseArgs([]).set, null);
});

test("parseArgs: fails loudly on unknown / misspelled flags", () => {
  assert.throws(() => parseArgs(["--bogus"]), /Unknown argument: --bogus/);
  assert.throws(() => parseArgs(["--sett", PILOT_SET]), /Unknown argument: --sett/);
  assert.doesNotThrow(() => parseArgs(["--set", PILOT_SET, "--limit", "3"]));
});

test("resolveSetPath: returns subset when it exists", () => {
  assert.equal(
    resolveSetPath({ set: PILOT_SET }, { defaultPath: FULL_SET, existsSync: (p) => p === PILOT_SET }),
    PILOT_SET,
  );
});

test("resolveSetPath: missing --set file throws (no silent fallback to 44)", () => {
  assert.throws(
    () => resolveSetPath({ set: "supabase/eval/nope.json" }, { defaultPath: FULL_SET, existsSync: () => false }),
    /--set file not found/,
  );
});

test("resolveSetPath: no --set uses default full set", () => {
  assert.equal(resolveSetPath({ set: null }, { defaultPath: FULL_SET, existsSync: () => false }), FULL_SET);
});

test("--set loads exactly the 10-case pilot; default loads all 44", () => {
  assert.equal(loadGoldenSet(loadFile(PILOT_SET), {}).length, 10);
  assert.equal(loadGoldenSet(loadFile(FULL_SET), {}).length, 44);
});

// ---------------------------------------------------------------------------
// summarizeCandidateDiagnostics — retrieval funnel observability
// ---------------------------------------------------------------------------
import {
  summarizeCandidateDiagnostics,
  formatCandidateDiagnosticsSummary,
} from "./golden-eval-core.mjs";

// Minimal candidate_diagnostics fixture builder mirroring the shape emitted by
// generate-draft-v2's buildRetrievalCandidateDiagnostics.
function makeDiag({ raw = [], scored = [], postDedupe = [], pool = [], final = [], abstain = null } = {}) {
  return {
    planner_queries: ["q"],
    fallback_queries: [],
    query_results: raw.map((r, i) => ({
      query: "q",
      query_index: 0,
      source: "vector",
      chunk_id: r.id,
      raw_rank: i + 1,
      raw_score: r.score,
      source_type: r.source_type ?? "document",
      usable_as: r.usable_as ?? "policy",
      title: r.title,
      question: null,
      products: [],
      issue_types: [],
    })),
    merged_candidates_pre_score: raw.map((r) => ({
      chunk_id: r.id, vector_rank: 1, bm25_rank: null, rrf_score: r.score,
    })),
    scored_candidates_pre_dedupe: scored.map((id) => ({ chunk_id: id, final_score: 1 })),
    candidates_post_dedupe: postDedupe,
    matcher_pool_top15: pool,
    matcher_selected_ids: final,
    matcher_abstain: abstain,
    final_selected_ids: final,
  };
}

const GEN = { id: "gen-1", title: "Missing accessories and spare parts", score: 0.81 };
const OTHER = { id: "x-1", title: "A-Spire pairing guide", source_type: "document", usable_as: "guide", score: 0.42 };

test("summarizeCandidateDiagnostics: null/garbage input => not available", () => {
  assert.deepEqual(summarizeCandidateDiagnostics(null), { available: false });
  assert.deepEqual(summarizeCandidateDiagnostics(undefined), { available: false });
  assert.deepEqual(summarizeCandidateDiagnostics("nope"), { available: false });
});

test("summarizeCandidateDiagnostics: counts the full funnel", () => {
  const cd = makeDiag({
    raw: [GEN, OTHER],
    scored: ["gen-1", "x-1"],
    postDedupe: ["gen-1", "x-1"],
    pool: ["gen-1", "x-1"],
    final: ["x-1"],
    abstain: false,
  });
  const s = summarizeCandidateDiagnostics(cd, { matcher: { fell_back: false } });
  assert.equal(s.available, true);
  assert.equal(s.distinct_raw_candidates, 2);
  assert.equal(s.scored, 2);
  assert.equal(s.post_dedupe, 2);
  assert.equal(s.pool, 2);
  assert.equal(s.final, 1);
  assert.equal(s.matcher_abstain, false);
  assert.equal(s.fell_back, false);
  // Top candidate is the higher raw_score (General doc).
  assert.equal(s.top_candidates[0].chunk_id, "gen-1");
  assert.equal(s.top_candidates[0].title, "Missing accessories and spare parts");
});

test("summarizeCandidateDiagnostics: General doc dropped by gate (before pool)", () => {
  const cd = makeDiag({
    raw: [GEN, OTHER],
    scored: ["x-1"],        // General doc gated out at scoring
    postDedupe: ["x-1"],
    pool: ["x-1"],
    final: [],
    abstain: false,
  });
  const s = summarizeCandidateDiagnostics(cd);
  const gen = s.tracked.find((t) => t.key === "gen-1");
  assert.ok(gen, "General doc traced");
  assert.equal(gen.raw, true);
  assert.equal(gen.scored, false);
  assert.equal(gen.final, false);
  assert.equal(gen.ever_seen, true);
  assert.equal(gen.dropped_after, "raw"); // present in raw, gone by scored
});

test("summarizeCandidateDiagnostics: General doc in pool but matcher abstains", () => {
  const cd = makeDiag({
    raw: [GEN, OTHER],
    scored: ["gen-1", "x-1"],
    postDedupe: ["gen-1", "x-1"],
    pool: ["gen-1", "x-1"],
    final: [],              // matcher selected nothing
    abstain: true,
  });
  const s = summarizeCandidateDiagnostics(cd);
  assert.equal(s.matcher_abstain, true);
  assert.equal(s.final, 0);
  const gen = s.tracked.find((t) => t.key === "gen-1");
  assert.equal(gen.pool, true);
  assert.equal(gen.final, false);
  assert.equal(gen.dropped_after, "pool");
});

test("summarizeCandidateDiagnostics: General doc reaches the writer", () => {
  const cd = makeDiag({
    raw: [GEN, OTHER],
    scored: ["gen-1", "x-1"],
    postDedupe: ["gen-1", "x-1"],
    pool: ["gen-1", "x-1"],
    final: ["gen-1"],
    abstain: false,
  });
  const s = summarizeCandidateDiagnostics(cd);
  const gen = s.tracked.find((t) => t.key === "gen-1");
  assert.equal(gen.final, true);
  assert.equal(gen.dropped_after, null);
});

test("summarizeCandidateDiagnostics: empty funnel (n_chunks=0 with no candidates)", () => {
  const cd = makeDiag({ raw: [], scored: [], pool: [], final: [] });
  const s = summarizeCandidateDiagnostics(cd);
  assert.equal(s.distinct_raw_candidates, 0);
  assert.equal(s.final, 0);
  assert.deepEqual(s.tracked, []);
});

test("summarizeCandidateDiagnostics: explicit trackChunkIds override", () => {
  const cd = makeDiag({
    raw: [{ id: "z-9", title: "Unlabelled chunk", score: 0.5 }],
    scored: [], pool: [], final: [],
  });
  const s = summarizeCandidateDiagnostics(cd, { trackChunkIds: ["z-9"] });
  const z = s.tracked.find((t) => t.key === "z-9");
  assert.ok(z);
  assert.equal(z.raw, true);
  assert.equal(z.dropped_after, "raw");
});

test("formatCandidateDiagnosticsSummary: unavailable + rendered lines", () => {
  assert.match(
    formatCandidateDiagnosticsSummary({ available: false }),
    /no candidate_diagnostics/,
  );
  const cd = makeDiag({
    raw: [GEN, OTHER], scored: ["x-1"], postDedupe: ["x-1"], pool: ["x-1"], final: [], abstain: false,
  });
  const out = formatCandidateDiagnosticsSummary(summarizeCandidateDiagnostics(cd));
  assert.match(out, /retrieval funnel: raw=2/);
  assert.match(out, /final=0/);
  assert.match(out, /dropped after raw/);
});

// ---------------------------------------------------------------------------
// Fix B: policy_fallback surfaced from matcher_debug into the funnel summary
// ---------------------------------------------------------------------------
test("summarizeCandidateDiagnostics: policy_fallback surfaced from opts.matcher", () => {
  const cd = makeDiag({
    raw: [GEN, OTHER],
    scored: ["gen-1", "x-1"],
    postDedupe: ["gen-1", "x-1"],
    pool: ["gen-1", "x-1"],
    final: ["gen-1"],
    abstain: true,
  });
  const s = summarizeCandidateDiagnostics(cd, {
    matcher: {
      abstained: true,
      fell_back: false,
      policy_fallback: true,
      policy_fallback_count: 1,
      policy_fallback_score_basis: "retrieval_score",
    },
  });
  assert.equal(s.policy_fallback, true);
  assert.equal(s.policy_fallback_count, 1);
  assert.equal(s.policy_fallback_score_basis, "retrieval_score");
  const out = formatCandidateDiagnosticsSummary(s);
  assert.match(out, /policy_fallback=true\(1\) basis=retrieval_score/);
});

test("summarizeCandidateDiagnostics: policy_fallback null when matcher omits it", () => {
  const cd = makeDiag({ raw: [GEN], scored: ["gen-1"], pool: ["gen-1"], final: [] });
  const s = summarizeCandidateDiagnostics(cd, { matcher: { fell_back: false } });
  assert.equal(s.policy_fallback, null);
  assert.equal(s.policy_fallback_count, null);
  assert.equal(s.policy_fallback_score_basis, null);
});

// ---------------------------------------------------------------------------
// Reproducibility, manual quality gates, baseline acceptance, and leakage
// ---------------------------------------------------------------------------
import {
  assessTicketExampleLeakage,
  baselineCompatibility,
  buildDatasetProvenance,
  buildReviewedGoldLabelMap,
  overlayBenchmarkMetadata,
  selectGoldenCases,
  sha256Json,
  validateBaselineAcceptance,
  goldenEvalExitCode,
} from "./golden-eval-core.mjs";
import {
  buildTicketExampleTraceFromGenerateDraftV2Response,
  getJudgeMetadata,
} from "../../../apps/web/lib/server/eval-runner.js";

test("manual benchmark metadata excludes inactive and EXCLUDE cases", () => {
  const set = { cases: [histCase, edgeCase] };
  const reviewed = {
    cases: [
      {
        source_case_id: "e-001",
        benchmark_status: "EXCLUDE",
        manual_reviewed: true,
        is_active: false,
        review_notes: "bad facit",
      },
    ],
  };
  const selected = selectGoldenCases(overlayBenchmarkMetadata(set, reviewed));
  assert.deepEqual(selected.cases.map((c) => c.id), ["g-001"]);
  assert.deepEqual(selected.qualityGateExclusions, [{
    id: "e-001",
    benchmark_status: "EXCLUDE",
    reason: "benchmark_status=EXCLUDE",
    review_notes: "bad facit",
  }]);
});

test("AceZone authoritative review removes e-002 and all inactive review cases", () => {
  const full = loadFile(FULL_SET);
  const review = loadFile("supabase/eval/gold-eval-cases.acezone.json");
  const selected = selectGoldenCases(overlayBenchmarkMetadata(full, review));
  assert.equal(selected.cases.length, 37);
  assert.equal(selected.cases.some((c) => c.id === "e-002"), false);
  assert.deepEqual(
    selected.qualityGateExclusions.map((c) => c.id).sort(),
    ["e-002", "g-005", "g-008", "g-015", "g-031", "g-032", "g-044"],
  );
});

test("dataset provenance hashes the selected content and cohort deterministically", () => {
  const args = {
    set: { shop_id: "s", cases: [histCase] },
    cases: [histCase],
    setPath: "set.json",
    setSourceText: "{\"cases\":[]}",
    reviewSourceText: "{\"cases\":[]}",
    opts: { set: null, tier: null, limit: null, intent: null },
  };
  const first = buildDatasetProvenance(args);
  const second = buildDatasetProvenance(args);
  assert.equal(first.schema_version, "golden-file-selection-v2");
  assert.match(first.selected_sha256, /^[a-f0-9]{64}$/);
  assert.equal(first.selected_sha256, second.selected_sha256);
  assert.equal(first.cohort_sha256, second.cohort_sha256);

  const changed = buildDatasetProvenance({
    ...args,
    cases: [{ ...histCase, body: "changed" }],
  });
  assert.notEqual(changed.selected_sha256, first.selected_sha256);
  assert.equal(sha256Json({ b: 2, a: 1 }), sha256Json({ a: 1, b: 2 }));
  const otherShop = buildDatasetProvenance({
    ...args,
    opts: { ...args.opts, shop: "other-shop" },
  });
  assert.notEqual(otherShop.cohort_sha256, first.cohort_sha256);
});

test("baseline comparison requires matching cohort, dataset, and judge", () => {
  const provenance = {
    dataset: { cohort_sha256: "cohort", selected_sha256: "dataset" },
    judge: { model: "gpt-4o-mini", definition_sha256: "judge" },
  };
  const baseline = { provenance };
  assert.deepEqual(baselineCompatibility(provenance, baseline), {
    compatible: true,
    mismatches: [],
  });
  const mismatch = baselineCompatibility(
    { ...provenance, dataset: { ...provenance.dataset, selected_sha256: "other" } },
    baseline,
  );
  assert.equal(mismatch.compatible, false);
  assert.match(mismatch.mismatches.join("|"), /selected dataset hash differs/);
  assert.equal(baselineCompatibility(provenance, {}).compatible, false);
  assert.equal(
    baselineCompatibility(provenance, {
      provenance: { dataset: {}, judge: {} },
    }).compatible,
    false,
  );

  const current = computeAggregate(results);
  const baselineWithScores = {
    ...baseline,
    aggregate: { overall_10: 7 },
    per_case: { "g-001": 8 },
  };
  assert.notEqual(
    diffBaseline(current, baselineWithScores, provenance).aggregateDeltas,
    null,
  );
  assert.equal(
    diffBaseline(current, baselineWithScores, {
      ...provenance,
      judge: { ...provenance.judge, definition_sha256: "new-judge" },
    }).aggregateDeltas,
    null,
  );
});

test("--accept is fail-closed for subsets, generation errors, gates, and integrity", () => {
  const clean = validateBaselineAcceptance({ scoredRuns: 37 });
  assert.equal(clean.allowed, true);

  for (const opts of [
    { set: "pilot.json" },
    { tier: "edge" },
    { limit: 2 },
    { intent: ["complaint"] },
  ]) {
    const result = validateBaselineAcceptance({ opts, scoredRuns: 2 });
    assert.equal(result.allowed, false);
    assert.match(result.reasons.join("|"), /subset|filters|cohort/);
  }

  const broken = validateBaselineAcceptance({
    scoredRuns: 10,
    failedRuns: 1,
    gateFailures: 2,
    integrityFailures: 3,
  });
  assert.equal(broken.allowed, false);
  assert.match(broken.reasons.join("|"), /generation\/judge/);
  assert.match(broken.reasons.join("|"), /edge gate/);
  assert.match(broken.reasons.join("|"), /eval-integrity/);

  const wrongShop = validateBaselineAcceptance({
    scoredRuns: 10,
    runShopId: "shop-b",
    datasetShopId: "shop-a",
  });
  assert.equal(wrongShop.allowed, false);
  assert.match(wrongShop.reasons.join("|"), /dataset shop/);

  assert.equal(goldenEvalExitCode(), 0);
  assert.equal(goldenEvalExitCode({ failedRuns: 1 }), 1);
  assert.equal(goldenEvalExitCode({ gateFailures: 1 }), 1);
  assert.equal(goldenEvalExitCode({ integrityFailures: 1 }), 1);
  assert.equal(goldenEvalExitCode({ acceptRejected: true }), 1);
});

test("retrieval metrics include only explicitly human-reviewed labels", () => {
  const labels = buildReviewedGoldLabelMap({ labels: [
    { id: "proposed", correct_snippet_ids: ["x"], _needs_human_review: true },
    { id: "approved", correct_snippet_ids: ["y"], _needs_human_review: false },
    { id: "approved-2", correct_snippet_ids: [], review_status: "approved" },
    {
      id: "conflicting",
      correct_snippet_ids: ["q"],
      _needs_human_review: true,
      review_status: "approved",
    },
    { id: "unknown", correct_snippet_ids: ["z"] },
  ] });
  assert.deepEqual([...labels.byId.keys()], ["approved", "approved-2"]);
  assert.deepEqual(
    labels.skippedUnreviewedIds,
    ["proposed", "conflicting", "unknown"],
  );
});

test("ticket-example trace parser is backward-compatible but rejects partial telemetry", () => {
  const legacy = buildTicketExampleTraceFromGenerateDraftV2Response({
    retrieval_debug: { chunks: [] },
  });
  assert.equal(legacy.telemetry_status, "legacy_unavailable");
  assert.equal(assessTicketExampleLeakage(legacy).passed, true);

  const partial = buildTicketExampleTraceFromGenerateDraftV2Response({
    retrieval_debug: { ticket_examples: [] },
  });
  assert.equal(partial.telemetry_status, "invalid");
  assert.equal(assessTicketExampleLeakage(partial).passed, false);

  const malformed = buildTicketExampleTraceFromGenerateDraftV2Response({
    retrieval_debug: {
      ticket_examples: [{ id: "9" }],
      ticket_example_exclusions: {
        external_id_matches: [],
        duplicate_question_matches: [],
      },
    },
  });
  assert.equal(malformed.telemetry_status, "invalid");
  assert.equal(assessTicketExampleLeakage({
    telemetry_status: "available",
    selected_ids: [],
    exclusions: null,
  }).passed, false);
});

test("ticket-example leakage check captures IDs and fails on excluded intersection", () => {
  const trace = buildTicketExampleTraceFromGenerateDraftV2Response({
    retrieval_debug: {
      ticket_examples: [{ id: 9 }, { id: 7 }],
      ticket_example_exclusions: {
        external_id_matches: [9],
        duplicate_question_matches: [11],
      },
    },
  });
  const check = assessTicketExampleLeakage(trace);
  assert.equal(trace.telemetry_status, "available");
  assert.equal(check.passed, false);
  assert.deepEqual(check.selected_ids, [7, 9]);
  assert.deepEqual(check.leaked_ids, [9]);

  const clean = assessTicketExampleLeakage({
    ...trace,
    selected_ids: [7],
  });
  assert.equal(clean.passed, true);
  assert.deepEqual(clean.leaked_ids, []);
});

test("judge metadata is stable, versioned, and hashes the judge definition", () => {
  const first = getJudgeMetadata("gpt-4o-mini");
  const second = getJudgeMetadata("gpt-4o-mini");
  assert.match(first.version, /^sona-golden-judge-/);
  assert.match(first.definition_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(first, second);
});
