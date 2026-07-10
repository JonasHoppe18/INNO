// @ts-nocheck
import { assertEquals } from "jsr:@std/assert@1";
import { parsePresentmentPrices } from "./shopify-presentment.ts";

Deno.test("parsePresentmentPrices maps currency code to amount from first variant", () => {
  const json = {
    data: {
      product: {
        variants: {
          edges: [
            {
              node: {
                presentmentPrices: {
                  edges: [
                    { node: { price: { amount: "199.00", currencyCode: "EUR" } } },
                    { node: { price: { amount: "1499.00", currencyCode: "DKK" } } },
                  ],
                },
              },
            },
          ],
        },
      },
    },
  };
  assertEquals(parsePresentmentPrices(json), { EUR: "199.00", DKK: "1499.00" });
});

Deno.test("parsePresentmentPrices returns empty object on malformed input", () => {
  assertEquals(parsePresentmentPrices(null), {});
  assertEquals(parsePresentmentPrices({ data: {} }), {});
});
