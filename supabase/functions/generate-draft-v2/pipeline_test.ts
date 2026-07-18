import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import {
  applyAutomationConstraints,
  applyImageEvidenceClaimGuard,
  applyVerifierRoutingGuard,
  CHEAP_MODEL_INTENTS,
  pickWriterModel,
  prepareStrongRetryCandidate,
  shouldAutoExecuteActionProposals,
  shouldDeferDraftUntilActionDecision,
} from "./pipeline.ts";
import { computeRoutingHint } from "./stages/action-decision.ts";
import { isDuplicateEvalQuestion } from "./stages/retriever.ts";
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
  assertEquals(result.proposals[0].requires_approval, true);
});

Deno.test("applyAutomationConstraints removes actions configured off", () => {
  const result = applyAutomationConstraints(
    [proposal()],
    "review",
    { order_updates: true, cancel_orders: true, automatic_refunds: true },
    false,
    { action_modes: { cancel_order: "off" } },
  );

  assertEquals(result.proposals, []);
});

Deno.test("applyAutomationConstraints makes configured address auto executable", () => {
  const result = applyAutomationConstraints(
    [proposal({
      type: "update_shipping_address",
      confidence: "high",
      requires_approval: true,
    })],
    "auto",
    { order_updates: false, cancel_orders: false, automatic_refunds: false },
    false,
    { action_modes: { update_shipping_address: "auto" } },
  );

  assertEquals(result.routing_hint, "auto");
  assertEquals(result.proposals[0].requires_approval, false);
  assertEquals(
    shouldAutoExecuteActionProposals(result.proposals, result.routing_hint, false),
    true,
  );
});

Deno.test("unsupported refund auto mode is downgraded to approval", () => {
  const result = applyAutomationConstraints(
    [proposal({ type: "refund_order", requires_approval: false })],
    "auto",
    { order_updates: true, cancel_orders: true, automatic_refunds: true },
    false,
    { action_modes: { refund_order: "auto" } },
  );

  assertEquals(result.routing_hint, "review");
  assertEquals(result.proposals[0].requires_approval, true);
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

Deno.test("action routing: explicit human escalation and low planner confidence never auto-route", () => {
  const basePlan = {
    primary_intent: "other",
    resolution_stage: "info_only" as const,
    sub_queries: [],
    required_facts: [],
    skills_to_consider: [],
    confidence: 0.9,
    language: "en",
  };
  assertEquals(
    computeRoutingHint([], {
      ...basePlan,
      resolution_stage: "escalate_human",
    }),
    "review",
  );
  assertEquals(
    computeRoutingHint([], { ...basePlan, confidence: 0.2 }),
    "review",
  );
  assertEquals(computeRoutingHint([], basePlan), "auto");
});

Deno.test("verifier routing guard fails closed on block or verifier API error", () => {
  const blocked = applyVerifierRoutingGuard(
    { routingHint: "auto", blockSendRecommended: false },
    { block_send: true, confidence: 0.95, issues: ["contradiction"] },
    { autoSendAllowed: true },
  );
  assertEquals(blocked.routingHint, "block");
  assertEquals(blocked.blockSendRecommended, true);

  const outage = applyVerifierRoutingGuard(
    { routingHint: "auto", blockSendRecommended: false },
    { block_send: true, confidence: 0, issues: ["verifier_api_error"] },
    { autoSendAllowed: true },
  );
  assertEquals(outage.routingHint, "block");
  assertEquals(outage.blockSendRecommended, true);
  assertEquals(outage.reasons, ["verifier_api_error"]);
});

Deno.test("verifier routing guard requires high confidence and explicit intent allowlist", () => {
  const lowConfidence = applyVerifierRoutingGuard(
    { routingHint: "auto", blockSendRecommended: false },
    { block_send: false, confidence: 0.79, issues: [] },
    { autoSendAllowed: true },
  );
  assertEquals(lowConfidence.routingHint, "review");
  assertEquals(lowConfidence.blockSendRecommended, true);

  const notEnabled = applyVerifierRoutingGuard(
    { routingHint: "auto", blockSendRecommended: false },
    { block_send: false, confidence: 0.9, issues: [] },
    { autoSendAllowed: false },
  );
  assertEquals(notEnabled.routingHint, "review");
  assertEquals(notEnabled.blockSendRecommended, false);

  const allowed = applyVerifierRoutingGuard(
    { routingHint: "auto", blockSendRecommended: false },
    { block_send: false, confidence: 0.9, issues: [] },
    { autoSendAllowed: true },
  );
  assertEquals(allowed.routingHint, "auto");
  assertEquals(allowed.blockSendRecommended, false);
});

Deno.test("eval leakage guard catches cross-provider copies without collapsing similar cases", () => {
  assertEquals(
    isDuplicateEvalQuestion(
      "Hej!  Hvor er min ordre #123?",
      "hej hvor er min ordre 123",
    ),
    true,
  );
  assertEquals(
    isDuplicateEvalQuestion(
      "Hvor er min ordre #123?",
      "Hvor er min ordre #124?",
    ),
    false,
  );
  assertEquals(
    isDuplicateEvalQuestion(
      "Hi there. På jeres hjemmeside står der, at I sender inden for 24 timer. Det er nu over et døgn siden, og tracking viser stadig intet. Kan I undersøge status på min [order number]?",
      "Hej. På jeres hjemmeside står der, at I sender inden for 24 timer. Det er nu over et døgn siden, og tracking viser stadig intet. Kan I undersøge status på min ordre?",
    ),
    true,
  );
  assertEquals(
    isDuplicateEvalQuestion(
      "Min ordre er forsinket, og tracking står stille. Kan I undersøge den?",
      "Mit headset har en løs mikrofonarm. Kan den repareres under garantien?",
    ),
    false,
  );
});

Deno.test("strong retry candidate cannot bypass first-pass proof and damage guards", () => {
  const unsafe = prepareStrongRetryCandidate({
    draftText:
      "Hi there, please send your receipt. We will arrange a replacement for the cracked headset.",
    replyLanguage: "en",
    compatibilityEnabled: false,
    postActionResult: null,
    orderMatchState: "exact_order_number",
    customerMessage: "My headset is cracked near the headband.",
    imageAttachmentCount: 0,
  });
  assertEquals(
    unsafe.violations.some((issue) => issue.startsWith("verified_order:")),
    true,
  );
  assertEquals(
    unsafe.violations.some((issue) =>
      issue.startsWith("damage_documentation:")
    ),
    true,
  );

  const safe = prepareStrongRetryCandidate({
    draftText:
      "Hi there, please send clear photos of the crack, and I'll review the warranty options for order #123.",
    replyLanguage: "en",
    compatibilityEnabled: false,
    postActionResult: null,
    orderMatchState: "exact_order_number",
    customerMessage: "My headset is cracked near the headband.",
    imageAttachmentCount: 0,
  });
  assertEquals(safe.violations, []);
});

Deno.test("strong retry candidate cannot bypass post-action or support-voice guards", () => {
  const result = prepareStrongRetryCandidate({
    draftText:
      "Hi there, our team will refund 100 DKK as soon as possible and get back to you.",
    replyLanguage: "en",
    compatibilityEnabled: false,
    postActionResult: {
      action_type: "refund_order",
      amount: "100",
      amount_display: "DKK 100.00",
      currency: "DKK",
    },
    orderMatchState: "exact_order_number",
    customerMessage: "Where is my refund?",
    imageAttachmentCount: 0,
  });
  assertEquals(
    result.violations.some((issue) => issue.startsWith("post_action:")),
    true,
  );
  assertEquals(
    result.violations.some((issue) => issue.startsWith("support_voice:")),
    true,
  );
});

Deno.test("declined outcomes are never rewritten as completed post-action confirmations", () => {
  const result = prepareStrongRetryCandidate({
    draftText:
      "Hi, we have not changed the order. Could you confirm the missing address details?",
    replyLanguage: "en",
    compatibilityEnabled: false,
    postActionResult: {
      action_type: "update_shipping_address",
      outcome: "declined",
      reason_code: "missing_information",
      decision_reason: "The house number is missing.",
    },
    orderMatchState: "exact_order_number",
    customerMessage: "Please change my delivery address.",
    imageAttachmentCount: 0,
  });

  assertEquals(
    result.violations.some((issue) => issue.startsWith("post_action:")),
    false,
  );
  assertEquals(result.draftText.includes("has already been executed"), false);
});

// ── AZ-1b Stage 12d wiring ──────────────────────────────────────────────────
const IMAGE_CLAIM_DRAFT =
  "Jeg har set de vedhæftede billeder, og det ser ud til at være en fysisk skade.";

Deno.test("image guard: unsupported image claim with 0 images → review + block", () => {
  const r = applyImageEvidenceClaimGuard(
    { routingHint: "auto", blockSendRecommended: false },
    { draftText: IMAGE_CLAIM_DRAFT, imageEvidenceCount: 0, language: "da" },
  );
  assertEquals(r.routingHint, "review");
  assertEquals(r.blockSendRecommended, true);
  assertNotEquals(r.violations.length, 0);
});

Deno.test("image guard: same claim WITH real image evidence → not forced to review/block", () => {
  const r = applyImageEvidenceClaimGuard(
    { routingHint: "auto", blockSendRecommended: false },
    { draftText: IMAGE_CLAIM_DRAFT, imageEvidenceCount: 2, language: "da" },
  );
  assertEquals(r.routingHint, "auto");
  assertEquals(r.blockSendRecommended, false);
  assertEquals(r.violations.length, 0);
});

Deno.test("image guard: broad 'det ser ud til' with 0 images → not triggered", () => {
  const r = applyImageEvidenceClaimGuard(
    { routingHint: "auto", blockSendRecommended: false },
    {
      draftText: "Det ser ud til at din ordre er forsinket.",
      imageEvidenceCount: 0,
      language: "da",
    },
  );
  assertEquals(r.routingHint, "auto");
  assertEquals(r.blockSendRecommended, false);
  assertEquals(r.violations.length, 0);
});

Deno.test("shouldDeferDraftUntilActionDecision defers only action review flows", () => {
  assertEquals(
    shouldDeferDraftUntilActionDecision([proposal()], "review"),
    true,
  );
  assertEquals(
    shouldDeferDraftUntilActionDecision([proposal()], "auto"),
    false,
  );
  assertEquals(shouldDeferDraftUntilActionDecision([], "review"), false);
});

Deno.test("action-decision: returns [] when pending_asks is non-empty", async () => {
  const { applyDeterministicRules } = await import(
    "./stages/action-decision.ts"
  );

  const plan = {
    primary_intent: "exchange",
    resolution_stage: "initiate_warranty_repair" as const,
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
    plan,
    caseState,
    facts,
    retrieved,
    shopConfig,
    customerMessage,
  );

  assertEquals(
    result,
    [],
    "should return no actions when pending_asks is non-empty",
  );
});

Deno.test("action-decision: exchange is off by default and enabled explicitly", async () => {
  const { applyDeterministicRules } = await import(
    "./stages/action-decision.ts"
  );

  const plan = {
    primary_intent: "exchange",
    resolution_stage: "initiate_warranty_repair" as const,
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
    plan,
    caseState,
    facts,
    retrieved,
    shopConfig,
    customerMessage,
  );

  assertEquals(
    result,
    [],
    "exchange remains disabled until the executable workflow is intentionally enabled",
  );

  const enabledResult = applyDeterministicRules(
    plan,
    caseState,
    facts,
    retrieved,
    {
      action_modes: { create_exchange_request: "approve" },
    },
    customerMessage,
  );
  assertEquals(enabledResult.length, 1);
  assertEquals(enabledResult[0].type, "create_exchange_request");
  assertEquals(enabledResult[0].requires_approval, true);
});

Deno.test("action-decision: enabled return uses the executable approval flow", async () => {
  const { applyDeterministicRules } = await import(
    "./stages/action-decision.ts"
  );
  const result = applyDeterministicRules(
    {
      primary_intent: "return",
      resolution_stage: "refund_or_exchange" as const,
      sub_queries: [],
      required_facts: [],
      skills_to_consider: [],
      confidence: 0.9,
      language: "en",
    },
    {
      intents: [{ type: "return", confidence: 0.9 }],
      entities: { order_numbers: ["1001"], customer_email: "", products_mentioned: [] },
      decisions_made: [],
      open_questions: [],
      pending_asks: [],
      language: "en",
      last_updated_msg_id: "msg-return",
    },
    {
      order: {
        id: "gid://shopify/Order/1001",
        name: "#1001",
        fulfillment_status: "fulfilled",
        financial_status: "paid",
        line_items: [],
      },
      facts: [{ label: "Returret", value: "Ja — inden for 30 dage" }],
    },
    { chunks: [], past_ticket_examples: [] },
    { action_modes: { initiate_return: "approve" } },
    "I would like to return my order",
  );

  assertEquals(result.length, 1);
  assertEquals(result[0].type, "send_return_instructions");
  assertEquals(result[0].requires_approval, true);
});

// --- Hybrid writer-model routing (cost optimization, 2026-07-08) ------------
// Cheap current-gen model on measured-parity intents; strong model (gpt-4o)
// everywhere else. Gated behind OPENAI_CHEAP_MODEL: unset = zero behavior
// change so the deploy is a provable no-op until the secret is set.

Deno.test("pickWriterModel: explicit override beats all routing", () => {
  assertEquals(
    pickWriterModel({
      intent: "complaint",
      hasOrderFacts: true,
      overrideModel: "gpt-5.4-mini",
      simpleModel: "gpt-4o-mini",
      strongModel: "gpt-4o",
      cheapModel: "gpt-5.4-nano",
    }),
    "gpt-5.4-mini",
  );
});

Deno.test("pickWriterModel: thanks/update stay on the simple model even if cheap is set", () => {
  for (const intent of ["thanks", "update"]) {
    assertEquals(
      pickWriterModel({
        intent,
        hasOrderFacts: false,
        simpleModel: "gpt-4o-mini",
        strongModel: "gpt-4o",
        cheapModel: "gpt-5.4-mini",
      }),
      "gpt-4o-mini",
    );
  }
});

Deno.test("pickWriterModel: tracking uses simple only when the order was found", () => {
  const base = {
    intent: "tracking",
    simpleModel: "gpt-4o-mini",
    strongModel: "gpt-4o",
  };
  assertEquals(
    pickWriterModel({ ...base, hasOrderFacts: true }),
    "gpt-4o-mini",
  );
  assertEquals(pickWriterModel({ ...base, hasOrderFacts: false }), "gpt-4o");
});

Deno.test("pickWriterModel: GATED OFF — no cheap model => parity intents use the strong model (deploy is a no-op)", () => {
  for (const intent of ["exchange", "other"]) {
    assertEquals(
      pickWriterModel({
        intent,
        hasOrderFacts: false,
        simpleModel: "gpt-4o-mini",
        strongModel: "gpt-4o",
        cheapModel: null,
      }),
      "gpt-4o",
    );
  }
  // empty string is also "disabled"
  assertEquals(
    pickWriterModel({
      intent: "exchange",
      hasOrderFacts: false,
      simpleModel: "gpt-4o-mini",
      strongModel: "gpt-4o",
      cheapModel: "",
    }),
    "gpt-4o",
  );
});

Deno.test("pickWriterModel: ENABLED — cheap model routes ONLY the measured-parity intents", () => {
  const enabled = {
    hasOrderFacts: false,
    simpleModel: "gpt-4o-mini",
    strongModel: "gpt-4o",
    cheapModel: "gpt-5.4-mini",
  };
  // parity intents -> cheap
  for (const intent of ["exchange", "other"]) {
    assertEquals(
      pickWriterModel({ ...enabled, intent }),
      "gpt-5.4-mini",
      intent,
    );
  }
  // the expensive/hard intents stay on the strong model
  for (const intent of ["complaint", "return", "refund", "product_question"]) {
    assertEquals(pickWriterModel({ ...enabled, intent }), "gpt-4o", intent);
  }
});

Deno.test("CHEAP_MODEL_INTENTS is the conservative measured-parity set", () => {
  assertEquals([...CHEAP_MODEL_INTENTS].sort(), ["exchange", "other"]);
});
