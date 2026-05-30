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
