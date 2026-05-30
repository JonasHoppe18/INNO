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
