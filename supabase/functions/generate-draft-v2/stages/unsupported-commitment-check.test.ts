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

// ── Document-delivery promises (READINESS-4) ────────────────────────────────

Deno.test("Danish: invoice-send promise → review", () => {
  const result = checkUnsupportedCommitments({
    draft_text: "Jeg sender fakturaen til dig.",
    language: "da",
  });
  assertEquals(result.compliant, false);
  assertEquals(result.violations[0].type, "unsupported_document_promise");
});

Deno.test("Danish: future invoice-delivery promise → review", () => {
  const result = checkUnsupportedCommitments({
    draft_text: "Jeg sørger for, at du får fakturaen tilsendt.",
    language: "da",
  });
  assertEquals(result.compliant, false);
  assertEquals(result.violations[0].type, "unsupported_document_promise");
});

Deno.test("English: invoice-send promise → review", () => {
  const result = checkUnsupportedCommitments({
    draft_text: "I'll make sure the invoice is sent to you.",
  });
  assertEquals(result.compliant, false);
  assertEquals(result.violations[0].type, "unsupported_document_promise");
});

Deno.test("Danish: passive return-label promise → review", () => {
  const result = checkUnsupportedCommitments({
    draft_text: "Du får en returlabel sendt.",
    language: "da",
  });
  assertEquals(result.compliant, false);
});

Deno.test("Danish: order-confirmation resend promise → review", () => {
  const result = checkUnsupportedCommitments({
    draft_text: "Jeg sender en ny ordrebekræftelse.",
    language: "da",
  });
  assertEquals(result.compliant, false);
  // "sender ... en ny X" also matches the pre-existing replacement family's
  // generic "en ny" pattern — both families correctly flag this sentence,
  // so assert presence rather than a fixed violations[0] position/count.
  assert(
    result.violations.some((v) => v.type === "unsupported_document_promise"),
  );
});

Deno.test("Danish: credit-note promise → review", () => {
  const result = checkUnsupportedCommitments({
    draft_text: "Jeg sender dig en kreditnota.",
    language: "da",
  });
  assertEquals(result.compliant, false);
  assertEquals(result.violations[0].type, "unsupported_document_promise");
});

Deno.test("Danish: warranty-document promise → review", () => {
  const result = checkUnsupportedCommitments({
    draft_text: "Jeg sender garantidokumentet til dig.",
    language: "da",
  });
  assertEquals(result.compliant, false);
  assertEquals(result.violations[0].type, "unsupported_document_promise");
});

Deno.test("Danish: neutral request for order number → allowed", () => {
  const result = checkUnsupportedCommitments({
    draft_text: "Kan du sende dit ordrenummer, så vi kan hjælpe med fakturaen?",
    language: "da",
  });
  assertEquals(result.compliant, true);
  assertEquals(result.violations.length, 0);
});

Deno.test("Danish: neutral 'cannot send directly' wording → allowed", () => {
  const result = checkUnsupportedCommitments({
    draft_text:
      "Jeg kan ikke sende fakturaen direkte herfra, men teamet kan hjælpe med at tjekke det.",
    language: "da",
  });
  assertEquals(result.compliant, true);
  assertEquals(result.violations.length, 0);
});

Deno.test("Danish: neutral manual-handling wording → allowed", () => {
  const result = checkUnsupportedCommitments({
    draft_text:
      "Sagen skal håndteres manuelt, da der ikke er en understøttet faktura-handling.",
    language: "da",
  });
  assertEquals(result.compliant, true);
  assertEquals(result.violations.length, 0);
});

Deno.test("Danish: order visible but cannot send invoice → allowed", () => {
  const result = checkUnsupportedCommitments({
    draft_text:
      "Jeg kan se din ordre, men jeg kan ikke sende fakturaen direkte herfra.",
    language: "da",
  });
  assertEquals(result.compliant, true);
  assertEquals(result.violations.length, 0);
});

// ── Authorization scoping ────────────────────────────────────────────────

Deno.test("order-confirmation promise authorized by approved resend_confirmation_or_invoice", () => {
  const result = checkUnsupportedCommitments({
    draft_text: "Jeg sender ordrebekræftelsen til dig.",
    approved_actions: [{ type: "resend_confirmation_or_invoice" }],
    language: "da",
  });
  assertEquals(result.compliant, true);
  assertEquals(result.violations.length, 0);
});

Deno.test("order-confirmation promise NOT authorized without approved resend_confirmation_or_invoice", () => {
  const result = checkUnsupportedCommitments({
    draft_text: "Jeg sender ordrebekræftelsen til dig.",
    suggested_actions: [{ type: "resend_confirmation_or_invoice" }],
    language: "da",
  });
  assertEquals(result.compliant, false);
  assertEquals(result.violations[0].type, "unsupported_document_promise");
});

Deno.test("invoice-send promise authorized by approved resend_confirmation_or_invoice", () => {
  const result = checkUnsupportedCommitments({
    draft_text: "Jeg sender fakturaen til dig.",
    approved_actions: [{ type: "resend_confirmation_or_invoice" }],
    language: "da",
  });
  assertEquals(result.compliant, true);
  assertEquals(result.violations.length, 0);
});

Deno.test("return-label promise NOT authorized even when resend_confirmation_or_invoice is approved", () => {
  const result = checkUnsupportedCommitments({
    draft_text: "Jeg sender en returlabel til dig.",
    approved_actions: [{ type: "resend_confirmation_or_invoice" }],
    language: "da",
  });
  assertEquals(result.compliant, false);
});

Deno.test("credit-note promise NOT authorized even when resend_confirmation_or_invoice is approved", () => {
  const result = checkUnsupportedCommitments({
    draft_text: "Jeg sender en kreditnota til dig.",
    approved_actions: [{ type: "resend_confirmation_or_invoice" }],
    language: "da",
  });
  assertEquals(result.compliant, false);
  assertEquals(result.violations[0].type, "unsupported_document_promise");
});

Deno.test("warranty-document promise NOT authorized even when resend_confirmation_or_invoice is approved", () => {
  const result = checkUnsupportedCommitments({
    draft_text: "Jeg sender garantidokumentet til dig.",
    approved_actions: [{ type: "resend_confirmation_or_invoice" }],
    language: "da",
  });
  assertEquals(result.compliant, false);
  assertEquals(result.violations[0].type, "unsupported_document_promise");
});

Deno.test("document promise not authorized by an unrelated approved action", () => {
  const result = checkUnsupportedCommitments({
    draft_text: "Jeg sender fakturaen til dig.",
    approved_actions: [{ type: "refund_order" }],
    language: "da",
  });
  assertEquals(result.compliant, false);
  assertEquals(result.violations[0].type, "unsupported_document_promise");
});

// ── READINESS-CORE regression ───────────────────────────────────────────────
// Customer asks: "Kan I sende mig en faktura?" — Sona must not answer with a
// promise to send it; a neutral/manual-handling or order-number-ask reply
// must pass, while a promise-style reply must be flagged for review.

Deno.test("READINESS-CORE: promise-style reply to 'Kan I sende mig en faktura?' is flagged", () => {
  const result = checkUnsupportedCommitments({
    draft_text: "Ja, jeg sender dig fakturaen med det samme.",
    language: "da",
  });
  assertEquals(result.compliant, false);
  assertEquals(result.requires_review, true);
  assertEquals(result.violations[0].type, "unsupported_document_promise");
});

Deno.test("READINESS-CORE: neutral order-number reply to 'Kan I sende mig en faktura?' is allowed", () => {
  const result = checkUnsupportedCommitments({
    draft_text: "Kan du sende dit ordrenummer, så vi kan hjælpe med fakturaen?",
    language: "da",
  });
  assertEquals(result.compliant, true);
  assertEquals(result.requires_review, false);
});

// ── Existing families remain unaffected (regression) ───────────────────────

Deno.test("READINESS-4 regression: refund/prepaid_label/replacement/exchange families unaffected", () => {
  const refund = checkUnsupportedCommitments({ draft_text: "We will issue a refund." });
  const label = checkUnsupportedCommitments({ draft_text: "I will send you a prepaid return label." });
  const replacement = checkUnsupportedCommitments({ draft_text: "We will replace your headset." });
  const exchange = checkUnsupportedCommitments({ draft_text: "We will arrange an exchange." });
  assertEquals(refund.violations[0].type, "unsupported_refund_promise");
  assertEquals(label.violations[0].type, "unsupported_prepaid_label_promise");
  assertEquals(replacement.violations[0].type, "unsupported_replacement_promise");
  assertEquals(exchange.violations[0].type, "unsupported_exchange_promise");
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

// ── READINESS-6b: pronoun-form document-delivery promises ───────────────────
// Night-probe A6: "Jeg kan ikke sende fakturaen direkte herfra, men sagen
// bliver håndteret manuelt. Vi sørger for, at du får den tilsendt hurtigst
// muligt." The promise sentence refers to the invoice only via the pronoun
// "den", so the noun-anchored document patterns never matched. The pronoun
// patterns require a document noun elsewhere in the draft to stay precise.

Deno.test("READINESS-6b: pronoun promise with invoice antecedent → unsupported_document_promise", () => {
  const r = checkUnsupportedCommitments({
    draft_text:
      "Hej Thomas,\n\nJeg kan ikke sende fakturaen direkte herfra, men sagen bliver håndteret manuelt. Vi sørger for, at du får den tilsendt hurtigst muligt.",
  });
  assertEquals(r.compliant, false);
  assertEquals(r.requires_review, true);
  assert(
    r.violations.some((v) => v.type === "unsupported_document_promise"),
  );
});

Deno.test("READINESS-6b: passive pronoun promise ('du får den tilsendt') with receipt antecedent → violation", () => {
  const r = checkUnsupportedCommitments({
    draft_text:
      "Vi har modtaget din forespørgsel om en kvittering. Du får den tilsendt hurtigst muligt.",
  });
  assertEquals(r.compliant, false);
  assert(
    r.violations.some((v) => v.type === "unsupported_document_promise"),
  );
});

Deno.test("READINESS-6b: EN pronoun promise ('we'll send it to you') with invoice antecedent → violation", () => {
  const r = checkUnsupportedCommitments({
    draft_text:
      "I can't generate the invoice directly from here. We'll send it to you as soon as possible.",
  });
  assertEquals(r.compliant, false);
  assert(
    r.violations.some((v) => v.type === "unsupported_document_promise"),
  );
});

Deno.test("READINESS-6b: pronoun promise with NO document noun anywhere → compliant", () => {
  const r = checkUnsupportedCommitments({
    draft_text:
      "Tak for din besked. Vi sørger for, at du får den tilsendt hurtigst muligt.",
  });
  assertEquals(r.compliant, true);
});

Deno.test("READINESS-6b: pronoun promise authorized by resend_confirmation_or_invoice → compliant", () => {
  const r = checkUnsupportedCommitments({
    draft_text:
      "Du har bedt om fakturaen for din ordre. Vi sørger for, at du får den tilsendt hurtigst muligt.",
    approved_actions: [{ type: "resend_confirmation_or_invoice" }],
  });
  assertEquals(r.compliant, true);
});

Deno.test("READINESS-6b: hedged pronoun promise ('efter godkendelse') → compliant", () => {
  const r = checkUnsupportedCommitments({
    draft_text:
      "Du har bedt om fakturaen. Efter godkendelse sørger vi for, at du får den tilsendt.",
  });
  assertEquals(r.compliant, true);
});

// ── READINESS-6c: color/variant exchange promises without an exchange action ─
// Night-probe A14: "Du skal blot returnere den hvide model til os, og vi vil
// derefter sende dig den sorte model." — an unconditional exchange promise
// with no exchange action, phrased without "ombytte"/"erstatning", so no
// exchange-family pattern matched.

Deno.test("READINESS-6c: 'vi vil derefter sende dig den sorte model' → unsupported_exchange_promise", () => {
  const r = checkUnsupportedCommitments({
    draft_text:
      "Du skal blot returnere den hvide model til os, og vi vil derefter sende dig den sorte model.",
  });
  assertEquals(r.compliant, false);
  assert(r.violations.some((v) => v.type === "unsupported_exchange_promise"));
});

Deno.test("READINESS-6c: inverted word order 'vil vi sende den sorte model til dig' → violation", () => {
  const r = checkUnsupportedCommitments({
    draft_text:
      "Når vi har modtaget og behandlet din returnering, vil vi sende den sorte model til dig.",
  });
  assertEquals(r.compliant, false);
  assert(r.violations.some((v) => v.type === "unsupported_exchange_promise"));
});

Deno.test("READINESS-6c: EN 'we'll then send you the black model' → violation", () => {
  const r = checkUnsupportedCommitments({
    draft_text:
      "Once we receive the white one, we'll then send you the black model.",
  });
  assertEquals(r.compliant, false);
  assert(r.violations.some((v) => v.type === "unsupported_exchange_promise"));
});

Deno.test("READINESS-6c: authorized by an exchange action → compliant", () => {
  const r = checkUnsupportedCommitments({
    draft_text:
      "Du skal blot returnere den hvide model til os, og vi vil derefter sende dig den sorte model.",
    approved_actions: [{ type: "create_exchange_request" }],
  });
  assertEquals(r.compliant, true);
});

Deno.test("READINESS-6c: policy info 'du kan bytte varen inden for 30 dage' stays compliant", () => {
  const r = checkUnsupportedCommitments({
    draft_text: "Du kan bytte varen inden for 30 dage, hvis den er ubrugt.",
  });
  assertEquals(r.compliant, true);
});

Deno.test("READINESS-6c: 'vi sender dig et link' stays compliant (not a product promise)", () => {
  const r = checkUnsupportedCommitments({
    draft_text: "Vi sender dig et link til returportalen.",
  });
  assertEquals(r.compliant, true);
});
