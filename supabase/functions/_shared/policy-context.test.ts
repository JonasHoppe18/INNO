import { assertEquals, assertMatch } from "jsr:@std/assert@1";

import {
  buildHeuristicPolicySummary,
  buildPinnedPolicyContext,
} from "./policy-context.ts";
import { buildMailPrompt } from "./prompt.ts";

Deno.test("policy summary stays included with tiny reserved token budget", () => {
  const context = buildPinnedPolicyContext({
    subject: "Return request",
    body: "I want to return my order",
    reservedTokens: 220,
    policies: {
      policy_refund:
        "Returns accepted within 30 days. Customer must pay return shipping. Contact support@example.com before returning.",
      policy_shipping: "Standard shipping 2-5 business days.",
      policy_terms: "Warranty is 2 years in the EU.",
      policy_summary_json: null,
    },
  });

  assertEquals(context.policySummaryIncluded, true);
  assertMatch(context.policySummaryText, /POLICY SUMMARY \(PINNED\)/);
  assertMatch(context.policyRulesText, /Never invent URLs, return portals, labels, or processes/);
  assertEquals(context.policySummaryTokens > 0, true);
});

Deno.test("return prompt contains summary and never-invent-portal rule", () => {
  const context = buildPinnedPolicyContext({
    subject: "Return label",
    body: "Where is your return portal?",
    policies: {
      policy_refund:
        "Returns accepted within 30 days. Customer must pay return shipping. Email support@example.com.",
      policy_shipping: "",
      policy_terms: "",
      policy_summary_json: null,
    },
  });

  const prompt = buildMailPrompt({
    emailBody: "Where is your return portal?",
    orderSummary: "No order data.",
    policySummary: context.policySummaryText,
    policyRules: context.policyRulesText,
    policyExcerpt: context.policyExcerptText,
  });

  assertMatch(prompt, /POLICY SUMMARY \(PINNED\)/);
  assertMatch(prompt, /Never invent URLs, return portals, labels, or processes/);
  assertMatch(prompt, /RETURNS - CHANNEL RULE/i);
});

Deno.test("return prompt asks only for missing details when details are present", () => {
  const context = buildPinnedPolicyContext({
    subject: "Return request",
    body: "Order #1050. I want to return because size was too small.",
    policies: {
      policy_refund:
        "Returns accepted within 30 days. Contact support@example.com and include order number, name and reason.",
      policy_shipping: "",
      policy_terms: "",
      policy_summary_json: null,
    },
  });

  const prompt = buildMailPrompt({
    emailBody: "Order #1050. I want to return because size was too small.",
    orderSummary: "No order data.",
    policySummary: context.policySummaryText,
    policyRules: context.policyRulesText,
    policyExcerpt: context.policyExcerptText,
    policyIntent: "RETURN",
    returnDetailsFound: [
      "RETURN DETAILS FOUND (PINNED):",
      "- order_number: #1050",
      "- name_used_at_purchase: Jonas",
      "- reason: size was too small",
    ].join("\n"),
    returnDetailsMissing: [],
  });

  assertMatch(prompt, /ask only for missing details/i);
  assertMatch(prompt, /All required details are already present/i);
});

Deno.test("Acezone-like fixture extracts 30 days and customer return shipping", () => {
  const summary = buildHeuristicPolicySummary({
    refundPolicy:
      "You may return products within 30 days of delivery. The customer is responsible for return shipping costs.",
    shippingPolicy: "Shipping takes 2-5 business days.",
    termsPolicy: "Warranty terms vary by region.",
  });

  assertEquals(summary.return_window_days, 30);
  assertEquals(summary.return_shipping_paid_by, "customer");
});
