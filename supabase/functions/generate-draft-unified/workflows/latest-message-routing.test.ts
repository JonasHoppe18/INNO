import { assertEquals } from "jsr:@std/assert@1";

import type { CaseAssessment } from "../../_shared/case-assessment.ts";
import { resolveLatestMessageCategoryOverride } from "./latest-message-routing.ts";

function buildAssessment(overrides: Partial<CaseAssessment> = {}): CaseAssessment {
  return {
    version: 3,
    debug_marker: "return_logistics_v3",
    primary_case_type: "general_support",
    secondary_case_types: [],
    latest_message_primary_intent: "general_support",
    latest_message_confidence: 0.4,
    historical_context_intents: [],
    intent_conflict_detected: false,
    current_message_should_override_thread_route: false,
    intent_scores: {
      technical_issue: 0,
      product_question: 0,
      tracking_shipping: 0,
      return_refund: 0,
      order_change: 0,
      billing_payment: 0,
      warranty_complaint: 0,
      general_support: 0,
      mixed_case: 0,
    },
    metadata_only_signals: [],
    retrieval_needs: {
      order_facts: false,
      policy: false,
      product: false,
      product_manual: false,
      troubleshooting: false,
      support_process: false,
      examples: false,
    },
    case_type: "general_support",
    intent_labels: [],
    language: "en",
    customer_sentiment: "neutral",
    actionability: {
      reply_only_possible: true,
      likely_action_family: null,
      missing_required_inputs: [],
    },
    entities: {
      order_numbers: [],
      emails: [],
      product_queries: [],
      symptom_phrases: [],
      context_phrases: [],
      old_device_works: false,
      tried_fixes: false,
      address_candidate: null,
    },
    risk_flags: [],
    confidence: 0.5,
    summary: "",
    ...overrides,
  };
}

Deno.test("tag Exchange + clear technical troubleshooting follow-up -> override to Technical support", () => {
  const assessment = buildAssessment({
    primary_case_type: "technical_issue",
    latest_message_primary_intent: "technical_issue",
    latest_message_confidence: 0.86,
    intent_scores: {
      technical_issue: 8,
      product_question: 1,
      tracking_shipping: 0,
      return_refund: 2,
      order_change: 0,
      billing_payment: 0,
      warranty_complaint: 0,
      general_support: 1,
      mixed_case: 0,
    },
    entities: {
      order_numbers: [],
      emails: [],
      product_queries: [],
      symptom_phrases: ["device powers off after pairing attempt"],
      context_phrases: ["after trying previous troubleshooting steps"],
      old_device_works: false,
      tried_fixes: true,
      address_candidate: null,
    },
  });

  const decision = resolveLatestMessageCategoryOverride({
    assessment,
    currentCategory: "Exchange",
  });

  assertEquals(decision.should_override, true);
  assertEquals(decision.category, "Technical support");
});

Deno.test("tag Exchange + actual exchange/return intent -> keep Exchange", () => {
  const assessment = buildAssessment({
    primary_case_type: "return_refund",
    latest_message_primary_intent: "return_refund",
    latest_message_confidence: 0.88,
    intent_scores: {
      technical_issue: 2,
      product_question: 0,
      tracking_shipping: 0,
      return_refund: 8,
      order_change: 0,
      billing_payment: 0,
      warranty_complaint: 0,
      general_support: 0,
      mixed_case: 0,
    },
    entities: {
      order_numbers: [],
      emails: [],
      product_queries: [],
      symptom_phrases: ["want to exchange for another size"],
      context_phrases: [],
      old_device_works: false,
      tried_fixes: false,
      address_candidate: null,
    },
  });

  const decision = resolveLatestMessageCategoryOverride({
    assessment,
    currentCategory: "Exchange",
  });

  assertEquals(decision.should_override, false);
  assertEquals(decision.category, null);
});

Deno.test("tag General + clear technical troubleshooting follow-up -> override to Technical support", () => {
  const assessment = buildAssessment({
    primary_case_type: "technical_issue",
    latest_message_primary_intent: "technical_issue",
    latest_message_confidence: 0.79,
    intent_scores: {
      technical_issue: 7,
      product_question: 1,
      tracking_shipping: 0,
      return_refund: 1,
      order_change: 0,
      billing_payment: 0,
      warranty_complaint: 0,
      general_support: 1,
      mixed_case: 0,
    },
    entities: {
      order_numbers: [],
      emails: [],
      product_queries: [],
      symptom_phrases: ["connection drops repeatedly"],
      context_phrases: ["after attempting prior troubleshooting"],
      old_device_works: true,
      tried_fixes: true,
      address_candidate: null,
    },
  });

  const decision = resolveLatestMessageCategoryOverride({
    assessment,
    currentCategory: "General",
  });

  assertEquals(decision.should_override, true);
  assertEquals(decision.category, "Technical support");
});

Deno.test("mixed/ambiguous latest message -> keep tag-derived workflow", () => {
  const assessment = buildAssessment({
    primary_case_type: "general_support",
    latest_message_primary_intent: "technical_issue",
    latest_message_confidence: 0.49,
    intent_scores: {
      technical_issue: 4,
      product_question: 2,
      tracking_shipping: 1,
      return_refund: 3,
      order_change: 1,
      billing_payment: 0,
      warranty_complaint: 0,
      general_support: 4,
      mixed_case: 0,
    },
    entities: {
      order_numbers: [],
      emails: [],
      product_queries: [],
      symptom_phrases: [],
      context_phrases: [],
      old_device_works: false,
      tried_fixes: false,
      address_candidate: null,
    },
  });

  const decision = resolveLatestMessageCategoryOverride({
    assessment,
    currentCategory: "Exchange",
  });

  assertEquals(decision.should_override, false);
  assertEquals(decision.category, null);
});

