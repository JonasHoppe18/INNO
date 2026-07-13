import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  statusOnAutoResolvedAcknowledgment,
  statusOnClosingAcknowledgment,
  statusOnInboundCustomerMessage,
} from "./transitions.ts";

const NOW = "2026-07-03T12:00:00.000Z";

Deno.test("new thread -> needs_attention with reason new", () => {
  const patch = statusOnInboundCustomerMessage(
    { currentStatus: null, waitingReason: null, isBlockedSender: false, isNewThread: true },
    NOW,
  );
  assertEquals(patch, {
    status: "needs_attention",
    waiting_reason: null,
    close_pending: false,
    attention_reason: "new",
    status_changed_at: NOW,
  });
});

Deno.test("blocked sender -> blocked regardless of state", () => {
  const patch = statusOnInboundCustomerMessage(
    { currentStatus: "waiting_customer", waitingReason: "customer", isBlockedSender: true, isNewThread: false },
    NOW,
  );
  assertEquals(patch.status, "blocked");
});

Deno.test("customer reply on waiting_customer -> needs_attention, wait cleared", () => {
  const patch = statusOnInboundCustomerMessage(
    { currentStatus: "waiting_customer", waitingReason: "customer", isBlockedSender: false, isNewThread: false },
    NOW,
  );
  assertEquals(patch.status, "needs_attention");
  assertEquals(patch.attention_reason, "customer_replied");
  assertEquals(patch.waiting_reason, null);
  assertEquals(patch.close_pending, false);
});

Deno.test("customer reply on waiting_third_party -> needs_attention, third-party marker persists", () => {
  const patch = statusOnInboundCustomerMessage(
    { currentStatus: "waiting_third_party", waitingReason: "third_party", isBlockedSender: false, isNewThread: false },
    NOW,
  );
  assertEquals(patch.status, "needs_attention");
  assertEquals(patch.waiting_reason, "third_party");
});

Deno.test("customer reply on resolved -> reopen to needs_attention", () => {
  const patch = statusOnInboundCustomerMessage(
    { currentStatus: "resolved", waitingReason: null, isBlockedSender: false, isNewThread: false },
    NOW,
  );
  assertEquals(patch.status, "needs_attention");
  assertEquals(patch.attention_reason, "customer_replied");
});

Deno.test("customer reply cancels a pending approve-close", () => {
  const patch = statusOnInboundCustomerMessage(
    { currentStatus: "waiting_customer", waitingReason: "customer", isBlockedSender: false, isNewThread: false },
    NOW,
  );
  assertEquals(patch.close_pending, false);
});

Deno.test("legacy current status values are tolerated", () => {
  for (const legacy of ["open", "new", "pending", "waiting", "solved", "Resolved"]) {
    const patch = statusOnInboundCustomerMessage(
      { currentStatus: legacy, waitingReason: null, isBlockedSender: false, isNewThread: false },
      NOW,
    );
    assertEquals(patch.status, "needs_attention");
  }
});

Deno.test("closing acknowledgment -> flags close_pending only", () => {
  const patch = statusOnClosingAcknowledgment();
  assertEquals(patch.close_pending, true);
  assertEquals("status" in patch, false);
});

Deno.test("auto-resolved acknowledgment -> hard-resolves the thread", () => {
  const patch = statusOnAutoResolvedAcknowledgment();
  assertEquals(patch.status, "resolved");
  assertEquals(patch.close_pending, false);
});
