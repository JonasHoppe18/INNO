import { assert, assertStringIncludes } from "jsr:@std/assert@1";
import {
  buildStockAvailabilityDirective,
  stripUnaskedStockShoppingFiller,
  stripUnaskedRestockTiming,
} from "./writer.ts";

Deno.test("no live stock fact forbids availability claims from stale sources", () => {
  const block = buildStockAvailabilityDirective([]).toLowerCase();
  assertStringIncludes(block, "no live shopify stock availability fact");
  assertStringIncludes(block, "do not claim");
  assertStringIncludes(block, "knowledge-base");
});

Deno.test("in_stock fact allows currently available wording without exact quantity", () => {
  const block = buildStockAvailabilityDirective([{
    label: "Live stock availability",
    value: "state=in_stock; product=A-Spire Wireless; variant=all_variants; source=shopify_live; exact_quantity_hidden=true",
  }]).toLowerCase();
  assertStringIncludes(block, "is in stock right now");
  assertStringIncludes(block, "include exact quantity");
  assert(!block.includes("appears to be"));
});

Deno.test("out_of_stock fact allows out of stock wording without restock promise", () => {
  const block = buildStockAvailabilityDirective([{
    label: "Live stock availability",
    value: "state=out_of_stock; product=A-Blaze; variant=default; source=shopify_live",
  }]).toLowerCase();
  assertStringIncludes(block, "out of stock");
  assertStringIncludes(block, "only discuss a restock date if the customer asked");
  assert(!block.includes("appears to be"));
});

Deno.test("mixed variants ask for version or color", () => {
  const block = buildStockAvailabilityDirective([{
    label: "Live stock availability",
    value: "state=variant_clarification_required; product=A-Spire Wireless; variants=Black|White; source=shopify_live",
  }]).toLowerCase();
  assertStringIncludes(block, "ask one concrete question");
  assert(/version|color|variant/.test(block));
});

Deno.test("unknown stock fact uses employee wording instead of live-data wording", () => {
  const block = buildStockAvailabilityDirective([{
    label: "Live stock availability",
    value: "state=unknown; product_query=A-Rise; reason=not_found; source=shopify_live",
  }]).toLowerCase();
  assertStringIncludes(block, "jeg undersøger lagerstatus på a-rise");
  assertStringIncludes(block, "i’ll check the stock status for a-rise");
  assertStringIncludes(block, "availability is unclear/unknown");
  assert(!block.includes("cannot confirm live availability"));
  assert(!block.includes("cannot see the stock status"));
});

Deno.test("ambiguous internal product match does not bounce the lookup back to the customer", () => {
  const block = buildStockAvailabilityDirective([{
    label: "Live stock availability",
    value: "state=unknown; product_query=A-Spire; reason=ambiguous_product; source=shopify_live",
  }]).toLowerCase();
  assertStringIncludes(block, "customer already identified");
  assertStringIncludes(block, "internal check");
  assert(!block.includes("ask one concrete question"));
});

Deno.test("no live stock fact warns about shopify_product catalog chunks", () => {
  const block = buildStockAvailabilityDirective([]).toLowerCase();
  assertStringIncludes(block, "shopify product catalog chunks");
  assertStringIncludes(block, "not proof");
  assertStringIncludes(block, "shopify_product_not_live");
});

Deno.test("simple stock question removes unasked restock timing", () => {
  assert(
    stripUnaskedRestockTiming(
      "Hi there,\n\nThe A-Rise is out of stock. Unfortunately, there is no confirmed restock date at the moment.",
      "Is the A-Rise in stock right now?",
    ) === "Hi there,\n\nThe A-Rise is out of stock.",
  );
  assert(
    stripUnaskedRestockTiming(
      "Hej,\n\nA-Rise er udsolgt lige nu. Vi har desværre ikke en bekræftet dato for, hvornår den kommer på lager igen.",
      "Har I A-Rise på lager?",
    ) === "Hej,\n\nA-Rise er udsolgt lige nu.",
  );
});

Deno.test("simple stock question removes unsupported interest and restock notification offers", () => {
  assert(
    stripUnaskedRestockTiming(
      "Hej,\n\nA-Rise stoførepuder er desværre ikke på lager lige nu. Vi kan notere din interesse og kontakte dig, når de er tilgængelige igen. Lad mig vide, hvis du ønsker det.",
      "Har I A-Rise stoførepuder på lager?",
    ) ===
      "Hej,\n\nA-Rise stoførepuder er desværre ikke på lager lige nu.",
  );
  assert(
    stripUnaskedRestockTiming(
      "Hi,\n\nA-Rise ear pads are out of stock. Would you like me to note your interest so we can contact you if they restock?",
      "Are A-Rise ear pads in stock?",
    ) === "Hi,\n\nA-Rise ear pads are out of stock.",
  );
});

Deno.test("restock timing is kept when the customer asks when it returns", () => {
  const draft =
    "The A-Rise is out of stock. Unfortunately, there is no confirmed restock date yet.";
  assert(
    stripUnaskedRestockTiming(
      draft,
      "When will the A-Rise be back in stock?",
    ) === draft,
  );
});

Deno.test("simple stock question removes generic webshop shopping filler", () => {
  assert(
    stripUnaskedStockShoppingFiller(
      "Hej,\n\nA-Spire er på lager lige nu. Du kan finde det i vores webshop.",
      "Har I A-Spire på lager?",
    ) === "Hej,\n\nA-Spire er på lager lige nu.",
  );
  assert(
    stripUnaskedStockShoppingFiller(
      "Hi,\n\nA-Spire is in stock. You can find it in our online store.",
      "Is A-Spire in stock?",
    ) === "Hi,\n\nA-Spire is in stock.",
  );
});

Deno.test("purchase-link requests keep shopping guidance", () => {
  const draft =
    "A-Spire is in stock. You can find it in our online store.";
  assert(
    stripUnaskedStockShoppingFiller(
      draft,
      "Where can I buy A-Spire? Please send the product link.",
    ) === draft,
  );
});
