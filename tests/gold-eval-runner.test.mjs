// Run with: node --test tests/
//
// Documents the Phase 2 gold-eval guarantees:
//   - eval-mode does not write customer tables (generate is injectable)
//   - generation_id couples result to the generation trace
//   - intent comparison: normalized match, null when no expected_intent
//   - retrieval hit@k: correct across k values, null when no gold ids
//   - runner summary: accuracy/hit-at-k aggregation
//   - inactive cases are skipped
//   - workspace/shop scoping loads only matching cases

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  compareIntent,
  computeRetrievalHitAtK,
  gradeRuntimeIntent,
  normalizeIntent,
  RUNTIME_INTENT_TAXONOMY,
  runGoldEval,
} from "../apps/web/lib/server/gold-eval-runner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VALID_GRADING_MODES = ["content_only", "order_context_required"];

// ---------------------------------------------------------------------------
// compareIntent
// ---------------------------------------------------------------------------

test("compareIntent: exact match (normalized)", () => {
  const { intentCorrect, actualIntent } = compareIntent("order_status", "order_status");
  assert.equal(intentCorrect, true);
  assert.equal(actualIntent, "order_status");
});

test("normalizeIntent: request aliases normalize only naming differences", () => {
  assert.equal(normalizeIntent("return"), "return_request");
  assert.equal(normalizeIntent("return_request"), "return_request");
  assert.equal(normalizeIntent("refund"), "refund_request");
  assert.equal(normalizeIntent("refund_request"), "refund_request");
  assert.equal(normalizeIntent("exchange"), "exchange_request");
  assert.equal(normalizeIntent("exchange_request"), "exchange_request");
});

test("normalizeIntent: complaint/tracking/unknown are not hidden as aliases", () => {
  assert.equal(normalizeIntent("complaint"), "complaint");
  assert.equal(normalizeIntent("technical_support"), "technical_support");
  assert.equal(normalizeIntent("tracking"), "tracking");
  assert.equal(normalizeIntent("order_status"), "order_status");
  assert.equal(normalizeIntent("unknown"), "unknown");
  assert.equal(normalizeIntent("unclear"), "unclear");
});

test("compareIntent: case-insensitive + trim", () => {
  const { intentCorrect } = compareIntent("  ORDER_STATUS ", "order_status");
  assert.equal(intentCorrect, true);
});

test("compareIntent: mismatch returns false", () => {
  const { intentCorrect } = compareIntent("return", "order_status");
  assert.equal(intentCorrect, false);
});

test("compareIntent: refund alias matches refund_request", () => {
  const { intentCorrect, actualIntentRaw, actualIntentNormalized, actualIntent } = compareIntent(
    "refund_request",
    "refund",
  );
  assert.equal(intentCorrect, true);
  assert.equal(actualIntentRaw, "refund");
  assert.equal(actualIntentNormalized, "refund_request");
  assert.equal(actualIntent, "refund_request");
});

test("compareIntent: exchange alias matches exchange_request", () => {
  const { intentCorrect } = compareIntent("exchange_request", "exchange");
  assert.equal(intentCorrect, true);
});

test("compareIntent: return alias matches return_request", () => {
  const { intentCorrect } = compareIntent("return_request", "return");
  assert.equal(intentCorrect, true);
});

test("compareIntent: complaint is not an alias for technical_support", () => {
  const { intentCorrect, actualIntentRaw, actualIntentNormalized } = compareIntent(
    "technical_support",
    "complaint",
  );
  assert.equal(intentCorrect, false);
  assert.equal(actualIntentRaw, "complaint");
  assert.equal(actualIntentNormalized, "complaint");
});

test("compareIntent: tracking is not an alias for order_status", () => {
  const { intentCorrect } = compareIntent("order_status", "tracking");
  assert.equal(intentCorrect, false);
});

test("compareIntent: unknown is not an alias for unclear", () => {
  const { intentCorrect } = compareIntent("unclear", "unknown");
  assert.equal(intentCorrect, false);
});

test("compareIntent: no expected_intent → null (not graded)", () => {
  const { intentCorrect } = compareIntent(null, "order_status");
  assert.equal(intentCorrect, null);
});

test("compareIntent: empty expected_intent → null (not graded)", () => {
  const { intentCorrect } = compareIntent("", "order_status");
  assert.equal(intentCorrect, null);
});

test("gradeRuntimeIntent: planner taxonomy is explicit and stable", () => {
  assert.deepEqual(RUNTIME_INTENT_TAXONOMY, [
    "tracking",
    "return",
    "refund",
    "exchange",
    "cancel",
    "address_change",
    "product_question",
    "complaint",
    "thanks",
    "update",
    "other",
  ]);
});

test("gradeRuntimeIntent: DB-only business label is ungraded while actual intent is retained", () => {
  const result = gradeRuntimeIntent("technical_support", "complaint");
  assert.equal(result.intentCorrect, null);
  assert.equal(result.intentGradeable, false);
  assert.equal(result.intentGradeSkipReason, "expected_intent_outside_runtime_taxonomy");
  assert.equal(result.expectedIntentRaw, "technical_support");
  assert.equal(result.expectedIntentNormalized, "technical_support");
  assert.equal(result.actualIntentRaw, "complaint");
  assert.equal(result.actualIntentNormalized, "complaint");
  assert.equal(result.actualIntent, "complaint");
});

test("gradeRuntimeIntent: request suffix is a naming alias within the runtime taxonomy", () => {
  const result = gradeRuntimeIntent("return_request", "return");
  assert.equal(result.intentGradeable, true);
  assert.equal(result.intentCorrect, true);
  assert.equal(result.expectedIntentNormalized, "return_request");
  assert.equal(result.actualIntentNormalized, "return_request");
});

test("gradeRuntimeIntent: tracking remains distinct from order_status", () => {
  const result = gradeRuntimeIntent("tracking", "order_status");
  assert.equal(result.intentGradeable, true);
  assert.equal(result.intentCorrect, false);
});

// ---------------------------------------------------------------------------
// computeRetrievalHitAtK
// ---------------------------------------------------------------------------

test("computeRetrievalHitAtK: null when no gold ids", () => {
  const { hitAtK } = computeRetrievalHitAtK(null, [{ id: "c1" }]);
  assert.equal(hitAtK, null);
});

test("computeRetrievalHitAtK: null when gold is empty array", () => {
  const { hitAtK } = computeRetrievalHitAtK([], [{ id: "c1" }]);
  assert.equal(hitAtK, null);
});

test("computeRetrievalHitAtK: hit@1 when gold id is first retrieved", () => {
  const { hitAtK } = computeRetrievalHitAtK(["gold-1"], [{ id: "gold-1" }, { id: "other" }]);
  assert.equal(hitAtK.hit_at_1, true);
  assert.equal(hitAtK.first_hit_rank, 1);
});

test("computeRetrievalHitAtK: hit@5 not hit@1 when gold is at rank 3", () => {
  const chunks = ["c1", "c2", "gold-1", "c3", "c4"].map((id) => ({ id }));
  const { hitAtK } = computeRetrievalHitAtK(["gold-1"], chunks);
  assert.equal(hitAtK.hit_at_1, false);
  assert.equal(hitAtK.hit_at_3, true);
  assert.equal(hitAtK.hit_at_5, true);
  assert.equal(hitAtK.first_hit_rank, 3);
});

test("computeRetrievalHitAtK: miss at all k when gold not in retrieved", () => {
  const { hitAtK } = computeRetrievalHitAtK(["gold-1"], [{ id: "c1" }, { id: "c2" }]);
  assert.equal(hitAtK.hit_at_1, false);
  assert.equal(hitAtK.hit_at_5, false);
  assert.equal(hitAtK.first_hit_rank, null);
});

test("computeRetrievalHitAtK: recall_at_5 counts fraction of gold ids found", () => {
  const { hitAtK } = computeRetrievalHitAtK(
    ["g1", "g2", "g3"],
    [{ id: "g1" }, { id: "c2" }, { id: "g2" }, { id: "c3" }, { id: "c4" }],
  );
  assert.equal(hitAtK.hit_at_5, true);
  assert.ok(Math.abs(hitAtK.recall_at_5 - 2 / 3) < 0.001, `recall_at_5 expected ~0.667 got ${hitAtK.recall_at_5}`);
});

test("computeRetrievalHitAtK: accepts plain string ids in gold list", () => {
  const { hitAtK } = computeRetrievalHitAtK(["id-abc"], [{ id: "id-abc" }]);
  assert.equal(hitAtK.hit_at_1, true);
});

// --- bigint chunk ids (agent_knowledge.id is BIGINT, not uuid) ---------------

test("computeRetrievalHitAtK: bigint gold id (number 3758) matches numeric retrieved id", () => {
  // gold ids come from the seed as JSON numbers; retrieved chunk.id is the bigint
  // agent_knowledge.id surfaced over JSON. Both normalize to "3758" via String().
  const { hitAtK, retrievedChunkIds } = computeRetrievalHitAtK(
    [3758, 3964],
    [{ id: 3758 }, { id: 9999 }],
  );
  assert.equal(hitAtK.hit_at_1, true);
  assert.equal(hitAtK.first_hit_rank, 1);
  assert.deepEqual(retrievedChunkIds, ["3758", "9999"]);
});

test("computeRetrievalHitAtK: bigint match is representation-agnostic (number gold vs string retrieved)", () => {
  // Gold as number, retrieved as string — must still match.
  const numGold = computeRetrievalHitAtK([3758], [{ id: "3758" }]);
  assert.equal(numGold.hitAtK.hit_at_1, true);
  // Gold as string, retrieved as number — must still match.
  const strGold = computeRetrievalHitAtK(["3758"], [{ id: 3758 }]);
  assert.equal(strGold.hitAtK.hit_at_1, true);
});

test("computeRetrievalHitAtK: bigint miss when ids differ numerically", () => {
  const { hitAtK } = computeRetrievalHitAtK([3758], [{ id: 3759 }, { id: 37580 }]);
  assert.equal(hitAtK.hit_at_1, false);
  assert.equal(hitAtK.hit_at_5, false);
  assert.equal(hitAtK.first_hit_rank, null);
});

test("computeRetrievalHitAtK: multi bigint gold, recall counts numeric matches", () => {
  const { hitAtK } = computeRetrievalHitAtK(
    [3758, 3964, 3638],
    [{ id: 3758 }, { id: 1 }, { id: "3964" }, { id: 2 }, { id: 3 }],
  );
  assert.equal(hitAtK.hit_at_5, true);
  assert.ok(Math.abs(hitAtK.recall_at_5 - 2 / 3) < 0.001, `recall_at_5 ~0.667 got ${hitAtK.recall_at_5}`);
});

// ---------------------------------------------------------------------------
// runGoldEval
// ---------------------------------------------------------------------------

function makeServiceClient(rows) {
  return {
    rows,
    lastInsertedRun: null,
    lastInsertedResults: [],
    lastUpdate: null,
    from(table) {
      return new FakeQueryBuilder(this, table);
    },
  };
}

class FakeQueryBuilder {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this._filters = [];
    this._patch = null;
    this._insertData = null;
    this._limit = null;
    this._order = null;
    this._mode = null;
    this._selectAfterWrite = false;
  }
  select() { this._mode = this._mode === "update" || this._mode === "insert" ? this._mode : "select"; this._selectAfterWrite = true; return this; }
  insert(data) { this._mode = "insert"; this._insertData = data; return this; }
  update(data) { this._mode = "update"; this._patch = data; return this; }
  eq(col, val) { this._filters.push([col, val]); return this; }
  limit(n) { this._limit = n; return this; }
  order() { return this; }
  maybeSingle() { return this._resolve(); }
  async _resolve() {
    const t = this.table;
    const client = this.client;
    const rows = Array.isArray(client.rows) ? client.rows.filter((r) => r._table === t) : [];

    if (this._mode === "insert") {
      const data = this._insertData;
      if (t === "gold_eval_runs") {
        const id = `run-${Date.now()}`;
        client.lastInsertedRun = { ...data, id };
        if (this._selectAfterWrite) {
          return { data: { id }, error: null };
        }
        return { data: null, error: null };
      }
      if (t === "gold_eval_results") {
        client.lastInsertedResults.push(data);
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }
    if (this._mode === "update") {
      client.lastUpdate = { table: t, patch: this._patch, filters: this._filters };
      return { data: null, error: null };
    }
    // select
    let filtered = rows;
    for (const [col, val] of this._filters) {
      filtered = filtered.filter((r) => r[col] === val);
    }
    if (this._limit === 1) return { data: filtered[0] || null, error: null };
    return { data: filtered, error: null };
  }
  then(resolve, reject) {
    this._resolve().then(resolve).catch(reject);
  }
}

function makeActiveCases(cases) {
  return cases.map((c) => ({ _table: "gold_eval_cases", ...c }));
}

function makeGenerate(intent = "order_status", retrievalDebug = []) {
  // Tracks calls so tests can verify no writes to customer tables
  const calls = [];
  const fn = async (_shopId, _subject, _body, _opts) => {
    calls.push({ _shopId, _body });
    return {
      draft: "test draft",
      actions: [],
      confidence: 0.85,
      sources: [],
      routingHint: null,
      retrievalDebug,
      matcherDebug: null,
      generationId: "gen-uuid-1",
      intent,
      knowledgeGaps: [],
      skipped: false,
      skipReason: null,
      latencyMs: 42,
    };
  };
  fn.calls = calls;
  return fn;
}

test("eval-mode: generate is called with customer_message, not writing to customer tables", async () => {
  const cases = makeActiveCases([
    {
      id: "c1", shop_id: "shop-1", title: "test", customer_message: "Where is my order?",
      is_active: true, expected_intent: "order_status", gold_knowledge_chunk_ids: null,
      thread_history_json: null,
    },
  ]);
  const client = makeServiceClient(cases);
  const generate = makeGenerate("order_status");

  await runGoldEval({ serviceClient: client, shopId: "shop-1", generate });
  // The mock generator was called (not a real network call, no customer-table writes)
  assert.equal(generate.calls.length, 1);
  assert.equal(generate.calls[0]._body, "Where is my order?");
  // No insert to mail_threads / mail_messages / mail_accounts
  assert.ok(!client.rows.some((r) => r._table === "mail_threads"), "no mail_threads written");
});

test("generation_id stored on result row", async () => {
  const cases = makeActiveCases([
    {
      id: "c1", shop_id: "shop-1", title: "t", customer_message: "msg",
      is_active: true, expected_intent: "order_status", gold_knowledge_chunk_ids: null,
      thread_history_json: null,
    },
  ]);
  const client = makeServiceClient(cases);
  await runGoldEval({ serviceClient: client, shopId: "shop-1", generate: makeGenerate("order_status") });
  assert.equal(client.lastInsertedResults[0].generation_id, "gen-uuid-1");
});

test("runGoldEval stores raw and normalized actual intent and grades normalized intent", async () => {
  const cases = makeActiveCases([
    {
      id: "c1", shop_id: "shop-1", title: "t", customer_message: "msg",
      is_active: true, expected_intent: "refund_request", gold_knowledge_chunk_ids: null,
      thread_history_json: null,
    },
  ]);
  const client = makeServiceClient(cases);
  await runGoldEval({ serviceClient: client, shopId: "shop-1", generate: makeGenerate("refund") });
  assert.equal(client.lastInsertedResults[0].actual_intent_raw, "refund");
  assert.equal(client.lastInsertedResults[0].actual_intent_normalized, "refund_request");
  assert.equal(client.lastInsertedResults[0].actual_intent, "refund_request");
  assert.equal(client.lastInsertedResults[0].intent_correct, true);
});

test("runGoldEval does not count non-runtime gold labels as deterministic intent failures", async () => {
  const unsupportedExpectedIntents = [
    "technical_support",
    "order_status",
    "checkout_issue",
    "partnership_request",
  ];
  const cases = makeActiveCases(
    unsupportedExpectedIntents.map((expected_intent, index) => ({
      id: `c${index + 1}`,
      shop_id: "shop-1",
      title: "t",
      customer_message: "msg",
      is_active: true,
      expected_intent,
      gold_knowledge_chunk_ids: null,
      thread_history_json: null,
    })),
  );
  const client = makeServiceClient(cases);
  const { results, summary } = await runGoldEval({
    serviceClient: client,
    shopId: "shop-1",
    generate: makeGenerate("complaint"),
  });

  assert.equal(summary.intent_graded, 0);
  assert.equal(summary.intent_accuracy, null);
  assert.equal(summary.intent_ungraded, 4);
  assert.equal(summary.failed_count, 0);
  assert.deepEqual(
    summary.intent_skipped_cases.map((item) => item.reason),
    Array(4).fill("expected_intent_outside_runtime_taxonomy"),
  );
  for (const [index, result] of results.entries()) {
    assert.equal(result.intent_correct, null);
    assert.equal(result.intent_gradeable, false);
    assert.equal(result.expected_intent_raw, unsupportedExpectedIntents[index]);
    assert.equal(result.actual_intent_raw, "complaint");
    assert.equal(result.actual_intent_normalized, "complaint");
  }

  // Gradeability metadata lives in summary_json / the return value and is not
  // sent to the fixed gold_eval_results schema.
  for (const persisted of client.lastInsertedResults) {
    assert.equal(Object.hasOwn(persisted, "intent_gradeable"), false);
    assert.equal(Object.hasOwn(persisted, "intent_grade_skip_reason"), false);
    assert.equal(persisted.intent_correct, null);
  }
});

test("runner summary: intent accuracy aggregation", async () => {
  const cases = makeActiveCases([
    { id: "c1", shop_id: "s", title: "t1", customer_message: "m1", is_active: true, expected_intent: "tracking", gold_knowledge_chunk_ids: null, thread_history_json: null },
    { id: "c2", shop_id: "s", title: "t2", customer_message: "m2", is_active: true, expected_intent: "return", gold_knowledge_chunk_ids: null, thread_history_json: null },
  ]);
  const client = makeServiceClient(cases);

  // generate always returns intent "tracking" → c1 matches, c2 doesn't
  const { summary } = await runGoldEval({
    serviceClient: client, shopId: "s", generate: makeGenerate("tracking"),
  });
  assert.equal(summary.intent_graded, 2);
  assert.ok(Math.abs(summary.intent_accuracy - 0.5) < 0.001, `expected 0.5, got ${summary.intent_accuracy}`);
});

test("runner summary: retrieval hit@5 aggregation", async () => {
  const chunks = [{ id: "g1" }, { id: "c2" }];
  const cases = makeActiveCases([
    {
      id: "c1", shop_id: "s", title: "t", customer_message: "m", is_active: true,
      expected_intent: null, gold_knowledge_chunk_ids: ["g1"], thread_history_json: null,
    },
  ]);
  const client = makeServiceClient(cases);
  const { summary } = await runGoldEval({
    serviceClient: client, shopId: "s", generate: makeGenerate(null, chunks),
  });
  assert.equal(summary.retrieval_graded, 1);
  assert.equal(summary.retrieval_hit_at_5, 1);
});

test("inactive cases are not loaded (query-level filter)", async () => {
  // The FakeQueryBuilder filters on is_active via .eq("is_active", true).
  // An inactive row should be excluded.
  const rows = [
    { _table: "gold_eval_cases", id: "c1", shop_id: "s", title: "t", customer_message: "m", is_active: false, expected_intent: null, gold_knowledge_chunk_ids: null, thread_history_json: null },
    { _table: "gold_eval_cases", id: "c2", shop_id: "s", title: "t2", customer_message: "m2", is_active: true, expected_intent: null, gold_knowledge_chunk_ids: null, thread_history_json: null },
  ];
  const client = makeServiceClient(rows);
  const generate = makeGenerate();
  await runGoldEval({ serviceClient: client, shopId: "s", generate });
  assert.equal(generate.calls.length, 1, "only the active case was run");
});

test("workspace scoping: only cases matching workspace_id are included", async () => {
  const rows = [
    { _table: "gold_eval_cases", id: "c1", shop_id: "s", workspace_id: "ws-A", title: "t1", customer_message: "m1", is_active: true, expected_intent: null, gold_knowledge_chunk_ids: null, thread_history_json: null },
    { _table: "gold_eval_cases", id: "c2", shop_id: "s", workspace_id: "ws-B", title: "t2", customer_message: "m2", is_active: true, expected_intent: null, gold_knowledge_chunk_ids: null, thread_history_json: null },
  ];
  const client = makeServiceClient(rows);
  const generate = makeGenerate();
  await runGoldEval({ serviceClient: client, shopId: "s", workspaceId: "ws-A", generate });
  assert.equal(generate.calls.length, 1, "only ws-A case was run");
});

// ---------------------------------------------------------------------------
// AceZone gold-eval seed contract (gold-eval-cases.acezone.json)
// ---------------------------------------------------------------------------

function loadAceZoneSeed() {
  const p = join(__dirname, "..", "supabase", "eval", "gold-eval-cases.acezone.json");
  return JSON.parse(readFileSync(p, "utf8"));
}

test("seed: parses and has the expected case count + bucket counts", () => {
  const seed = loadAceZoneSeed();
  assert.ok(Array.isArray(seed.cases));
  assert.equal(seed.cases.length, 33);
  const active = seed.cases.filter((c) => c.is_active !== false);
  assert.equal(active.length, 26);
  assert.equal(seed.cases.length - active.length, 7);
  assert.equal(active.filter((c) => c.benchmark_status === "READY_FULL").length, 16);
  assert.equal(active.filter((c) => c.benchmark_status === "READY_PARTIAL").length, 10);
  assert.equal(seed.cases.filter((c) => c.is_active === false && c.benchmark_status === "NEEDS_REVIEW").length, 6);
  assert.equal(seed.cases.filter((c) => c.is_active === false && c.benchmark_status === "EXCLUDE").length, 1);
  const orderCtx = seed.cases.filter((c) => c.grading_mode === "order_context_required");
  const contentOnly = seed.cases.filter((c) => c.grading_mode === "content_only");
  assert.equal(orderCtx.length, 14);
  assert.equal(contentOnly.length, 19);
});

test("seed: grading_mode always satisfies the DB check constraint (invalid would be rejected)", () => {
  // Mirrors gold_eval_cases_grading_mode_check. A value outside this set would be
  // rejected by Postgres on insert; the seed must never carry one.
  const seed = loadAceZoneSeed();
  for (const c of seed.cases) {
    assert.ok(
      VALID_GRADING_MODES.includes(c.grading_mode),
      `case ${c.source_case_id} has invalid grading_mode "${c.grading_mode}"`,
    );
  }
});

test("seed: secondary_intents is always an array of strings", () => {
  const seed = loadAceZoneSeed();
  for (const c of seed.cases) {
    assert.ok(Array.isArray(c.secondary_intents), `case ${c.source_case_id} secondary_intents not array`);
    for (const s of c.secondary_intents) {
      assert.equal(typeof s, "string", `case ${c.source_case_id} secondary intent not a string`);
    }
  }
});

test("seed: gold_knowledge_chunk_ids are bigint-safe JSON numbers (not uuids)", () => {
  const seed = loadAceZoneSeed();
  for (const c of seed.cases) {
    assert.ok(Array.isArray(c.gold_knowledge_chunk_ids), `case ${c.source_case_id} chunk ids not array`);
    for (const id of c.gold_knowledge_chunk_ids) {
      assert.equal(typeof id, "number", `case ${c.source_case_id} chunk id ${id} is not a JSON number`);
      assert.ok(Number.isInteger(id), `case ${c.source_case_id} chunk id ${id} is not an integer`);
      // agent_knowledge.id is a small bigint, comfortably under 2^53 → no float precision loss.
      assert.ok(id > 0 && id < Number.MAX_SAFE_INTEGER, `case ${c.source_case_id} chunk id ${id} out of safe range`);
    }
  }
});

test("seed: exactly one knowledge-gap case (empty chunk ids) and it is the invoice case", () => {
  const seed = loadAceZoneSeed();
  const gaps = seed.cases.filter((c) => c.gold_knowledge_chunk_ids.length === 0);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].source_case_id, "g-044");
  assert.equal(gaps[0].expected_intent, "invoice_request");
  assert.equal(gaps[0].is_active, false);
});

test("seed: the bigint contract id 3758 is present as a JSON number", () => {
  const seed = loadAceZoneSeed();
  const present = seed.cases.some((c) => c.gold_knowledge_chunk_ids.includes(3758));
  assert.ok(present, "expected chunk id 3758 (number) somewhere in the seed");
});

test("seed: a seed case feeds computeRetrievalHitAtK end-to-end with bigint match", () => {
  const seed = loadAceZoneSeed();
  const g008 = seed.cases.find((c) => c.source_case_id === "g-008");
  assert.ok(g008);
  // Simulate the pipeline emitting retrieval_debug chunks carrying the bigint id.
  const retrieved = g008.gold_knowledge_chunk_ids.map((id) => ({ id }));
  const { hitAtK } = computeRetrievalHitAtK(g008.gold_knowledge_chunk_ids, retrieved);
  assert.equal(hitAtK.hit_at_1, true);
  assert.equal(hitAtK.recall_at_5, 1);
});

// ---------------------------------------------------------------------------
// Technical-support taxonomy alignment (expected_intent ↔ runtime taxonomy)
//
// Runtime has NO `technical_support` intent: the planner emits `complaint`
// (with a resolution_stage) for hardware-fault troubleshooting, and
// `product_question` for "how do I fix" questions. These seed cases used to
// carry expected_intent="technical_support", which made the deterministic
// grader (normalizeIntent) mark every one wrong by construction — a
// measurement mismatch, not a resolution bug. The fix aligns expected_intent
// to the runtime label while preserving `category=technical_support` as the
// analytic/business segment, and adds expected_resolution_stage for separate
// grading. We deliberately do NOT add a broad alias (e.g. technical_support →
// complaint), because that would hide the difference between the runtime
// intent and the business category.
// ---------------------------------------------------------------------------

const VALID_RESOLUTION_STAGES = [
  "troubleshoot_first",
  "request_evidence",
  "initiate_warranty_repair",
  "cancel_order",
  "refund_or_exchange",
  "info_only",
  "escalate_human",
];

// The runtime intent each technical case is OBSERVED to emit (eval-mode probe).
const TECHNICAL_CASE_RUNTIME = {
  "g-002": { expected_intent: "complaint", runtime_intent: "complaint", resolution_stage: "troubleshoot_first" },
  "g-003": { expected_intent: "complaint", runtime_intent: "complaint", resolution_stage: "troubleshoot_first" },
  "g-007": { expected_intent: "complaint", runtime_intent: "complaint", resolution_stage: "troubleshoot_first" },
  "g-009": { expected_intent: "complaint", runtime_intent: "complaint", resolution_stage: "initiate_warranty_repair" },
  "g-023": { expected_intent: "complaint", runtime_intent: "complaint", resolution_stage: "troubleshoot_first" },
  "g-043": { expected_intent: "product_question", runtime_intent: "product_question", resolution_stage: "troubleshoot_first" },
  "e-001": { expected_intent: "complaint", runtime_intent: "complaint", resolution_stage: "troubleshoot_first" },
};

test("seed: technical cases now grade CORRECT against the runtime intent", () => {
  const seed = loadAceZoneSeed();
  for (const [id, exp] of Object.entries(TECHNICAL_CASE_RUNTIME)) {
    const c = seed.cases.find((x) => x.source_case_id === id);
    assert.ok(c, `technical case ${id} present`);
    assert.equal(c.expected_intent, exp.expected_intent, `${id} expected_intent aligned to runtime taxonomy`);
    // The deterministic grader must now mark these correct (was false by construction before).
    const { intentCorrect } = compareIntent(c.expected_intent, exp.runtime_intent);
    assert.equal(intentCorrect, true, `${id} grades intent_correct against runtime intent`);
  }
});

test("seed: technical cases preserve category=technical_support as the analytic segment", () => {
  const seed = loadAceZoneSeed();
  for (const id of Object.keys(TECHNICAL_CASE_RUNTIME)) {
    const c = seed.cases.find((x) => x.source_case_id === id);
    assert.equal(c.category, "technical_support", `${id} retains technical_support analytic category`);
  }
});

test("seed: technical cases carry a separately-gradable expected_resolution_stage", () => {
  const seed = loadAceZoneSeed();
  for (const [id, exp] of Object.entries(TECHNICAL_CASE_RUNTIME)) {
    const c = seed.cases.find((x) => x.source_case_id === id);
    assert.ok(VALID_RESOLUTION_STAGES.includes(c.expected_resolution_stage), `${id} has a valid resolution stage`);
    assert.equal(c.expected_resolution_stage, exp.resolution_stage, `${id} resolution_stage matches expected`);
  }
});

test("seed: no alias backdoor — no active case uses technical_support as expected_intent", () => {
  // Aligning to the runtime taxonomy (not adding a technical_support→complaint
  // alias) means technical_support must no longer appear as a runtime-graded intent.
  const seed = loadAceZoneSeed();
  // Only active cases are graded; the alias-backdoor concern applies to those.
  // (Inactive cases g-005/g-031 are excluded from eval and out of this scope.)
  for (const c of seed.cases.filter((x) => x.is_active !== false)) {
    assert.notEqual(
      normalizeIntent(c.expected_intent),
      "technical_support",
      `active case ${c.source_case_id} must not grade against a non-runtime technical_support intent`,
    );
  }
  // And normalizeIntent still does NOT silently alias technical_support to complaint.
  assert.equal(normalizeIntent("technical_support"), "technical_support");
  assert.notEqual(normalizeIntent("technical_support"), "complaint");
});

test("seed: complaint-guards keep their runtime intents (no regression from the alignment)", () => {
  const seed = loadAceZoneSeed();
  const guards = {
    "g-004": { expected_intent: "complaint", category: "complaint" },
    "e-004": { expected_intent: "exchange_request", category: "exchange_request" },
    "g-013": { expected_intent: "refund_request", category: "refund_request" },
    "g-028": { expected_intent: "refund_request", category: "refund_request" },
  };
  for (const [id, exp] of Object.entries(guards)) {
    const c = seed.cases.find((x) => x.source_case_id === id);
    assert.ok(c, `guard ${id} present`);
    assert.equal(c.expected_intent, exp.expected_intent, `${id} expected_intent unchanged`);
    assert.equal(c.category, exp.category, `${id} category unchanged`);
    // Guards must NOT have been swept into the technical_support segment.
    assert.notEqual(c.category, "technical_support", `${id} is not a technical_support case`);
    // expected_intent still grades against itself (sanity of the guard).
    assert.equal(compareIntent(c.expected_intent, exp.expected_intent).intentCorrect, true);
  }
});
