import { assert, assertStringIncludes } from "jsr:@std/assert@1";
import {
  buildCompactCoreRules,
  buildCoreRulesB,
  buildRefundStatusDirective,
  isRefundStatusRelevantForWriter,
  RESOLUTION_STAGE_DIRECTIVES,
} from "./writer.ts";
import { checkUnsupportedCommitments } from "./unsupported-commitment-check.ts";
import type { Order } from "../../_shared/integrations/commerce/types.ts";
import type { RefundStatus } from "./fact-resolver.ts";

// Live case (2026-07-29): a customer with a PAID, unfulfilled order (#1057)
// asked to cancel. Sona cancelled it correctly in Shopify, but the reply —
// "Jeg har annulleret din ordre #1057; den var endnu ikke afsendt. God dag!" —
// never mentioned the 399 kr that was never refunded. An unpaid cancellation
// (#1056) got the near-identical reply, which is how the gap surfaced: the
// writer treats paid and unpaid cancellations as the same case because it was
// never told the difference.
//
// The refund-status state machine (deriveRefundStatus/buildRefundStatusDirective)
// already existed and already handles this correctly — it just never reached
// the writer for a cancel_order intent, because the gate only fired for
// "refund" / "return" intents or an order that already carried refund rows.

function paidOrder(refunds: Order["refunds"] = []): Order {
  return {
    id: "1057",
    order_number: "1057",
    name: "#1057",
    email: "c@example.com",
    financial_status: "paid",
    fulfillment_status: "unfulfilled",
    cancelled_at: new Date().toISOString(),
    closed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    total_price: "399.00",
    currency: "DKK",
    refunds,
  } as unknown as Order;
}

function unpaidOrder(): Order {
  return { ...paidOrder(), financial_status: "pending" } as Order;
}

const NO_REFUND: RefundStatus = {
  state: "no_refund_issued",
  total_refunded: "0.00",
  currency: "DKK",
  last_refund_at: null,
  order_total: "399.00",
  refund_count: 0,
};

Deno.test("a paid cancellation makes refund status relevant to the writer", () => {
  assert(isRefundStatusRelevantForWriter("cancel", paidOrder()));
});

Deno.test("an unpaid cancellation does not — nothing to say about money", () => {
  assert(!isRefundStatusRelevantForWriter("cancel", unpaidOrder()));
});

Deno.test("cancellation is irrelevant to refund status for other intents unless refunds already exist", () => {
  assert(!isRefundStatusRelevantForWriter("tracking", paidOrder()));
});

Deno.test("existing behaviour for refund/return intents is unchanged", () => {
  assert(isRefundStatusRelevantForWriter("refund", unpaidOrder()));
  assert(isRefundStatusRelevantForWriter("return", unpaidOrder()));
});

Deno.test("cancel_order context states the order was paid and nothing was refunded yet", () => {
  const block = buildRefundStatusDirective(NO_REFUND, {
    context: "cancel_order",
  });
  assertStringIncludes(block.toLowerCase(), "betalt");
  assertStringIncludes(block.toLowerCase(), "ikke");
});

Deno.test("cancel_order context does not reuse the return-request evidence-ask wording", () => {
  // The default no_refund_issued phrasing tells the writer to ask for missing
  // proof of a return — nonsensical immediately after cancelling an order that
  // was never shipped. The cancel_order framing must not carry it over.
  const block = buildRefundStatusDirective(NO_REFUND, {
    context: "cancel_order",
  }).toLowerCase();
  assert(
    !block.includes("bed om det ene konkrete bevis"),
    `cancel_order directive must not ask for return proof, got: ${block}`,
  );
});

Deno.test("cancel_order context does not itself promise a refund in first person", () => {
  // unsupported-commitment-check flags "vi/jeg refunderer" as an unsupported
  // promise unless a refund_order action was approved — none is, here. If the
  // directive we author contains that phrase, the writer will very likely
  // copy it verbatim into the draft and trip the guard downstream.
  const block = buildRefundStatusDirective(NO_REFUND, {
    context: "cancel_order",
  });
  const check = checkUnsupportedCommitments({ draft_text: block });
  assert(
    check.compliant,
    `directive text itself reads as an unsupported refund promise: ${
      JSON.stringify(check.violations)
    }`,
  );
});

Deno.test("default context (no cancel_order) keeps the original return/refund phrasing", () => {
  // Regression pin: the pre-existing behaviour for actual return/refund
  // requests must be untouched by adding the cancel_order branch.
  const block = buildRefundStatusDirective(NO_REFUND);
  assertStringIncludes(block, "bed om det ene konkrete bevis");
});

Deno.test("full_refund_issued is unaffected by the cancel_order context", () => {
  const full: RefundStatus = { ...NO_REFUND, state: "full_refund_issued", total_refunded: "399.00" };
  const withContext = buildRefundStatusDirective(full, { context: "cancel_order" });
  const withoutContext = buildRefundStatusDirective(full);
  assertStringIncludes(withContext, "ER refunderet");
  assertStringIncludes(withoutContext, "ER refunderet");
});

// ── Tone: cancel_order confirmations must read like a colleague, not a log line ──
//
// Live output before this fix: "Jeg har annulleret din ordre #1057; den var
// endnu ikke afsendt. God dag!" — a semicolon fusing two facts with nothing
// human said in between. The closing itself ("God dag!") is house style and
// correct (see feedback_warm_closing_via_signature); the flat middle is not.
// This pins that the AUTHORED directive text — not a regex over generated
// output — carries the instruction, per the lesson from mønster 1 today:
// state the standard, don't chase paraphrases of its absence.

Deno.test("cancel_order directive instructs a colleague tone, not a log-line confirmation", () => {
  const text = RESOLUTION_STAGE_DIRECTIVES.cancel_order.toLowerCase();
  assertStringIncludes(text, "kollega");
});

Deno.test("cancel_order directive tells the writer to address payment status when relevant", () => {
  const text = RESOLUTION_STAGE_DIRECTIVES.cancel_order.toLowerCase();
  assertStringIncludes(text, "betalt");
});

Deno.test("the existing past-tense safety rule survives the tone addition", () => {
  // Regression pin: the CRITICAL past-tense-only-if-confirmed rule predates
  // this change and must not be dropped while rewording for tone.
  const text = RESOLUTION_STAGE_DIRECTIVES.cancel_order;
  assertStringIncludes(text, "KRITISK");
  assertStringIncludes(text, "er annulleret");
});

// ── Root cause of the live gap: a hardcoded rule buried in the system prompt
// contradicted the new refundStatusBlock ──
//
// The fix above (refundStatusBlock + stage tone) was deployed and verified
// live against dev, and STILL produced "Jeg har annulleret ordre #1053 for
// dig. Ordren var ikke afsendt." with no money mention. Root cause:
// buildCoreRulesB (the actual system prompt used alongside stageBlock/
// refundStatusBlock) contains its own POST-ACTION instruction: "Ved
// cancel_order må refund kun nævnes, hvis actionResult indeholder et faktisk
// refunderet beløb." That static blanket rule outranks the dynamically
// computed # Refunderingsstatus block in the writer's attention, because it
// sits inside the same "primary task" section. buildCompactCoreRules carries
// the identical contradiction for the small-model path.

Deno.test("buildCoreRulesB no longer blanket-forbids mentioning refund on cancel_order", () => {
  const text = buildCoreRulesB({ outcome: "executed", action_type: "cancel_order" });
  assert(
    !text.includes("Ved cancel_order må refund kun nævnes"),
    "the old blanket restriction must be removed — it silently overrides refundStatusBlock",
  );
});

Deno.test("buildCoreRulesB instead defers to the Refunderingsstatus block", () => {
  const text = buildCoreRulesB({ outcome: "executed", action_type: "cancel_order" }).toLowerCase();
  assertStringIncludes(text, "refunderingsstatus");
});

Deno.test("buildCompactCoreRules no longer blanket-forbids it either", () => {
  const text = buildCompactCoreRules({ outcome: "executed", action_type: "cancel_order" });
  assert(!text.includes("Nævn kun refund-beløb og 3-5 hverdage ved refund_order eller når actionResult"));
});

Deno.test("buildCompactCoreRules also defers to the Refunderingsstatus block", () => {
  const text = buildCompactCoreRules({ outcome: "executed", action_type: "cancel_order" }).toLowerCase();
  assertStringIncludes(text, "refunderingsstatus");
});

Deno.test("no actionResult means no POST-ACTION section is added at all (regression)", () => {
  assert(!buildCoreRulesB(null).includes("POST-ACTION"));
  assert(!buildCompactCoreRules(null).includes("POST-ACTION"));
});
