import { assertEquals, assertMatch } from "jsr:@std/assert@1";

import {
  buildHeuristicPolicySummary,
  buildPinnedPolicyContext,
} from "./policy-context.ts";

Deno.test("policy context is guardrails-only (no pinned summary or excerpt)", () => {
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

  // Knowledge-only: policy data is no longer pinned — only behavioral guardrails remain.
  assertEquals(context.policySummaryIncluded, false);
  assertEquals(context.policySummaryText, "");
  assertEquals(context.policyExcerptText, "");
  assertEquals(context.policyExcerptIncluded, false);
  assertMatch(context.policyRulesText, /Never invent URLs, return portals, labels, or processes/);
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
