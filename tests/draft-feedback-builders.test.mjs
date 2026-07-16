// Run with: node --test tests/
//
// Feedback-1b: pure builder functions that map route variables to emitDraftEvent
// args for the app-layer feedback events:
//   - buildDraftEditedEvent  (composer save route)
//   - buildDraftSentEvents   (send route: umbrella + optional subtype)
//
// Builders are pure (no Supabase client, no next/clerk) so they unit-test
// cleanly. The route supplies serviceClient/logger when it spreads the result
// into emitDraftEvent. These tests pin: ids, event_type, dedup keys, metric
// placement, the editClass-null subtype omission, body privacy, and the
// missing-scope skip (via the real emitDraftEvent guard).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildDraftEditedEvent,
  buildDraftSentEvents,
} from "../apps/web/lib/server/draft-feedback-builders.js";
import { emitDraftEvent } from "../apps/web/lib/server/draft-feedback-events.js";

// Minimal insert-recording mock for the missing-scope guard test.
function makeInsertClient() {
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
              return { async maybeSingle() { return { data: { id: "evt_1" }, error: null }; } };
            },
          };
        },
      };
    },
  };
}

const EDIT_CTX = {
  threadId: "thread_1",
  shopId: "shop_1",
  workspaceId: "ws_1",
  agentUserId: "user_abc",
  draftId: "pipeline_draft_uuid", // -> draft_generations.draft_id coupling key
  composerMessageId: "composer_msg_9",
  editClassification: "minor_edit",
  provider: "smtp",
};

const SENT_CTX = {
  threadId: "thread_1",
  shopId: "shop_1",
  workspaceId: "ws_1",
  agentUserId: "user_abc",
  draftId: "pipeline_draft_uuid",
  providerMessageId: "pm_123",
  provider: "smtp",
  editClassification: "major_edit",
  editDistance: 84,
  editDeltaPct: 0.42,
  intent: "complaint",
};

// --- draft_edited --------------------------------------------------------------

test("buildDraftEditedEvent: ids, event_type, once-per-composer dedup, classification", () => {
  const ev = buildDraftEditedEvent(EDIT_CTX);
  assert.equal(ev.eventType, "draft_edited");
  assert.equal(ev.threadId, "thread_1");
  assert.equal(ev.shopId, "shop_1");
  assert.equal(ev.workspaceId, "ws_1");
  assert.equal(ev.agentUserId, "user_abc");
  assert.equal(ev.draftId, "pipeline_draft_uuid");
  assert.equal(ev.generationId, null);
  assert.equal(ev.editClassification, "minor_edit");
  // draft route computes classification only, never a levenshtein distance here:
  assert.equal(ev.editDistance, null);
  assert.equal(ev.editDeltaPct, null);
  // once-per-composer: keyed on the composer message id, NOT body length
  assert.equal(ev.dedupKey, "edit:thread_1:composer_msg_9");
  assert.deepEqual(ev.payload, { provider: "smtp" });
});

test("buildDraftEditedEvent: no provider -> empty payload, still valid", () => {
  const ev = buildDraftEditedEvent({ ...EDIT_CTX, provider: undefined });
  assert.deepEqual(ev.payload, {});
  assert.equal(ev.dedupKey, "edit:thread_1:composer_msg_9");
});

test("buildDraftEditedEvent: never carries a raw body even if ctx leaks one", () => {
  const ev = buildDraftEditedEvent({
    ...EDIT_CTX,
    nextBodyText: "Hi customer, your refund of 499kr is on the way",
    originalAiDraftText: "AI draft body text",
  });
  const serialized = JSON.stringify(ev);
  assert.ok(!serialized.includes("refund"), "no draft body in built event");
  assert.ok(!serialized.includes("499"), "no amounts in built event");
  assert.deepEqual(ev.payload, { provider: "smtp" });
});

// --- draft_sent (umbrella + subtype) -------------------------------------------

test("buildDraftSentEvents: emits umbrella + with_edit subtype for major_edit", () => {
  const events = buildDraftSentEvents(SENT_CTX);
  assert.equal(events.length, 2);

  const [umbrella, subtype] = events;
  assert.equal(umbrella.eventType, "draft_sent");
  assert.equal(umbrella.dedupKey, "sent:pm_123");
  assert.equal(umbrella.draftId, "pipeline_draft_uuid");
  assert.equal(umbrella.generationId, null);
  // umbrella carries no edit metrics
  assert.equal(umbrella.editClassification, null);
  assert.equal(umbrella.editDistance, null);
  assert.deepEqual(umbrella.payload, { provider: "smtp", intent: "complaint" });

  assert.equal(subtype.eventType, "draft_sent_with_edit");
  assert.equal(subtype.dedupKey, "sent_sub:pm_123");
  assert.equal(subtype.editClassification, "major_edit");
  assert.equal(subtype.editDistance, 84);
  assert.equal(subtype.editDeltaPct, 0.42);
});

test("buildDraftSentEvents: no_edit -> draft_sent_without_edit, metrics omitted", () => {
  const events = buildDraftSentEvents({
    ...SENT_CTX,
    editClassification: "no_edit",
    editDistance: 0,
    editDeltaPct: 0,
  });
  assert.equal(events.length, 2);
  const subtype = events[1];
  assert.equal(subtype.eventType, "draft_sent_without_edit");
  assert.equal(subtype.dedupKey, "sent_sub:pm_123");
  assert.equal(subtype.editClassification, "no_edit");
  // metrics only on with_edit; without_edit leaves them null
  assert.equal(subtype.editDistance, null);
  assert.equal(subtype.editDeltaPct, null);
});

test("buildDraftSentEvents: normalizes the exact generated intent onto both outcome events", () => {
  const events = buildDraftSentEvents({
    ...SENT_CTX,
    intent: "  Tracking  ",
    editClassification: "no_edit",
  });
  assert.deepEqual(events.map((event) => event.payload), [
    { provider: "smtp", intent: "tracking" },
    { provider: "smtp", intent: "tracking" },
  ]);
});

test("buildDraftSentEvents: editClass null -> umbrella only, no subtype", () => {
  const events = buildDraftSentEvents({
    ...SENT_CTX,
    editClassification: null,
    editDistance: null,
    editDeltaPct: null,
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, "draft_sent");
  assert.equal(events[0].dedupKey, "sent:pm_123");
});

test("buildDraftSentEvents: draftId may be absent (manual reply, no AI baseline)", () => {
  const events = buildDraftSentEvents({
    ...SENT_CTX,
    draftId: null,
    editClassification: null,
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].draftId, null);
});

test("buildDraftSentEvents: never carries a raw body even if ctx leaks one", () => {
  const events = buildDraftSentEvents({
    ...SENT_CTX,
    coreBodyText: "Final sent reply with secret 499kr refund details",
    customerMsg: "customer asked about refund",
  });
  const serialized = JSON.stringify(events);
  assert.ok(!serialized.includes("499"), "no body content in built events");
  assert.ok(!serialized.includes("customer asked"), "no customer message in built events");
  for (const ev of events) {
    assert.deepEqual(ev.payload, { provider: "smtp", intent: "complaint" });
  }
});

// --- integration with the real emitDraftEvent guard ----------------------------

test("missing workspace_id -> emitDraftEvent skips (no insert)", async () => {
  const client = makeInsertClient();
  const ev = buildDraftEditedEvent({ ...EDIT_CTX, workspaceId: null });
  const res = await emitDraftEvent({ serviceClient: client, ...ev });
  assert.equal(res.ok, false);
  assert.equal(res.skipped, "missing_scope");
  assert.equal(client.calls.inserted.length, 0);
});

test("missing shop_id -> emitDraftEvent skips (no insert)", async () => {
  const client = makeInsertClient();
  const [umbrella] = buildDraftSentEvents({ ...SENT_CTX, shopId: null });
  const res = await emitDraftEvent({ serviceClient: client, ...umbrella });
  assert.equal(res.ok, false);
  assert.equal(res.skipped, "missing_scope");
  assert.equal(client.calls.inserted.length, 0);
});

test("built events only ever target draft_feedback_events (no auto-promotion tables)", async () => {
  const client = makeInsertClient();
  await emitDraftEvent({ serviceClient: client, ...buildDraftEditedEvent(EDIT_CTX) });
  for (const ev of buildDraftSentEvents(SENT_CTX)) {
    await emitDraftEvent({ serviceClient: client, ...ev });
  }
  const tables = new Set(client.calls.tables);
  assert.deepEqual([...tables], ["draft_feedback_events"]);
  assert.ok(!tables.has("draft_previews"));
  assert.ok(!tables.has("ticket_examples"));
});
