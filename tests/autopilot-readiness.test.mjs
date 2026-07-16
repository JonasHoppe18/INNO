// Run with: node --test tests/autopilot-readiness.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  evaluateAutopilotReadiness,
  validateRequestedAutoSendIntents,
  wilsonLowerBound,
} from "../apps/web/lib/server/autopilot-readiness.js";

function sentEvents(count, {
  intent = "tracking",
  classification = "no_edit",
  draftPrefix = "draft",
  directIntent = true,
} = {}) {
  return Array.from({ length: count }, (_, index) => ({
    id: `sent_${draftPrefix}_${index}`,
    draft_id: `${draftPrefix}_${index}`,
    generation_id: null,
    edit_classification: classification,
    payload_json: directIntent ? { intent } : {},
  }));
}

function category(result, intent) {
  return result.categories.find((row) => row.intent === intent);
}

test("Wilson lower bound keeps a tiny perfect sample from unlocking autopilot", () => {
  assert.ok(wilsonLowerBound(35, 35) < 0.95);
  assert.ok(wilsonLowerBound(99, 99) >= 0.95);
});

test("99 perfect human outcomes are still insufficient evidence", () => {
  const result = evaluateAutopilotReadiness({
    sentEvents: sentEvents(99),
    storedAutoSendIntents: ["tracking"],
  });

  const tracking = category(result, "tracking");
  assert.equal(tracking.ticket_count, 99);
  assert.equal(tracking.no_edit_rate, 1);
  assert.equal(tracking.readiness, "insufficient_data");
  assert.equal(tracking.auto_send_enabled, false);
  assert.deepEqual(result.effectiveAutoSendIntents, []);
  assert.deepEqual(result.blockedStoredIntents, ["tracking"]);
});

test("a statistically strong perfect sample is ready from human outcomes", () => {
  const result = evaluateAutopilotReadiness({
    sentEvents: sentEvents(100),
    storedAutoSendIntents: ["tracking", "refund"],
  });

  const tracking = category(result, "tracking");
  assert.equal(tracking.readiness, "ready");
  assert.equal(tracking.sona_recommends, true);
  assert.equal(tracking.auto_send_enabled, true);
  assert.ok(tracking.no_edit_wilson_lower_bound >= 0.95);
  assert.deepEqual(result.effectiveAutoSendIntents, ["tracking"]);
  assert.deepEqual(result.blockedStoredIntents, ["refund"]);
});

test("one recent major edit blocks readiness even in a large otherwise-perfect sample", () => {
  const result = evaluateAutopilotReadiness({
    sentEvents: [
      ...sentEvents(99),
      ...sentEvents(1, { classification: "major_edit", draftPrefix: "major" }),
    ],
  });

  const tracking = category(result, "tracking");
  assert.equal(tracking.ticket_count, 100);
  assert.equal(tracking.major_edit_count, 1);
  assert.equal(tracking.readiness, "not_ready");
  assert.equal(tracking.readiness_reason, "recent_major_edit");
});

test("a major edit fails closed even before the minimum sample is reached", () => {
  const result = evaluateAutopilotReadiness({
    sentEvents: sentEvents(1, { classification: "major_edit" }),
  });

  const tracking = category(result, "tracking");
  assert.equal(tracking.ticket_count, 1);
  assert.equal(tracking.readiness, "not_ready");
  assert.equal(tracking.readiness_reason, "recent_major_edit");
});

test("minor edits only qualify when no-edit rate and confidence bound both pass", () => {
  const result = evaluateAutopilotReadiness({
    sentEvents: [
      ...sentEvents(198),
      ...sentEvents(2, { classification: "minor_edit", draftPrefix: "minor" }),
    ],
  });

  const tracking = category(result, "tracking");
  assert.equal(tracking.no_edit_rate, 0.99);
  assert.equal(tracking.major_edit_count, 0);
  assert.equal(tracking.readiness, "ready");
});

test("sent outcomes couple to exact generated intent by draft id", () => {
  const sends = sentEvents(100, { directIntent: false });
  const generatedEvents = sends.map((event) => ({
    generation_id: `generation_${event.draft_id}`,
    draft_id: event.draft_id,
    payload_json: { intent: "exchange" },
  }));
  const result = evaluateAutopilotReadiness({
    sentEvents: sends,
    generatedEvents,
  });

  assert.equal(category(result, "exchange").ticket_count, 100);
  assert.equal(category(result, "exchange").readiness, "ready");
  assert.equal(category(result, "tracking").ticket_count, 0);
  assert.equal(result.evidence.attributed_labeled, 100);
});

test("draft generation trace is a conservative fallback when event payload lacks intent", () => {
  const sends = sentEvents(2, { directIntent: false, draftPrefix: "trace" });
  const result = evaluateAutopilotReadiness({
    sentEvents: sends,
    generationRows: [
      {
        id: "g0",
        draft_id: "trace_0",
        planner_output_json: { primary_intent: "refund" },
      },
      {
        id: "g1",
        draft_id: "trace_1",
        resolution_plan_json: JSON.stringify({ primary_intent: "refund" }),
      },
    ],
  });

  assert.equal(category(result, "refund").ticket_count, 2);
  assert.equal(result.evidence.attributed_labeled, 2);
  assert.equal(result.evidence.unattributed_labeled, 0);
});

test("unattributed and catch-all outcomes never unlock a specific intent", () => {
  const result = evaluateAutopilotReadiness({
    sentEvents: [
      ...sentEvents(20, { directIntent: false, draftPrefix: "unknown" }),
      ...sentEvents(20, { intent: "other", draftPrefix: "other" }),
    ],
  });

  assert.equal(result.evidence.total_labeled, 40);
  assert.equal(result.evidence.attributed_labeled, 0);
  assert.equal(result.evidence.unattributed_labeled, 40);
  assert.ok(result.categories.every((row) => row.ticket_count === 0));
  assert.ok(result.categories.every((row) => row.readiness === "insufficient_data"));
});

test("PUT validation rejects unknown and not-ready intents while always allowing a clear", () => {
  assert.deepEqual(
    validateRequestedAutoSendIntents([], ["tracking"]),
    { intents: [], invalidIntents: [], blockedIntents: [], ok: true },
  );

  const notReady = validateRequestedAutoSendIntents(
    ["tracking", "refund"],
    ["tracking"],
  );
  assert.equal(notReady.ok, false);
  assert.deepEqual(notReady.blockedIntents, ["refund"]);

  const unknown = validateRequestedAutoSendIntents(["tracking", "made_up"], ["tracking"]);
  assert.equal(unknown.ok, false);
  assert.deepEqual(unknown.invalidIntents, ["made_up"]);
});
