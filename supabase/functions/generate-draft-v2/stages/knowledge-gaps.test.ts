import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { detectMissingLiveDataGaps } from "./knowledge-gaps.ts";

Deno.test("unknown inventory fact becomes a concrete internal knowledge gap", () => {
  const [gap] = detectMissingLiveDataGaps({
    intent: "product_question",
    facts: [{
      label: "Live stock availability",
      value:
        "state=unknown; product_query=A-Rise ear pads; reason=not_found; source=shopify_live",
    }],
  });

  assertEquals(gap.gap_type, "missing_live_data");
  assertEquals(gap.fact_type, "inventory");
  assertEquals(gap.product, "A-Rise ear pads");
  assertEquals(gap.reason, "not_found");
  assertEquals(gap.internal_only, true);
  assertStringIncludes(gap.suggested_title, "A-Rise ear pads");
  assertStringIncludes(gap.recommended_action ?? "", "inventory source");
});

Deno.test("verified inventory states do not create missing-data alerts", () => {
  for (const state of ["in_stock", "out_of_stock", "low_stock", "preorder"]) {
    assertEquals(
      detectMissingLiveDataGaps({
        intent: "product_question",
        facts: [{
          label: "Live stock availability",
          value:
            `state=${state}; product=A-Spire Wireless; source=shopify_live`,
        }],
      }),
      [],
    );
  }
});

Deno.test("variant clarification is a customer question, not missing store data", () => {
  assertEquals(
    detectMissingLiveDataGaps({
      intent: "product_question",
      facts: [{
        label: "Live stock availability",
        value:
          "state=variant_clarification_required; product=A-Spire Wireless; variants=Black|White; source=shopify_live",
      }],
    }),
    [],
  );
});

Deno.test("unrelated facts never create an inventory alert", () => {
  assertEquals(
    detectMissingLiveDataGaps({
      intent: "product_question",
      facts: [{ label: "Order found", value: "order=#1001" }],
    }),
    [],
  );
});
