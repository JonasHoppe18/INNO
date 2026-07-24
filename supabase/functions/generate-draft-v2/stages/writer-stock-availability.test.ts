import { assert, assertStringIncludes } from "jsr:@std/assert@1";
import {
  buildStockAvailabilityDirective,
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
  assertStringIncludes(block, "lagerstatus på a-rise bekræftet");
  assert(!block.includes("cannot confirm live availability"));
  assert(!block.includes("cannot see the stock status"));
});

Deno.test("ambiguous stock lookup asks one concrete product question", () => {
  const block = buildStockAvailabilityDirective([{
    label: "Live stock availability",
    value: "state=unknown; product_query=A-Spire; reason=ambiguous_product; source=shopify_live",
  }]).toLowerCase();
  assertStringIncludes(block, "ask one concrete question");
  assertStringIncludes(block, "exact model");
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
