import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
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

Deno.test("action-decision: returns [] when pending_asks is non-empty", async () => {
  const { applyDeterministicRules } = await import(
    "./stages/action-decision.ts"
  );

  const plan = {
    primary_intent: "exchange",
    sub_queries: [],
    required_facts: [],
    skills_to_consider: [],
    confidence: 0.9,
    language: "da",
  };

  const caseState = {
    intents: [{ type: "exchange", confidence: 0.9 }],
    entities: { order_numbers: [], customer_email: "", products_mentioned: [] },
    decisions_made: [],
    open_questions: [],
    pending_asks: ["photo of the damage"],
    language: "da",
    last_updated_msg_id: "msg-1",
  };

  const facts = {
    order: {
      id: "gid://shopify/Order/123",
      name: "#1234",
      fulfillment_status: null,
      financial_status: "paid",
      line_items: [{ variant_id: "456" }],
    },
    facts: [],
  };

  const retrieved = { chunks: [], past_ticket_examples: [] };
  const shopConfig = {};
  const customerMessage = "headset is broken";

  const result = applyDeterministicRules(
    plan, caseState, facts, retrieved, shopConfig, customerMessage
  );

  assertEquals(result, [], "should return no actions when pending_asks is non-empty");
});

Deno.test("action-decision: proposes exchange when pending_asks is empty", async () => {
  const { applyDeterministicRules } = await import(
    "./stages/action-decision.ts"
  );

  const plan = {
    primary_intent: "exchange",
    sub_queries: [],
    required_facts: [],
    skills_to_consider: [],
    confidence: 0.9,
    language: "da",
  };

  const caseState = {
    intents: [{ type: "exchange", confidence: 0.9 }],
    entities: { order_numbers: [], customer_email: "", products_mentioned: [] },
    decisions_made: [],
    open_questions: [],
    pending_asks: [],
    language: "da",
    last_updated_msg_id: "msg-2",
  };

  const facts = {
    order: {
      id: "gid://shopify/Order/123",
      name: "#1234",
      fulfillment_status: null,
      financial_status: "paid",
      line_items: [{ variant_id: "456" }],
    },
    facts: [],
  };

  const retrieved = { chunks: [], past_ticket_examples: [] };
  const shopConfig = {};
  const customerMessage = "headset is physically broken";

  const result = applyDeterministicRules(
    plan, caseState, facts, retrieved, shopConfig, customerMessage
  );

  assertNotEquals(result.length, 0, "should propose exchange when no pending asks");
});
