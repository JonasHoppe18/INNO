import { assertEquals } from "jsr:@std/assert@1";
import { detectVerifiedOrderProofAsks } from "./verified-order-proof-ask.ts";

// T-051002 live failure (v318): order #3955 was VERIFIED via the contact-form
// order field, the exact_order_number directive forbids proof-of-purchase
// asks — and the writer still asked "confirm if the headset is still under
// warranty by providing the purchase details or receipt". Prompt instructions
// alone are not reliable; this deterministic check backs the directive.

const VERIFIED = "exact_order_number";

Deno.test("flags the live T-051002 receipt ask", () => {
  const v = detectVerifiedOrderProofAsks(
    "Could you please confirm if the headset is still under warranty by providing the purchase details or receipt?",
    VERIFIED,
  );
  assertEquals(v.length > 0, true);
});

Deno.test("flags where-did-you-buy asks (EN + DA)", () => {
  for (
    const text of [
      "Could you please confirm where you purchased the headset?",
      "Kan du oplyse hvor du har købt produktet?",
      "Kan du bekræfte købsstedet?",
    ]
  ) {
    assertEquals(
      detectVerifiedOrderProofAsks(text, VERIFIED).length > 0,
      true,
      text,
    );
  }
});

Deno.test("flags redundant order-number and receipt asks (EN + DA)", () => {
  for (
    const text of [
      "Please send us your order number so we can locate the purchase.",
      "Kan du sende din kvittering eller ordrebekræftelse?",
      "Please attach the invoice or proof of purchase.",
    ]
  ) {
    assertEquals(
      detectVerifiedOrderProofAsks(text, VERIFIED).length > 0,
      true,
      text,
    );
  }
});

Deno.test("does not flag mere order mentions or photo asks", () => {
  for (
    const text of [
      "I can see your order #3955 was shipped on 27/02.",
      "Please provide clear photos showing the damage.",
      "Din ordre #3955 er afsendt — vi kigger på en erstatning.",
      "The warranty covers this repair.",
    ]
  ) {
    assertEquals(detectVerifiedOrderProofAsks(text, VERIFIED), [], text);
  }
});

Deno.test("inactive when the order is not verified", () => {
  const ask = "Could you confirm where you purchased the headset?";
  assertEquals(detectVerifiedOrderProofAsks(ask, "order_not_found"), []);
  assertEquals(detectVerifiedOrderProofAsks(ask, null), []);
  assertEquals(detectVerifiedOrderProofAsks(ask, undefined), []);
});

Deno.test("empty draft yields no violations", () => {
  assertEquals(detectVerifiedOrderProofAsks("", VERIFIED), []);
});
