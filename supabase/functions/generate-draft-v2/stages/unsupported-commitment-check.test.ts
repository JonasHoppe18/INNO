// deno test --no-check --allow-read supabase/functions/generate-draft-v2/stages/unsupported-commitment-check.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { checkUnsupportedCommitments } from "./unsupported-commitment-check.ts";

// ── MUST trigger (no approved action) ─────────────────────────────────────

Deno.test("unsupported refund promise → review", () => {
  const result = checkUnsupportedCommitments({
    draft_text: "We will issue a refund.",
  });
  assertEquals(result.compliant, false);
  assertEquals(result.requires_review, true);
  assertEquals(result.violations.length, 1);
  assertEquals(result.violations[0].type, "unsupported_refund_promise");
  assert(result.violations[0].excerpt.includes("refund"));
});

Deno.test("unsupported prepaid-label promise → review", () => {
  const result = checkUnsupportedCommitments({
    draft_text: "I will send you a prepaid return label.",
  });
  assertEquals(result.compliant, false);
  assertEquals(result.requires_review, true);
  assertEquals(result.violations.length, 1);
  assertEquals(result.violations[0].type, "unsupported_prepaid_label_promise");
});

Deno.test("unsupported replacement promise → review", () => {
  const result = checkUnsupportedCommitments({
    draft_text: "We will replace your headset.",
  });
  assertEquals(result.compliant, false);
  assertEquals(result.requires_review, true);
  assertEquals(result.violations.length, 1);
  assertEquals(result.violations[0].type, "unsupported_replacement_promise");
});

Deno.test("unsupported exchange promise → review", () => {
  const result = checkUnsupportedCommitments({
    draft_text: "We will arrange an exchange.",
  });
  assertEquals(result.compliant, false);
  assertEquals(result.requires_review, true);
  assertEquals(result.violations.length, 1);
  assertEquals(result.violations[0].type, "unsupported_exchange_promise");
});

// ── MUST NOT trigger ───────────────────────────────────────────────────────

Deno.test("conditional refund wording → allowed", () => {
  const result = checkUnsupportedCommitments({
    draft_text: "You may be eligible for a refund after inspection.",
  });
  assertEquals(result.compliant, true);
  assertEquals(result.violations.length, 0);
  assertEquals(result.requires_review, false);
});

Deno.test("conditional label wording → allowed", () => {
  const result = checkUnsupportedCommitments({
    draft_text: "A prepaid label may be provided if the case is approved.",
  });
  assertEquals(result.compliant, true);
  assertEquals(result.violations.length, 0);
});

Deno.test("documented policy explanation → allowed", () => {
  const result = checkUnsupportedCommitments({
    draft_text:
      "You are eligible for a refund within 30 days of delivery if the item is unused and in its original packaging.",
  });
  assertEquals(result.compliant, true);
  assertEquals(result.violations.length, 0);
});

Deno.test("safe follow-up wording → allowed", () => {
  const result = checkUnsupportedCommitments({
    draft_text: "We will review the case and follow up with the next step.",
  });
  assertEquals(result.compliant, true);
  assertEquals(result.violations.length, 0);
});

// ── Authorization via approved/suggested actions ───────────────────────────

Deno.test("approved action → allowed", () => {
  const result = checkUnsupportedCommitments({
    draft_text: "We will issue a refund.",
    approved_actions: [{ type: "refund_order", lifecycle_stage: "approved" }],
  });
  assertEquals(result.compliant, true);
  assertEquals(result.violations.length, 0);
});

Deno.test("suggested-only action does not authorize promise", () => {
  const result = checkUnsupportedCommitments({
    draft_text: "We will issue a refund.",
    suggested_actions: [{ type: "refund_order", lifecycle_stage: "suggested" }],
  });
  assertEquals(result.compliant, false);
  assertEquals(result.violations.length, 1);
  assertEquals(result.violations[0].type, "unsupported_refund_promise");
});

// ── Danish patterns ─────────────────────────────────────────────────────────

Deno.test("Danish refund promise → review", () => {
  const result = checkUnsupportedCommitments({
    draft_text: "Vi sender dig en refundering.",
    language: "da",
  });
  assertEquals(result.compliant, false);
  assertEquals(result.violations[0].type, "unsupported_refund_promise");
});

Deno.test("Danish prepaid-label promise → review", () => {
  const result = checkUnsupportedCommitments({
    draft_text: "Vi opretter en returlabel til dig.",
    language: "da",
  });
  assertEquals(result.compliant, false);
  assertEquals(result.violations[0].type, "unsupported_prepaid_label_promise");
});

Deno.test("Danish replacement promise → review", () => {
  const result = checkUnsupportedCommitments({
    draft_text: "Vi sender dig et nyt sæt høretelefoner.",
    language: "da",
  });
  assertEquals(result.compliant, false);
  assertEquals(result.violations[0].type, "unsupported_replacement_promise");
});

Deno.test("Danish exchange promise → review", () => {
  const result = checkUnsupportedCommitments({
    draft_text: "Vi ombytter varen for dig.",
    language: "da",
  });
  assertEquals(result.compliant, false);
  assertEquals(result.violations[0].type, "unsupported_exchange_promise");
});

Deno.test("Danish approved return authorizes label promise", () => {
  const result = checkUnsupportedCommitments({
    draft_text: "Vi opretter en returlabel til dig.",
    approved_actions: [{ type: "initiate_return", lifecycle_stage: "approved" }],
    language: "da",
  });
  assertEquals(result.compliant, true);
});

// ── English already-done claims ─────────────────────────────────────────────

Deno.test("English already-issued refund claim → review", () => {
  const result = checkUnsupportedCommitments({
    draft_text: "We have refunded your order.",
  });
  assertEquals(result.compliant, false);
  assertEquals(result.violations[0].type, "unsupported_refund_promise");
});

// ── Safe ordinary replies stay unchanged ────────────────────────────────────

Deno.test("safe troubleshooting reply unchanged", () => {
  const result = checkUnsupportedCommitments({
    draft_text:
      "Please try restarting the device and let us know if that resolves the issue.",
  });
  assertEquals(result.compliant, true);
  assertEquals(result.violations.length, 0);
});

Deno.test("safe outbound tracking reply unchanged", () => {
  const result = checkUnsupportedCommitments({
    draft_text:
      "Your order has shipped! Here is your tracking number: 1Z999AA10123456784.",
  });
  assertEquals(result.compliant, true);
  assertEquals(result.violations.length, 0);
});

Deno.test("safe return tracking reply unchanged", () => {
  const result = checkUnsupportedCommitments({
    draft_text:
      "Your return is on its way back to us. Here is the tracking number for the return parcel: 1Z999AA10123456784.",
  });
  assertEquals(result.compliant, true);
  assertEquals(result.violations.length, 0);
});

// ── Genericity / purity ──────────────────────────────────────────────────────

Deno.test("module contains no shop-specific hardcoding", async () => {
  const source = await Deno.readTextFile(
    new URL("./unsupported-commitment-check.ts", import.meta.url),
  );
  for (
    const term of [
      "acezone",
      "alpi",
      "a-spire",
      "a-blaze",
      "webshipper",
      "shop_id",
      "shopify",
    ]
  ) {
    assert(
      !source.toLowerCase().includes(term),
      `module should not reference ${term}`,
    );
  }
  // No UUID literals.
  assert(
    !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(
      source,
    ),
  );
});

// ── Routing integration (mirrors pipeline.ts wiring) ────────────────────────
//
// pipeline.ts applies this exact override after final draft selection:
//   let finalRoutingHint = effectiveRoutingHint;
//   let blockSendRecommended = false;
//   if (unsupportedCommitmentCheck.requires_review) {
//     finalRoutingHint = "review";
//     blockSendRecommended = true;
//   }
// These tests prove the override behaves correctly starting from a
// baseline "auto" routing_hint, without invoking the full pipeline.

function applyRoutingOverride(
  baselineRoutingHint: "auto" | "review" | "block",
  checkResult: ReturnType<typeof checkUnsupportedCommitments>,
) {
  let routingHint = baselineRoutingHint;
  let blockSendRecommended = false;
  if (checkResult.requires_review) {
    routingHint = "review";
    blockSendRecommended = true;
  }
  return { routingHint, blockSendRecommended };
}

Deno.test("routing override: unsupported replacement promise escalates auto → review", () => {
  const checkResult = checkUnsupportedCommitments({
    draft_text: "We'll send you a replacement.",
    approved_actions: [],
  });
  const { routingHint, blockSendRecommended } = applyRoutingOverride(
    "auto",
    checkResult,
  );
  assertEquals(routingHint, "review");
  assertEquals(blockSendRecommended, true);
});

Deno.test("routing override: safe conditional wording leaves auto unchanged", () => {
  const checkResult = checkUnsupportedCommitments({
    draft_text: "We will review the case and follow up with the next step.",
  });
  const { routingHint, blockSendRecommended } = applyRoutingOverride(
    "auto",
    checkResult,
  );
  assertEquals(routingHint, "auto");
  assertEquals(blockSendRecommended, false);
});

Deno.test("result shape is additive/diagnostic only and deterministic", () => {
  const input = {
    draft_text: "We will issue a refund.",
    approved_actions: [{ type: "refund_order" }],
  };
  const a = checkUnsupportedCommitments(input);
  const b = checkUnsupportedCommitments(input);
  assertEquals(a, b);
  assertEquals(Object.keys(a).sort(), [
    "compliant",
    "requires_review",
    "violations",
  ]);
  // Input is not mutated.
  assertEquals(input.draft_text, "We will issue a refund.");
});
