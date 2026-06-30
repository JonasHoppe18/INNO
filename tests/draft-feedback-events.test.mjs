// Run with: node --test tests/
//
// Feedback-1a: append-only draft feedback event capture.
//
// These tests pin the emitDraftEvent helper contract:
//   - builds the correct row (ids + metrics only, never raw bodies)
//   - computes deterministic dedup_key per event type
//   - swallows a unique-violation (23505) as success (idempotent)
//   - never throws into the caller (best-effort, fire-and-forget)
//   - skips the insert entirely when shop_id or workspace_id is missing
//   - strips disallowed (raw body) keys out of payload_json
//   - only ever writes to draft_feedback_events — never ticket_examples,
//     draft_previews, or any auto-promotion table
//
// Uses a tiny in-memory mock of the Supabase insert chain. No external test
// runner / deps — Node's built-in node:test.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  emitDraftEvent,
  computeDedupKey,
  DRAFT_EVENT_TYPES,
} from "../apps/web/lib/server/draft-feedback-events.js";

// Mock the `from(table).insert(row).select("id").maybeSingle()` chain.
// Records every table touched and every inserted row so tests can assert the
// helper never reaches an auto-promotion table and persists only safe fields.
function makeInsertClient({ failWith = null, throwOn = false } = {}) {
  const calls = { tables: [], inserted: [] };
  return {
    calls,
    from(table) {
      calls.tables.push(table);
      return {
        insert(row) {
          calls.inserted.push({ table, row });
          return {
            select() {
              return {
                async maybeSingle() {
                  if (throwOn) throw new Error("connection exploded");
                  if (failWith) return { data: null, error: failWith };
                  return { data: { id: "evt_1" }, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
}

function makeLogger() {
  const warns = [];
  return { logger: { warn: (...args) => warns.push(args.join(" ")) }, warns };
}

const BASE = {
  shopId: "shop_1",
  workspaceId: "ws_1",
  threadId: "thread_1",
};

// --- dedup_key -----------------------------------------------------------------

test("computeDedupKey: one formula per event type", () => {
  assert.equal(
    computeDedupKey({ eventType: "draft_generated", generationId: "g1" }),
    "gen:g1",
  );
  assert.equal(
    computeDedupKey({ eventType: "draft_inserted", generationId: "g1", threadId: "t1" }),
    "ins:g1:t1",
  );
  assert.equal(
    computeDedupKey({
      eventType: "draft_edited",
      threadId: "t1",
      dedup: { composerMessageId: "c9", editDistance: 12, bodyLength: 340 },
    }),
    "edit:t1:c9:12:340",
  );
  assert.equal(
    computeDedupKey({ eventType: "draft_sent", dedup: { providerMessageId: "pm1" } }),
    "sent:pm1",
  );
  assert.equal(
    computeDedupKey({ eventType: "draft_sent_without_edit", dedup: { providerMessageId: "pm1" } }),
    "sent_sub:pm1",
  );
  assert.equal(
    computeDedupKey({ eventType: "draft_sent_with_edit", dedup: { providerMessageId: "pm1" } }),
    "sent_sub:pm1",
  );
  assert.equal(
    computeDedupKey({
      eventType: "draft_discarded",
      threadId: "t1",
      dedup: { discardedComposerMessageId: "c9" },
    }),
    "disc:t1:c9",
  );
  assert.equal(
    computeDedupKey({ eventType: "draft_regenerated", generationId: "gNEW" }),
    "regen:gNEW",
  );
  assert.equal(
    computeDedupKey({ eventType: "safety_block_shown", generationId: "g1" }),
    "block_shown:g1",
  );
  assert.equal(
    computeDedupKey({ eventType: "safety_block_overridden", dedup: { providerMessageId: "pm1" } }),
    "block_override:pm1",
  );
});

// --- row shape -----------------------------------------------------------------

test("builds a correct row with ids, classification and metrics", async () => {
  const client = makeInsertClient();
  const res = await emitDraftEvent({
    serviceClient: client,
    eventType: "draft_sent_with_edit",
    generationId: "g1",
    draftId: "d1",
    agentUserId: "user_abc",
    routingHint: "auto",
    blockSendRecommended: false,
    editClassification: "minor_edit",
    editDistance: 12,
    editDeltaPct: 0.08,
    payload: { provider: "smtp", model: "gpt-4o" },
    dedup: { providerMessageId: "pm1" },
    ...BASE,
  });

  assert.equal(res.ok, true);
  assert.equal(res.deduped, false);
  assert.equal(client.calls.inserted.length, 1);

  const { table, row } = client.calls.inserted[0];
  assert.equal(table, "draft_feedback_events");
  assert.equal(row.event_type, "draft_sent_with_edit");
  assert.equal(row.generation_id, "g1");
  assert.equal(row.draft_id, "d1");
  assert.equal(row.thread_id, "thread_1");
  assert.equal(row.shop_id, "shop_1");
  assert.equal(row.workspace_id, "ws_1");
  assert.equal(row.agent_user_id, "user_abc");
  assert.equal(row.routing_hint, "auto");
  assert.equal(row.block_send_recommended, false);
  assert.equal(row.edit_classification, "minor_edit");
  assert.equal(row.edit_distance, 12);
  assert.equal(row.edit_delta_pct, 0.08);
  assert.equal(row.dedup_key, "sent_sub:pm1");
  assert.deepEqual(row.payload_json, { provider: "smtp", model: "gpt-4o" });
});

test("an explicit dedupKey overrides the computed one", async () => {
  const client = makeInsertClient();
  await emitDraftEvent({
    serviceClient: client,
    eventType: "draft_generated",
    generationId: "g1",
    dedupKey: "custom-key",
    ...BASE,
  });
  assert.equal(client.calls.inserted[0].row.dedup_key, "custom-key");
});

// --- validation / scope guards -------------------------------------------------

test("skips insert when workspace_id is missing", async () => {
  const client = makeInsertClient();
  const res = await emitDraftEvent({
    serviceClient: client,
    eventType: "draft_generated",
    generationId: "g1",
    shopId: "shop_1",
    workspaceId: null,
    threadId: "thread_1",
  });
  assert.equal(res.ok, false);
  assert.equal(res.skipped, "missing_scope");
  assert.equal(client.calls.inserted.length, 0, "no row written");
});

test("skips insert when shop_id is missing", async () => {
  const client = makeInsertClient();
  const res = await emitDraftEvent({
    serviceClient: client,
    eventType: "draft_generated",
    generationId: "g1",
    shopId: null,
    workspaceId: "ws_1",
    threadId: "thread_1",
  });
  assert.equal(res.ok, false);
  assert.equal(res.skipped, "missing_scope");
  assert.equal(client.calls.inserted.length, 0);
});

test("skips insert for an unknown event type", async () => {
  const client = makeInsertClient();
  const res = await emitDraftEvent({
    serviceClient: client,
    eventType: "not_a_real_event",
    generationId: "g1",
    ...BASE,
  });
  assert.equal(res.ok, false);
  assert.equal(res.skipped, "invalid_event_type");
  assert.equal(client.calls.inserted.length, 0);
});

// --- idempotency ---------------------------------------------------------------

test("swallows a unique-violation (23505) as a deduped success", async () => {
  const client = makeInsertClient({
    failWith: { code: "23505", message: "duplicate key value violates unique constraint" },
  });
  const { logger, warns } = makeLogger();
  const res = await emitDraftEvent({
    serviceClient: client,
    eventType: "draft_sent",
    dedup: { providerMessageId: "pm1" },
    logger,
    ...BASE,
  });
  assert.equal(res.ok, true);
  assert.equal(res.deduped, true);
  assert.equal(warns.length, 0, "dedup is expected, not a warning");
});

test("reports a non-unique DB error without throwing", async () => {
  const client = makeInsertClient({
    failWith: { code: "42P01", message: "relation does not exist" },
  });
  const { logger, warns } = makeLogger();
  const res = await emitDraftEvent({
    serviceClient: client,
    eventType: "draft_generated",
    generationId: "g1",
    logger,
    ...BASE,
  });
  assert.equal(res.ok, false);
  assert.equal(res.deduped, undefined);
  assert.ok(warns.some((w) => w.includes("relation does not exist")), "error logged");
});

test("never throws into the caller even if the client throws", async () => {
  const client = makeInsertClient({ throwOn: true });
  const { logger } = makeLogger();
  const res = await emitDraftEvent({
    serviceClient: client,
    eventType: "draft_generated",
    generationId: "g1",
    logger,
    ...BASE,
  });
  assert.equal(res.ok, false);
});

test("returns ok:false when no serviceClient is provided", async () => {
  const res = await emitDraftEvent({
    serviceClient: null,
    eventType: "draft_generated",
    generationId: "g1",
    ...BASE,
  });
  assert.equal(res.ok, false);
});

// --- privacy: no raw bodies ----------------------------------------------------

test("strips disallowed raw-body keys from payload_json", async () => {
  const client = makeInsertClient();
  await emitDraftEvent({
    serviceClient: client,
    eventType: "draft_sent_with_edit",
    generationId: "g1",
    dedup: { providerMessageId: "pm1" },
    payload: {
      provider: "smtp",
      // all of these are forbidden body fields and must be dropped:
      final_sent_text: "Hi customer, here is your refund...",
      draft_text: "AI draft body",
      body_text: "raw body",
      customer_msg: "customer wrote this",
      employee_sent_text: "what the agent sent",
    },
    ...BASE,
  });
  const { row } = client.calls.inserted[0];
  assert.deepEqual(row.payload_json, { provider: "smtp" }, "only safe metadata survives");
  // Belt-and-suspenders: no value anywhere in the row leaks the body text.
  const serialized = JSON.stringify(row);
  assert.ok(!serialized.includes("refund"), "no body content in row");
  assert.ok(!serialized.includes("customer wrote"), "no customer content in row");
});

test("payload_json defaults to an empty object when omitted", async () => {
  const client = makeInsertClient();
  await emitDraftEvent({
    serviceClient: client,
    eventType: "draft_generated",
    generationId: "g1",
    ...BASE,
  });
  assert.deepEqual(client.calls.inserted[0].row.payload_json, {});
});

// --- safety: no auto-promotion paths -------------------------------------------

test("only ever writes to draft_feedback_events (no ticket_examples / draft_previews)", async () => {
  const client = makeInsertClient();
  for (const eventType of DRAFT_EVENT_TYPES) {
    await emitDraftEvent({
      serviceClient: client,
      eventType,
      generationId: "g1",
      dedup: {
        providerMessageId: "pm1",
        composerMessageId: "c1",
        discardedComposerMessageId: "c1",
        editDistance: 1,
        bodyLength: 10,
      },
      ...BASE,
    });
  }
  const uniqueTables = new Set(client.calls.tables);
  assert.deepEqual([...uniqueTables], ["draft_feedback_events"]);
  assert.ok(!uniqueTables.has("ticket_examples"));
  assert.ok(!uniqueTables.has("draft_previews"));
});
