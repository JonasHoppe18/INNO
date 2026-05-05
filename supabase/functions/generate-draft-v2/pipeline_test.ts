import { assertEquals } from "jsr:@std/assert@1";
import {
  applyAutomationConstraints,
  shouldDeferDraftUntilActionDecision,
} from "./pipeline.ts";
import type { ActionProposal } from "./stages/action-decision.ts";

function proposal(overrides: Partial<ActionProposal> = {}): ActionProposal {
  return {
    type: "cancel_order",
    confidence: "medium",
    reason: "Customer asked to cancel an unfulfilled order",
    params: { order_id: "gid://shopify/Order/1", order_name: "#1001" },
    requires_approval: true,
    ...overrides,
  };
}

Deno.test("applyAutomationConstraints routes test-mode actions to review", () => {
  const result = applyAutomationConstraints(
    [proposal({ requires_approval: false })],
    "auto",
    {
      order_updates: true,
      cancel_orders: true,
      automatic_refunds: true,
    },
    true,
  );

  assertEquals(result.routing_hint, "review");
  assertEquals(result.proposals[0].requires_approval, false);
});

Deno.test("applyAutomationConstraints requires review when automation flag is disabled", () => {
  const result = applyAutomationConstraints(
    [proposal({ type: "cancel_order", requires_approval: false })],
    "auto",
    {
      order_updates: true,
      cancel_orders: false,
      automatic_refunds: true,
    },
    false,
  );

  assertEquals(result.routing_hint, "review");
  assertEquals(result.proposals[0].requires_approval, true);
});

Deno.test("shouldDeferDraftUntilActionDecision defers only action review flows", () => {
  assertEquals(shouldDeferDraftUntilActionDecision([proposal()], "review"), true);
  assertEquals(shouldDeferDraftUntilActionDecision([proposal()], "auto"), false);
  assertEquals(shouldDeferDraftUntilActionDecision([], "review"), false);
});
