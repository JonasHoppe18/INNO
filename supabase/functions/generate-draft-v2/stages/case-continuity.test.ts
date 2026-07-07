import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { buildCaseContinuityDirective } from "./case-continuity.ts";

// Multi-turn continuity (sent-edit analysis 2026-07-07): the case-state
// already captured "purchased_from_third_party: Maxgaming.se" (Daniel) and
// "shipping_arranged_asap" (Eric), but the writer only saw passive info blocks
// and answered the literal latest question — a human colleague routes warranty
// to the reseller and continues the active arrangement first.

function mk(decisions: string[], purchasePlace: string | null = null) {
  return {
    intents: [],
    entities: {
      order_numbers: [],
      customer_email: "",
      products_mentioned: [],
      purchase_place: purchasePlace,
    },
    decisions_made: decisions.map((d) => ({ decision: d, timestamp: "t" })),
    open_questions: [],
    pending_asks: [],
    language: "da",
    last_updated_msg_id: "",
  } as never;
}

Deno.test("third-party purchase (entity) yields reseller-routing directive", () => {
  const d = buildCaseContinuityDirective(mk([], "third_party:Maxgaming.se"));
  assertStringIncludes(d, "TREDJEPART");
  assertStringIncludes(d, "Maxgaming.se");
  assertStringIncludes(d, "spørg IKKE igen hvor produktet er købt");
});

Deno.test("third-party purchase captured only as decision string also fires", () => {
  const d = buildCaseContinuityDirective(
    mk(["purchased_from_third_party: Maxgaming.se"]),
  );
  assertStringIncludes(d, "TREDJEPART");
  assertStringIncludes(d, "Maxgaming.se");
});

Deno.test("active arrangement yields continue-flow directive", () => {
  for (
    const decision of [
      "shipping_arranged_asap",
      "awaiting_tracking_from_warehouse",
      "manual_order_requested_awaiting_tracking",
      "back_order_placed_invoice_in_august",
      "replacement_sent",
    ]
  ) {
    const d = buildCaseContinuityDirective(mk([decision]));
    assertStringIncludes(d, "AKTIVT FLOW", decision);
    assertStringIncludes(d, decision);
  }
});

Deno.test("own-store purchase and plain decisions yield no directive", () => {
  assertEquals(buildCaseContinuityDirective(mk([], "own_store")), "");
  assertEquals(buildCaseContinuityDirective(mk(["address_confirmed: X"])), "");
  assertEquals(buildCaseContinuityDirective(mk([])), "");
});

// Persisted case-states can carry the AGENT's own asks in open_questions
// ("Er det muligt for dig at tage en video?") — the writer then 'answers'
// its own question as if the customer asked it ("Jeg kan desværre ikke tage
// en video"). Second-person-directed request forms are agent asks, not
// customer problems; filter them deterministically at render time.
import { filterCustomerOpenQuestions } from "./case-continuity.ts";

Deno.test("filters agent-ask-shaped questions (DA + EN)", () => {
  const out = filterCustomerOpenQuestions([
    "Er det muligt for dig at tage en video af selve headsettet, hvor lyden kan høres?",
    "Kan du sende dit ordrenummer?",
    "Could you please confirm your shipping address?",
    "Can you send us a photo of the damage?",
  ]);
  assertEquals(out, []);
});

Deno.test("keeps genuine customer problems and questions", () => {
  const qs = [
    "A-Blaze headset kan ikke parre til PC",
    "Hvorfor er min refundering ikke kommet endnu?",
    "Why does the headset disconnect briefly before shutting off?",
    "Headset tænder ikke",
  ];
  assertEquals(filterCustomerOpenQuestions(qs), qs);
});
