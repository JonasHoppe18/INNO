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

import { computeAggregate, diffBaseline } from "./golden-eval-core.mjs";

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
