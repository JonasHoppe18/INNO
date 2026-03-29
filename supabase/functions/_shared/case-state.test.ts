import { assertEquals, assertMatch } from "jsr:@std/assert@1";

import {
  buildCaseState,
  formatCaseStateForPrompt,
  formatThreadHistoryForPrompt,
} from "./case-state.ts";

Deno.test("buildCaseState includes deterministic order fields when selected order exists", () => {
  const state = buildCaseState({
    workflowCategory: "Return",
    workflowSlug: "return",
    workflowSource: "latest_message_override",
    executionState: "pending_approval",
    approvalRequiredFlow: true,
    selectedOrder: {
      id: 12345,
      name: "#12345",
      fulfillment_status: "unfulfilled",
      financial_status: "paid",
      cancelled_at: null,
      closed_at: null,
    },
    matchedSubjectNumber: "12345",
    automation: {
      order_updates: true,
      cancel_orders: false,
      automatic_refunds: false,
      historic_inbox_access: true,
    },
    policyIntent: "RETURN",
    policySummaryIncluded: true,
    policyExcerptIncluded: true,
    isReturnIntent: true,
    returnDetailsMissing: ["return_reason"],
    returnEligibility: { eligible: true },
    trackingIntent: false,
    trackingDataPresent: false,
  });

  assertEquals(state.order.has_selected_order, true);
  assertEquals(state.order.order_id, 12345);
  assertEquals(state.execution.execution_state, "pending_approval");
  assertEquals(state.return_flow.eligibility, "eligible");
});

Deno.test("formatCaseStateForPrompt includes verified, inferred, and unknown sections", () => {
  const state = buildCaseState({
    workflowCategory: "General",
    workflowSlug: "general",
    executionState: "no_action",
    approvalRequiredFlow: false,
    selectedOrder: null,
    policyIntent: "OTHER",
    isReturnIntent: false,
    trackingIntent: true,
    trackingDataPresent: false,
  });
  const text = formatCaseStateForPrompt(state, { maxTokens: 320 });

  assertMatch(text, /CASE STATE \(DETERMINISTIC\):/);
  assertMatch(text, /Verified facts:/);
  assertMatch(text, /Inferred useful signals:/);
  assertMatch(text, /Unknown or missing facts:/);
});

Deno.test("formatThreadHistoryForPrompt compacts history with role labels", () => {
  const text = formatThreadHistoryForPrompt(
    [
      { role: "customer", text: "I still need help with my order status and tracking updates." },
      { role: "support", text: "We are checking with the carrier and will update you." },
    ],
    { maxMessages: 6, maxCharsPerMessage: 120, maxTokens: 220 },
  );

  assertMatch(text, /RECENT THREAD HISTORY \(COMPACT, oldest -> newest\):/);
  assertMatch(text, /\[CUSTOMER\]/);
  assertMatch(text, /\[SUPPORT\]/);
});
