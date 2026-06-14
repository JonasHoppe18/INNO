import { assertEquals } from "jsr:@std/assert@1";
import { detectUnsupportedStockClaims } from "./verifier.ts";

Deno.test("blocks ungrounded in-stock claim", () => {
  assertEquals(
    detectUnsupportedStockClaims("Yes, A-Spire Wireless is currently available in our store.", []),
    ["unsupported_stock_claim"],
  );
});

Deno.test("allows grounded in-stock claim", () => {
  assertEquals(
    detectUnsupportedStockClaims("Yes, A-Spire Wireless is currently available in our store.", [{
      label: "Live stock availability",
      value: "state=in_stock; product=A-Spire Wireless; source=shopify_live",
    }]),
    [],
  );
});

Deno.test("blocks ungrounded restock date", () => {
  assertEquals(
    detectUnsupportedStockClaims("A-Blaze will be back in stock next week.", []),
    ["unsupported_stock_claim", "unsupported_restock_promise"],
  );
});

Deno.test("blocks ungrounded preorder promise", () => {
  assertEquals(
    detectUnsupportedStockClaims("Yes, preorder is available for this item.", []),
    ["unsupported_preorder_promise"],
  );
});

Deno.test("blocks exact customer-facing stock quantity", () => {
  assertEquals(
    detectUnsupportedStockClaims("There are 7 units available.", [{
      label: "Live stock availability",
      value: "state=in_stock; product=A-Spire Wireless; source=shopify_live",
    }]),
    ["unsupported_stock_quantity"],
  );
});
