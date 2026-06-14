import { assert, assertStringIncludes } from "jsr:@std/assert@1";
import { buildStockAvailabilityDirective } from "./writer.ts";

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
  assertStringIncludes(block, "currently available");
  assertStringIncludes(block, "do not include exact quantity");
});

Deno.test("out_of_stock fact allows out of stock wording without restock promise", () => {
  const block = buildStockAvailabilityDirective([{
    label: "Live stock availability",
    value: "state=out_of_stock; product=A-Blaze; variant=default; source=shopify_live",
  }]).toLowerCase();
  assertStringIncludes(block, "out of stock");
  assertStringIncludes(block, "no confirmed restock date");
});

Deno.test("mixed variants ask for version or color", () => {
  const block = buildStockAvailabilityDirective([{
    label: "Live stock availability",
    value: "state=variant_clarification_required; product=A-Spire Wireless; variants=Black|White; source=shopify_live",
  }]).toLowerCase();
  assertStringIncludes(block, "ask the customer");
  assert(/version|color|variant/.test(block));
});

Deno.test("unknown stock fact says live availability cannot be confirmed", () => {
  const block = buildStockAvailabilityDirective([{
    label: "Live stock availability",
    value: "state=unknown; product_query=A-Rise; reason=not_found; source=shopify_live",
  }]).toLowerCase();
  assertStringIncludes(block, "cannot confirm live availability");
});

