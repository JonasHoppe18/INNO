import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  buildReplacementFlowDirective,
  type ConversationTurn,
  countFailedAttempts,
  detectAgentProvidedTroubleshooting,
  detectPrematureReplacementShipment,
  isPurchaseSourceStated,
  isReplacementRequest,
  isTroubleshootingExhausted,
  replacementIntentOverride,
  resolveReplacementFlowState,
} from "./replacement-flow.ts";

// Simulated A-Spire Wireless conversation (oldest → newest).
const aspireHistory: ConversationTurn[] = [
  { role: "customer", text: "Hej jeg kan ikke connecte mit A-spire wireless med bluetooth." },
  { role: "agent", text: "Prøv at parre headsettet via Bluetooth: glem enheden og forbind igen." },
  { role: "customer", text: "Det virker ikke, den vil stadig ikke forbinde" },
  { role: "agent", text: "Prøv at opdatere firmware på dit headset." },
  { role: "customer", text: "Jeg kan stadig ikke connecte mit aspire wireless via bluetooth" },
  { role: "agent", text: "Prøv at parre headsettet via Bluetooth igen." },
];

Deno.test("detects agent-provided troubleshooting topics (bluetooth + firmware)", () => {
  const topics = detectAgentProvidedTroubleshooting(aspireHistory);
  assert(topics.includes("bluetooth_pairing"));
  assert(topics.includes("firmware_update"));
});

Deno.test("counts repeated customer failure reports", () => {
  const n = countFailedAttempts(aspireHistory, "virker ikke. Kan jeg få et nyt?");
  assert(n >= 2, `expected >=2 failures, got ${n}`);
});

Deno.test("replacement request detection (DA + EN)", () => {
  assert(isReplacementRequest("virker ikke. Kan jeg få et nyt?"));
  assert(isReplacementRequest("Can I get a new one?"));
  assert(isReplacementRequest("Jeg vil gerne have en ombytning"));
  assertEquals(isReplacementRequest("Hvordan parrer jeg headsettet?"), false);
});

Deno.test("purchase-source detection (DA + EN)", () => {
  assert(isPurchaseSourceStated("Jeg har købt det via jeres hjemmeside"));
  assert(isPurchaseSourceStated("I bought it from your website"));
  assertEquals(isPurchaseSourceStated("Det virker ikke"), false);
});

Deno.test("troubleshooting exhausted after firmware + failure", () => {
  assert(isTroubleshootingExhausted({ alreadyProvidedTopics: ["bluetooth_pairing", "firmware_update"], failedAttempts: 2 }));
  assert(isTroubleshootingExhausted({ alreadyProvidedTopics: ["firmware_update"], failedAttempts: 1 }));
  assertEquals(isTroubleshootingExhausted({ alreadyProvidedTopics: ["bluetooth_pairing"], failedAttempts: 0 }), false);
});

Deno.test("intent override upgrades weak intent on replacement flow", () => {
  const state = resolveReplacementFlowState({
    history: aspireHistory,
    latestMessage: "virker ikke. Kan jeg få et nyt?",
    purchaseSourceKnown: false,
    orderNumberKnown: false,
  });
  assertEquals(replacementIntentOverride(state, "other"), "exchange");
  assertEquals(replacementIntentOverride(state, "product_question"), "exchange");
  // Does not override a strong, already-correct intent.
  assertEquals(replacementIntentOverride(state, "refund"), null);
});

Deno.test("directive: does not repeat already-given steps", () => {
  const state = resolveReplacementFlowState({
    history: aspireHistory,
    latestMessage: "Jeg kan stadig ikke connecte mit aspire wireless via bluetooth",
    purchaseSourceKnown: false,
    orderNumberKnown: false,
  });
  const d = buildReplacementFlowDirective(state);
  assert(/Do NOT repeat these steps/i.test(d));
  assert(/Bluetooth pairing steps/i.test(d));
});

Deno.test("directive: replacement asked, purchase source unknown → ask where purchased", () => {
  const state = resolveReplacementFlowState({
    history: aspireHistory,
    latestMessage: "virker ikke. Kan jeg få et nyt?",
    purchaseSourceKnown: false,
    orderNumberKnown: false,
  });
  const d = buildReplacementFlowDirective(state);
  assert(/where the product was purchased/i.test(d));
  assert(/Do NOT yet say a new unit will be sent/i.test(d));
});

Deno.test("directive: purchase source known, order missing → ask order, forbid shipment language", () => {
  const state = resolveReplacementFlowState({
    history: [...aspireHistory, { role: "customer", text: "virker ikke. Kan jeg få et nyt?" }],
    latestMessage: "Jeg har købt det via jeres hjemmeside",
    purchaseSourceKnown: true,
    orderNumberKnown: false,
  });
  const d = buildReplacementFlowDirective(state);
  assert(/ask for the order number/i.test(d));
  assert(/MUST NOT say a new unit will be sent/i.test(d));
});

Deno.test("directive: order known → proceed, no fabricated shipment", () => {
  const state = resolveReplacementFlowState({
    history: [...aspireHistory, { role: "customer", text: "Kan jeg få et nyt?" }],
    latestMessage: "Jeg har købt det via jeres hjemmeside, ordre #12345",
    purchaseSourceKnown: true,
    orderNumberKnown: true,
  });
  const d = buildReplacementFlowDirective(state);
  assert(/order is identified. Proceed/i.test(d));
  assert(/Do NOT fabricate a shipment/i.test(d));
  assert(!/ask for the order number/i.test(d));
});

Deno.test("verifier guard: premature shipment without order is flagged", () => {
  const draft = "Jeg sørger for, at vi sender et nyt headset til dig. Du vil modtage en bekræftelse, når det er afsendt.";
  assertEquals(
    detectPrematureReplacementShipment(draft, { orderKnown: false }),
    ["premature_replacement_no_order"],
  );
  // No flag once the order is identified.
  assertEquals(detectPrematureReplacementShipment(draft, { orderKnown: true }), []);
});

Deno.test("verifier guard: safe order-request draft is not flagged", () => {
  const draft = "Da fejlfindingen ikke har løst problemet, kan vi gå videre med en ombytning. Send gerne dit ordrenummer.";
  assertEquals(detectPrematureReplacementShipment(draft, { orderKnown: false }), []);
});
