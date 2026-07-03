// deno test --no-check -A supabase/functions/generate-draft-v2/stages/live-fact-action-claim-check.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { checkLiveFactAndActionClaims } from "./live-fact-action-claim-check.ts";
import type { ResolvedFact } from "./fact-resolver.ts";
import type { TrackingFact } from "../../_shared/tracking/normalized-tracking.ts";

const carrierTrackingFact: ResolvedFact = {
  label: "Tracking (fragtmand)",
  value: "GLS — Sporingsnummer: 123 — Pakke-status fra Shopify: I transit",
};
const notYetShippedFact: ResolvedFact = {
  label: "Tracking",
  value: "Ordren er endnu ikke afsendt",
};
const deliveredTimestampFact: ResolvedFact = {
  label: "Leveret tidspunkt",
  value: "3. juni 14:20",
};
const noRefundFact: ResolvedFact = {
  label: "Refunderingsstatus: ingen refundering udstedt",
  value: "Der er IKKE registreret en refundering på ordren.",
};
const fullRefundFact: ResolvedFact = {
  label: "Refunderingsstatus: fuld refundering udstedt",
  value: "Hele beløbet ER refunderet (199 DKK) den 3. juni.",
};

function outboundTracking(state: TrackingFact["state"]): TrackingFact {
  return {
    tracking_number: "123",
    carrier: "GLS",
    direction: "outbound",
    verification: "carrier_verified",
    state,
  };
}

// ── 1. Tracking claim WITH verified tracking fact → compliant ──────────────
Deno.test("tracking claim with verified carrier tracking fact → compliant", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text: "Here is your tracking number: 123. Your order has shipped.",
    facts: [carrierTrackingFact],
  });
  assertEquals(r.compliant, true);
  assertEquals(r.requires_review, false);
  assertEquals(r.violations.length, 0);
});

// ── 2. "Here is your tracking" with NO verified tracking → violation ────────
Deno.test("tracking-exists claim with no verified tracking → no_verified_tracking", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text: "Here is your tracking number, it is on its way.",
    facts: [],
  });
  assertEquals(r.compliant, false);
  assertEquals(r.requires_review, true);
  assert(r.violations.some((v) => v.type === "live_fact/no_verified_tracking"));
});

// ── 3. "shipped" with only a not-yet-shipped fact → violation ───────────────
Deno.test("shipped claim with only not-yet-shipped fact → no_verified_tracking", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text: "Good news — your order has shipped.",
    facts: [notYetShippedFact],
  });
  assertEquals(r.compliant, false);
  assert(r.violations.some((v) => v.type === "live_fact/no_verified_tracking"));
});

// ── 4. "delivered" with no delivered fact → violation ───────────────────────
Deno.test("delivered claim with no delivered fact → no_verified_delivery", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text: "Your package has been delivered.",
    facts: [notYetShippedFact],
  });
  assertEquals(r.compliant, false);
  assert(r.violations.some((v) => v.type === "live_fact/no_verified_delivery"));
});

Deno.test("delivered claim with verified delivered timestamp fact → compliant", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text: "Your package has been delivered.",
    facts: [carrierTrackingFact, deliveredTimestampFact],
  });
  assertEquals(r.compliant, true);
  assertEquals(r.violations.length, 0);
});

Deno.test("delivered claim supported by outbound delivered tracking fact → compliant", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text: "Your package has been delivered.",
    facts: [],
    tracking_facts: [outboundTracking("delivered")],
  });
  assertEquals(r.compliant, true);
});

// ── 5. Refund processed with no_refund_issued → violation ───────────────────
Deno.test("refund-issued claim with no_refund_issued fact → no_verified_refund", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text: "Your refund has been processed.",
    facts: [noRefundFact],
  });
  assertEquals(r.compliant, false);
  assert(r.violations.some((v) => v.type === "live_fact/no_verified_refund"));
});

// ── 6. Refund processed with verified full_refund_issued → compliant ────────
Deno.test("refund-issued claim with full_refund_issued fact → compliant", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text: "Your refund has been processed.",
    facts: [fullRefundFact],
  });
  assertEquals(r.compliant, true);
  assertEquals(r.violations.length, 0);
});

// ── 7. Invoice sent, no executed invoice action → violation ─────────────────
Deno.test("invoice-sent claim without executed invoice action → not_executed_invoice", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text: "I've sent the invoice to your email.",
    facts: [],
  });
  assertEquals(r.compliant, false);
  assert(r.violations.some((v) => v.type === "action/not_executed_invoice"));
});

// ── 8. Invoice sent WITH executed resend_confirmation_or_invoice → compliant ─
Deno.test("invoice-sent claim with executed invoice action → compliant", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text: "I've sent the invoice to your email.",
    facts: [],
    executed_action_types: ["resend_confirmation_or_invoice"],
  });
  assertEquals(r.compliant, true);
  assertEquals(r.violations.length, 0);
});

// ── 8b. AZ-1: "forwarded the invoice" (no executed action) → violation ──────
Deno.test("invoice-forwarded claim without executed invoice action → not_executed_invoice", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text: "I've forwarded the invoice to your email.",
    facts: [],
  });
  assertEquals(r.compliant, false);
  assert(r.violations.some((v) => v.type === "action/not_executed_invoice"));
});

// ── 8c. AZ-1: Danish "videresendt din faktura" (no executed action) → violation ──
Deno.test("Danish: invoice forwarded (videresendt) without executed action → not_executed_invoice", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text: "Jeg har videresendt din faktura.",
    facts: [],
  });
  assertEquals(r.compliant, false);
  assert(r.violations.some((v) => v.type === "action/not_executed_invoice"));
});

// ── 8d. AZ-1: forwarded invoice WITH executed invoice action → compliant ─────
Deno.test("invoice-forwarded claim with executed invoice action → compliant", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text: "Jeg har videresendt din faktura.",
    facts: [],
    executed_action_types: ["resend_confirmation_or_invoice"],
  });
  assertEquals(r.compliant, true);
  assertEquals(r.violations.length, 0);
});

// ── 8e. READINESS-4: request-noun variant "fakturaforespørgsel" (no executed
// action) → violation. A claim of having forwarded the *request* still
// implies an unexecuted action.
Deno.test("Danish: invoice-request forwarded (fakturaforespørgsel) without executed action → not_executed_invoice", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text: "Jeg har videresendt din fakturaforespørgsel.",
    facts: [],
  });
  assertEquals(r.compliant, false);
  assert(r.violations.some((v) => v.type === "action/not_executed_invoice"));
});

// ── 8f. READINESS-4: request-noun variant, split verb construction
// ("sendt ... videre") without executed action → violation.
Deno.test("Danish: invoice-request sent onward (sendt ... videre) without executed action → not_executed_invoice", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text: "Jeg har sendt din fakturaforespørgsel videre.",
    facts: [],
  });
  assertEquals(r.compliant, false);
  assert(r.violations.some((v) => v.type === "action/not_executed_invoice"));
});

// ── 8g. READINESS-4: request-noun variant WITH executed invoice action →
// compliant (same authorization scope as the base invoice family).
Deno.test("Danish: invoice-request forwarded claim with executed invoice action → compliant", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text: "Jeg har videresendt din fakturaforespørgsel.",
    facts: [],
    executed_action_types: ["resend_confirmation_or_invoice"],
  });
  assertEquals(r.compliant, true);
  assertEquals(r.violations.length, 0);
});

// ── 9. Order cancelled, no executed cancel → violation ──────────────────────
Deno.test("cancelled claim without executed cancel_order → not_executed_cancel", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text: "Your order has been cancelled.",
    facts: [],
  });
  assertEquals(r.compliant, false);
  assert(r.violations.some((v) => v.type === "action/not_executed_cancel"));
});

// ── 10. Order cancelled WITH executed cancel_order → compliant ──────────────
Deno.test("cancelled claim with executed cancel_order → compliant", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text: "Your order has been cancelled.",
    facts: [],
    executed_action_types: ["cancel_order"],
  });
  assertEquals(r.compliant, true);
});

// ── 11. Address updated, no executed update → violation ─────────────────────
Deno.test("address-updated claim without executed update → not_executed_address", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text: "I've updated your shipping address.",
    facts: [],
  });
  assertEquals(r.compliant, false);
  assert(r.violations.some((v) => v.type === "action/not_executed_address"));
});

// ── 12. Address updated WITH executed update_shipping_address → compliant ────
Deno.test("address-updated claim with executed update → compliant", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text: "I've updated your shipping address.",
    facts: [],
    executed_action_types: ["update_shipping_address"],
  });
  assertEquals(r.compliant, true);
});

// ── 13. Replacement sent/created, no executed replacement → violation ───────
Deno.test("replacement-sent claim without executed replacement → not_executed_replacement", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text: "We have created a replacement order for you.",
    facts: [],
  });
  assertEquals(r.compliant, false);
  assert(
    r.violations.some((v) => v.type === "action/not_executed_replacement"),
  );
});

// ── 14. Replacement WITH executed create_exchange_request → compliant ───────
Deno.test("replacement-sent claim with executed exchange action → compliant", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text: "We have created a replacement order for you.",
    facts: [],
    executed_action_types: ["create_exchange_request"],
  });
  assertEquals(r.compliant, true);
});

// ── 15. Safe wording must NOT flag ──────────────────────────────────────────
Deno.test("safe wording: asked shop manager to provide invoice → compliant", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text: "I've asked our shop manager to provide your invoice.",
    facts: [],
  });
  assertEquals(r.compliant, true);
  assertEquals(r.violations.length, 0);
});

Deno.test("safe wording: tracking not available yet → compliant", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text:
      "Tracking is not available yet. The order has not shipped yet.",
    facts: [notYetShippedFact],
  });
  assertEquals(r.compliant, true);
  assertEquals(r.violations.length, 0);
});

Deno.test("safe wording: ask for order number → compliant", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text:
      "Please send your order number so we can check the order. Cancellation requires approval.",
    facts: [],
  });
  assertEquals(r.compliant, true);
  assertEquals(r.violations.length, 0);
});

Deno.test("safe wording: refund will require approval, not yet issued → compliant", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text:
      "A refund requires approval and has not been issued yet. We'll arrange the next step once approved.",
    facts: [noRefundFact],
  });
  assertEquals(r.compliant, true);
  assertEquals(r.violations.length, 0);
});

// ── 16. Quoted customer text must not create false positives ────────────────
Deno.test("quoted customer text is ignored (not the assistant's claim)", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text:
      "Thank you for your message.\n> Your order has shipped and the invoice has been sent\nI can look into this once you confirm your order number.",
    facts: [],
  });
  assertEquals(r.compliant, true);
  assertEquals(r.violations.length, 0);
});

// ── 17. Mixed Danish coverage for highest-risk patterns ─────────────────────
Deno.test("Danish: shipped claim with no verified tracking → no_verified_tracking", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text: "Din ordre er blevet afsendt.",
    facts: [notYetShippedFact],
  });
  assertEquals(r.compliant, false);
  assert(r.violations.some((v) => v.type === "live_fact/no_verified_tracking"));
});

Deno.test("Danish: invoice sent without executed action → not_executed_invoice", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text: "Jeg har sendt fakturaen til dig.",
    facts: [],
  });
  assertEquals(r.compliant, false);
  assert(r.violations.some((v) => v.type === "action/not_executed_invoice"));
});

Deno.test("Danish: order cancelled without executed action → not_executed_cancel", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text: "Din ordre er blevet annulleret.",
    facts: [],
  });
  assertEquals(r.compliant, false);
  assert(r.violations.some((v) => v.type === "action/not_executed_cancel"));
});

Deno.test("Danish: refund issued with verified full refund → compliant", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text: "Beløbet er blevet refunderet.",
    facts: [fullRefundFact],
  });
  assertEquals(r.compliant, true);
});

// ── empty draft is trivially compliant ──────────────────────────────────────
Deno.test("empty draft → compliant", () => {
  const r = checkLiveFactAndActionClaims({ draft_text: "", facts: [] });
  assertEquals(r.compliant, true);
  assertEquals(r.requires_review, false);
});

// ── READINESS-6a: fabricated tracking-status / tracking-link claims ─────────
// Probe A2: the writer asserted carrier state and pasted a concrete tracking
// link for an order that does not exist. Probe A10: "din ordre #4602 allerede
// er afsendt" escaped the shipped-claim pattern because of the order number
// and "allerede" between "ordre" and "er afsendt".

Deno.test("Danish: 'trackingdataene viser' with no verified tracking → no_verified_tracking", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text:
      "Trackingdataene viser, at forsendelsen er blevet oprettet hos fragtmanden.",
    facts: [],
  });
  assertEquals(r.compliant, false);
  assert(r.violations.some((v) => v.type === "live_fact/no_verified_tracking"));
});

Deno.test("Danish: 'trackingen viser' with no verified tracking → no_verified_tracking", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text: "Trackingen viser, at pakken er i transit.",
    facts: [],
  });
  assertEquals(r.compliant, false);
  assert(r.violations.some((v) => v.type === "live_fact/no_verified_tracking"));
});

Deno.test("concrete tracking URL (carrier + embedded number) with no verified tracking → no_verified_tracking", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text:
      "Du kan følge pakken her: https://gls-group.eu/DK/da/find-pakke?match=055463231638&txtAction=71000",
    facts: [],
  });
  assertEquals(r.compliant, false);
  assert(r.violations.some((v) => v.type === "live_fact/no_verified_tracking"));
});

Deno.test("concrete tracking URL WITH verified carrier tracking fact → compliant", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text:
      "Du kan følge pakken her: https://gls-group.eu/DK/da/find-pakke?match=055463231638",
    facts: [carrierTrackingFact],
  });
  assertEquals(r.compliant, true);
});

Deno.test("generic tracking portal link without a tracking number → compliant", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text:
      "Du kan altid slå pakken op på https://gls-group.eu/DK/da/find-pakke med dit trackingnummer.",
    facts: [],
  });
  assertEquals(
    r.violations.some((v) =>
      v.type === "live_fact/no_verified_tracking" &&
      v.excerpt.includes("gls-group")
    ),
    false,
  );
});

Deno.test("Danish: 'din ordre #4602 allerede er afsendt' with no verified tracking → no_verified_tracking", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text:
      "Da din ordre #4602 allerede er afsendt, kan vi desværre ikke ændre leveringsadressen.",
    facts: [],
  });
  assertEquals(r.compliant, false);
  assert(r.violations.some((v) => v.type === "live_fact/no_verified_tracking"));
});

Deno.test("Danish: 'ordren er allerede afsendt' variant with verified tracking → compliant", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text: "Din ordre #4602 allerede er afsendt.",
    facts: [carrierTrackingFact],
  });
  assertEquals(r.compliant, true);
});

Deno.test("Danish: 'ordren er endnu ikke afsendt' stays compliant (hedge)", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text: "Din ordre er endnu ikke afsendt.",
    facts: [],
  });
  assertEquals(r.compliant, true);
});

Deno.test("Danish: conditional 'hvis tracking viser leveret' (customer-referential) stays compliant", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text:
      "Det er ærgerligt at høre, hvis tracking viser leveret, betyder det ikke nødvendigvis, at du personligt har modtaget pakken.",
    facts: [],
  });
  assertEquals(r.compliant, true);
});

Deno.test("EN: conditional 'if the tracking shows delivered' stays compliant", () => {
  const r = checkLiveFactAndActionClaims({
    draft_text:
      "If the tracking shows delivered but you have not received the parcel, please check with neighbours first.",
    facts: [],
  });
  assertEquals(r.compliant, true);
});
