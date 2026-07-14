// @ts-nocheck
import { assertEquals } from "jsr:@std/assert@1";
import { parsePresentmentPrices, parsePrimaryMarketCurrency } from "./shopify-presentment.ts";

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

Deno.test("parsePrimaryMarketCurrency uses primary market's explicit currency", () => {
  assertEquals(
    parsePrimaryMarketCurrency({
      data: {
        shop: { currencyCode: "EUR" },
        markets: {
          edges: [
            { node: { primary: false, currencySettings: { baseCurrency: { currencyCode: "DKK" } } } },
            { node: { primary: true, currencySettings: { baseCurrency: { currencyCode: "USD" } } } },
          ],
        },
      },
    }),
    "USD",
  );
});

Deno.test("parsePrimaryMarketCurrency falls back to shop base when primary market has null currencySettings", () => {
  // Real shape from AceZone 2026-07-14: primary market (Germany) returns
  // currencySettings: null — Shopify implies the shop base currency there.
  assertEquals(
    parsePrimaryMarketCurrency({
      data: {
        shop: { currencyCode: "EUR" },
        markets: {
          edges: [
            { node: { primary: false, currencySettings: { baseCurrency: { currencyCode: "DKK" } } } },
            { node: { primary: true, currencySettings: null } },
          ],
        },
      },
    }),
    "EUR",
  );
});

Deno.test("parsePrimaryMarketCurrency returns null on malformed input", () => {
  assertEquals(parsePrimaryMarketCurrency(null), null);
  assertEquals(parsePrimaryMarketCurrency({ data: {} }), null);
});
