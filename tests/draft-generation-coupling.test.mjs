// Run with: node --test tests/
//
// Documents the Phase 1.1 outcome-coupling guarantees for draft_generations:
//   - rejection couples by generation_id, never overwrites completed_at, sets rejected_at
//   - save-edit couples by the pipeline draft_id
//   - both legacy text fallbacks update at most ONE row, even with duplicate final_draft_text
//
// Uses a tiny in-memory mock of the Supabase query builder (only the chains the
// helper actually calls). No external test runner / deps — Node's built-in node:test.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyRejectionToGeneration,
  applySavedEditToGeneration,
} from "../apps/web/lib/server/draft-generation-coupling.js";

class FakeBuilder {
  constructor(rows) {
    this.rows = rows;
    this._eq = [];
    this._is = [];
    this._not = [];
    this._mode = null;
    this._patch = null;
    this._order = null;
    this._limit = null;
    this._selectAfterUpdate = false;
  }
  select() {
    if (this._mode === "update") {
      this._selectAfterUpdate = true;
    } else {
      this._mode = "select";
    }
    return this;
  }
  update(patch) {
    this._mode = "update";
    this._patch = patch;
    return this;
  }
  eq(col, val) {
    this._eq.push([col, val]);
    return this;
  }
  in(col, vals) {
    this._eq.push([col, { __in: vals }]);
    return this;
  }
  is(col, val) {
    this._is.push([col, val]);
    return this;
  }
  not(col, op) {
    this._not.push([col, op]);
    return this;
  }
  order(col, opts) {
    this._order = { col, ascending: opts?.ascending !== false ? false : true };
    return this;
  }
  limit(n) {
    this._limit = n;
    return this;
  }
  _match(row) {
    for (const [col, val] of this._eq) {
      if (val && typeof val === "object" && Array.isArray(val.__in)) {
        if (!val.__in.includes(row[col])) return false;
      } else if (row[col] !== val) {
        return false;
      }
    }
    for (const [col] of this._is) {
      if (row[col] !== null && row[col] !== undefined) return false;
    }
    for (const [col, op] of this._not) {
      if (op === "is" && (row[col] === null || row[col] === undefined)) return false;
    }
    return true;
  }
  _filtered() {
    let res = this.rows.filter((r) => this._match(r));
    if (this._order) {
      const { col } = this._order;
      res = [...res].sort((a, b) => (a[col] < b[col] ? 1 : a[col] > b[col] ? -1 : 0)); // desc
    }
    if (this._limit != null) res = res.slice(0, this._limit);
    return res;
  }
  async maybeSingle() {
    const res = this._filtered();
    return { data: res[0] || null, error: null };
  }
  then(resolve, reject) {
    try {
      if (this._mode === "update") {
        const matched = this.rows.filter((r) => this._match(r));
        for (const r of matched) Object.assign(r, this._patch);
        const data = this._selectAfterUpdate ? matched.map((r) => ({ id: r.id })) : null;
        resolve({ data, error: null });
      } else {
        resolve({ data: this._filtered(), error: null });
      }
    } catch (err) {
      reject(err);
    }
  }
}

function makeClient(rows) {
  return {
    rows,
    from() {
      return new FakeBuilder(rows);
    },
  };
}

function makeLogger() {
  const warns = [];
  return { logger: { warn: (...args) => warns.push(args.join(" ")) }, warns };
}

// --- rejection ---------------------------------------------------------------

test("rejection couples by generation_id and updates exactly one row (duplicate text)", async () => {
  const rows = [
    { id: "g1", thread_id: "t", shop_id: "s", final_draft_text: "X", completed_at: "C1" },
    { id: "g2", thread_id: "t", shop_id: "s", final_draft_text: "X", completed_at: "C2" },
  ];
  const client = makeClient(rows);
  const res = await applyRejectionToGeneration({
    serviceClient: client,
    generationId: "g2",
    rejectionReason: "rejected",
    fallback: { threadId: "t", shopId: "s", draftText: "X" },
  });
  assert.equal(res.matchedBy, "generation_id");
  assert.equal(res.updatedCount, 1);
  assert.equal(rows[1].rejection_reason, "rejected");
  assert.ok(rows[1].rejected_at, "g2 rejected_at set");
  assert.equal(rows[0].rejection_reason, undefined, "g1 untouched");
});

test("rejection never overwrites completed_at", async () => {
  const rows = [
    { id: "g1", thread_id: "t", shop_id: "s", final_draft_text: "X", completed_at: "ORIG" },
  ];
  const client = makeClient(rows);
  await applyRejectionToGeneration({
    serviceClient: client,
    generationId: "g1",
    rejectionReason: "rejected",
  });
  assert.equal(rows[0].completed_at, "ORIG", "completed_at preserved");
  assert.ok(rows[0].rejected_at, "rejected_at set");
});

test("rejection legacy fallback (no generation_id) updates at most one row + logs", async () => {
  const rows = [
    { id: "g1", thread_id: "t", shop_id: "s", final_draft_text: "X", created_at: "2026-01-01", completed_at: "C1" },
    { id: "g2", thread_id: "t", shop_id: "s", final_draft_text: "X", created_at: "2026-01-02", completed_at: "C2" },
  ];
  const client = makeClient(rows);
  const { logger, warns } = makeLogger();
  const res = await applyRejectionToGeneration({
    serviceClient: client,
    generationId: null,
    rejectionReason: "rejected",
    fallback: { threadId: "t", shopId: "s", draftText: "X" },
    logger,
  });
  assert.equal(res.matchedBy, "legacy_text_fallback");
  assert.equal(res.updatedCount, 1, "exactly one row updated despite duplicate text");
  assert.equal(rows[1].rejection_reason, "rejected", "newest row (g2) updated");
  assert.equal(rows[0].rejection_reason, undefined, "older row (g1) untouched");
  assert.equal(rows[0].completed_at, "C1");
  assert.equal(rows[1].completed_at, "C2", "completed_at preserved in fallback too");
  assert.ok(warns.some((w) => w.includes("legacy")), "fallback logged");
});

// --- save-edit ---------------------------------------------------------------

test("save-edit couples by draft_id and updates exactly one row (duplicate text)", async () => {
  const rows = [
    { id: "g1", draft_id: "d1", thread_id: "t", final_draft_text: "X", employee_sent_text: null },
    { id: "g2", draft_id: "d2", thread_id: "t", final_draft_text: "X", employee_sent_text: null },
  ];
  const client = makeClient(rows);
  const res = await applySavedEditToGeneration({
    serviceClient: client,
    draftId: "d2",
    threadId: "t",
    editClassification: "minor_edit",
    fallback: { originalAiText: "X" },
  });
  assert.equal(res.matchedBy, "draft_id");
  assert.equal(res.updatedCount, 1);
  assert.equal(rows[1].edit_classification, "minor_edit", "g2 updated");
  assert.equal(rows[0].edit_classification, undefined, "g1 untouched");
});

test("save-edit legacy fallback (no draft_id) updates at most one row + logs", async () => {
  const rows = [
    { id: "g1", draft_id: "d1", thread_id: "t", final_draft_text: "X", employee_sent_text: null, created_at: "2026-01-01" },
    { id: "g2", draft_id: "d2", thread_id: "t", final_draft_text: "X", employee_sent_text: null, created_at: "2026-01-02" },
  ];
  const client = makeClient(rows);
  const { logger, warns } = makeLogger();
  const res = await applySavedEditToGeneration({
    serviceClient: client,
    draftId: null,
    threadId: "t",
    editClassification: "major_edit",
    fallback: { originalAiText: "X" },
    logger,
  });
  assert.equal(res.matchedBy, "legacy_text_fallback");
  assert.equal(res.updatedCount, 1, "exactly one row updated despite duplicate text");
  assert.equal(rows[1].edit_classification, "major_edit", "newest row updated");
  assert.equal(rows[0].edit_classification, undefined, "older row untouched");
  assert.ok(warns.some((w) => w.includes("legacy")), "fallback logged");
});

test("save-edit with unmatched draft_id falls back to single newest text row", async () => {
  const rows = [
    { id: "g1", draft_id: "real-uuid", thread_id: "t", final_draft_text: "X", employee_sent_text: null, created_at: "2026-01-01" },
  ];
  const client = makeClient(rows);
  const { logger, warns } = makeLogger();
  const res = await applySavedEditToGeneration({
    serviceClient: client,
    draftId: "composer-id-not-a-generation",
    threadId: "t",
    editClassification: "minor_edit",
    fallback: { originalAiText: "X" },
    logger,
  });
  assert.equal(res.matchedBy, "legacy_text_fallback");
  assert.equal(res.updatedCount, 1);
  assert.equal(rows[0].edit_classification, "minor_edit");
  assert.ok(warns.some((w) => w.includes("legacy")));
});
