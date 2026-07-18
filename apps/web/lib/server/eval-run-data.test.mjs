import { test } from "node:test";
import assert from "node:assert/strict";
import {
  customerBodyFromTicketExample,
  evalSourceThreadId,
  normalizeEvalItems,
  summarizeEvalResults,
} from "./eval-run-data.js";

test("ticket-example eval removes the retrieval-only subject prefix", () => {
  assert.equal(
    customerBodyFromTicketExample("Please cancel order 123\nThanks!", "Please cancel order 123"),
    "Thanks!",
  );
  assert.equal(
    customerBodyFromTicketExample("The headset still will not pair.", "Pairing issue"),
    "The headset still will not pair.",
  );
});

test("ticket-example eval uses a substantive subject for an image-only message", () => {
  assert.equal(
    customerBodyFromTicketExample(
      "A-Spire Wireless dongle issue\n![](https://example.test/image.png)",
      "A-Spire Wireless dongle issue",
    ),
    "A-Spire Wireless dongle issue",
  );
  assert.equal(
    customerBodyFromTicketExample("Cancel order 123\nThanks!", "Cancel order 123"),
    "Thanks!",
  );
});

test("imported eval examples retain their external ticket id for self-exclusion", () => {
  const normalized = normalizeEvalItems({
    zendesk_tickets: [{
      id: "ticket-example-42",
      external_ticket_id: "5757",
      subject: "Follow-up",
      customer_body: "It still does not connect.",
      human_reply: "Please try the following.",
    }],
  });

  assert.equal(normalized.mode, "zendesk");
  assert.equal(normalized.items[0].external_ticket_id, "5757");
  assert.equal(evalSourceThreadId(normalized.items[0]), "5757");
});

test("live Zendesk eval items fall back to their ordinary ticket id", () => {
  assert.equal(evalSourceThreadId({ id: "9876" }), "9876");
  assert.equal(evalSourceThreadId({}), undefined);
});

test("headline eval aggregates exclude non-comparable results", () => {
  const summary = summarizeEvalResults([
    {
      correctness: 5,
      completeness: 4,
      tone: 5,
      actionability: 4,
      overall: 4.5,
      overall_10: 9,
      send_ready: true,
      likely_root_cause: "none",
      excluded_from_aggregate: false,
    },
    {
      correctness: 1,
      completeness: 1,
      tone: 1,
      actionability: 1,
      overall: 1,
      overall_10: 2,
      send_ready: true,
      likely_root_cause: "missing_tool",
      excluded_from_aggregate: true,
    },
  ]);

  assert.equal(summary.count, 1);
  assert.equal(summary.total_count, 2);
  assert.equal(summary.excluded_count, 1);
  assert.equal(summary.send_ready_count, 1);
  assert.equal(summary.averages.overall_10, 9);
  assert.deepEqual(summary.root_causes, { none: 1 });
});

test("an all-excluded eval run has no fabricated averages", () => {
  const summary = summarizeEvalResults([{ excluded_from_aggregate: true }]);
  assert.equal(summary.count, 0);
  assert.equal(summary.excluded_count, 1);
  assert.equal(summary.averages.overall_10, null);
});
