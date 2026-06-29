import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { buildSelectedPolicyUseDirective } from "./writer.ts";
import type { Plan } from "./planner.ts";

function plan(
  primary_intent: Plan["primary_intent"],
  resolution_stage: Plan["resolution_stage"],
): Plan {
  return {
    primary_intent,
    resolution_stage,
    sub_queries: [],
    required_facts: [],
    skills_to_consider: [],
    confidence: 0.9,
    language: "en",
  };
}

function chunk(
  source_label: string,
  content: string,
  usable_as = "policy",
) {
  return {
    id: source_label,
    content,
    kind: "knowledge",
    source_label,
    similarity: 0.5,
    usable_as,
    risk_flags: [],
    applies_to_all_products: true,
    chunk_issue_types: [],
  };
}

Deno.test("policy-use directive names return-for-swap workflow for warranty/defect context", () => {
  const directive = buildSelectedPolicyUseDirective({
    plan: plan("exchange", "request_evidence"),
    latestCustomerMessage:
      "The left ear holder is broken and I think this should be covered by warranty. Can you help?",
    chunks: [
      chunk(
        "knowledge_document: Return for swap (warranty replacement)",
        "# Returns & Refunds\n\n## Return for swap (warranty replacement)\nUse this when the customer needs a warranty replacement. Ask for photo/video evidence and order number before proceeding.",
      ),
    ],
  }).toLowerCase();

  assertStringIncludes(directive, "selected policy workflow");
  assertStringIncludes(directive, "return for swap");
  assertStringIncludes(directive, "warranty");
  assertStringIncludes(directive, "explicitly name");
  assertStringIncludes(directive, "missing_required_fields");
});

Deno.test("policy-use directive activates for refund/return policy context", () => {
  const directive = buildSelectedPolicyUseDirective({
    plan: plan("return", "refund_or_exchange"),
    latestCustomerMessage: "I want to return this and get my money back.",
    chunks: [
      chunk(
        "shopify_policy: Refund policy",
        "Refunds are processed after the returned product is received and inspected.",
      ),
    ],
  }).toLowerCase();

  assertStringIncludes(directive, "refund policy");
  assertStringIncludes(directive, "primary workflow");
  assertStringIncludes(directive, "do not let troubleshooting");
});

Deno.test("policy-use directive handles broad Returns & Refunds append without asking writer to dump it", () => {
  const directive = buildSelectedPolicyUseDirective({
    plan: plan("return", "info_only"),
    latestCustomerMessage:
      "I have another microphone problem and also asked about returning/refunding this headset.",
    chunks: [
      chunk(
        "knowledge_document: Firmware update, USB driver reinstall and factory reset",
        "Run firmware update steps and reset the headset.",
        "procedure",
      ),
      chunk(
        "Returns & Refunds",
        "# Returns & Refunds\n\n## Refund processing\nRefunds are processed after receipt.\n\n## Return window\nOrdinary returns follow the return window.",
      ),
    ],
  }).toLowerCase();

  assertStringIncludes(directive, "returns & refunds");
  assertStringIncludes(directive, "use only the specific policy section");
  assertStringIncludes(directive, "do not recite");
});

Deno.test("policy-use directive stays off for pure troubleshooting", () => {
  const directive = buildSelectedPolicyUseDirective({
    plan: plan("complaint", "troubleshoot_first"),
    latestCustomerMessage: "My microphone cuts out on USB. How do I fix it?",
    chunks: [
      chunk(
        "knowledge_document: Microphone Issues",
        "Try the USB microphone troubleshooting procedure.",
        "procedure",
      ),
    ],
  });

  assertEquals(directive, "");
});

Deno.test("policy-use directive stays off for compatibility/product questions", () => {
  const directive = buildSelectedPolicyUseDirective({
    plan: plan("product_question", "info_only"),
    latestCustomerMessage: "Does A-Spire work with PS5 over USB-C?",
    chunks: [
      chunk(
        "Compatibility by headset",
        "A-Spire compatibility details for console and PC.",
        "fact",
      ),
    ],
  });

  assertEquals(directive, "");
});

Deno.test("policy-use directive never chooses a region-specific return address", () => {
  const directive = buildSelectedPolicyUseDirective({
    plan: plan("return", "refund_or_exchange"),
    latestCustomerMessage: "How do I return this from Portugal?",
    chunks: [
      chunk(
        "Returns & Refunds",
        "# Returns & Refunds\n\n## Default return address\nDenmark address\n\n## US return address\nUS address",
      ),
    ],
  }).toLowerCase();

  assert(directive.length > 0);
  assert(!directive.includes("use the us address"));
  assert(!directive.includes("use the default"));
});
