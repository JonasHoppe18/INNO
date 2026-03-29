import { assertEquals, assertMatch } from "jsr:@std/assert@1";

import { guardReturnReplyWithoutOrderContext } from "./return-order-gate.ts";

Deno.test("return order gate suppresses premature instructions when order is unknown", () => {
  const input = `Hello,\n\nYou can return your headset for an RMA within 30 days of purchase. You will need to cover the return shipping costs and send it to: AceZone, Nordre Fasanvej 113, 2nd floor, 2000 Frederiksberg, Denmark.`;
  const result = guardReturnReplyWithoutOrderContext({
    text: input,
    languageHint: "en",
    knownOrderNumber: false,
  });

  assertEquals(result.changed, true);
  assertEquals(result.instructionsSuppressed, true);
  assertMatch(result.text, /reply in this thread with your order number/i);
  assertEquals(/Nordre Fasanvej/i.test(result.text), false);
});

Deno.test("return order gate uses personal greeting when name is known", () => {
  const input = `Hello,\n\nTo begin the RMA process, please return the headset within 30 days.`;
  const result = guardReturnReplyWithoutOrderContext({
    text: input,
    languageHint: "en",
    knownOrderNumber: false,
    customerFirstName: "An",
  });

  assertEquals(result.changed, true);
  assertMatch(result.text, /^Hi An,/);
});

Deno.test("return order gate keeps safe message when it already asks for order number", () => {
  const input = "Hi An,\n\nPlease reply in this thread with your order number so we can start the RMA.";
  const result = guardReturnReplyWithoutOrderContext({
    text: input,
    languageHint: "en",
    knownOrderNumber: false,
  });

  assertEquals(result.changed, false);
  assertEquals(result.reason, "already_safe");
});

Deno.test("return order gate normalizes safe greeting to personal name when available", () => {
  const input = "Hello,\n\nPlease share your order number in this conversation so we can start the RMA process for you.";
  const result = guardReturnReplyWithoutOrderContext({
    text: input,
    languageHint: "en",
    knownOrderNumber: false,
    customerFirstName: "An",
  });

  assertEquals(result.changed, true);
  assertEquals(result.reason, "already_safe_greeting_normalized");
  assertMatch(result.text, /^Hi An,/);
});

Deno.test("return order gate does nothing when order is known", () => {
  const input = "Hi An,\n\nYou can return the item within 30 days.";
  const result = guardReturnReplyWithoutOrderContext({
    text: input,
    languageHint: "en",
    knownOrderNumber: true,
  });

  assertEquals(result.changed, false);
  assertEquals(result.reason, "known_order_number");
});
