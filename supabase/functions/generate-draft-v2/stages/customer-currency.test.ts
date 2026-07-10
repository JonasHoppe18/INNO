// @ts-nocheck
import { assertEquals } from "jsr:@std/assert@1";
import { resolveCustomerCurrency } from "./customer-currency.ts";

Deno.test("order currency wins over everything", () => {
  assertEquals(resolveCustomerCurrency({
    orderCurrency: "SEK", customerLanguage: "da", primaryMarketCurrency: "DKK", baseCurrency: "EUR",
  }), "SEK");
});

Deno.test("Danish language maps to DKK when no order", () => {
  assertEquals(resolveCustomerCurrency({
    customerLanguage: "da", primaryMarketCurrency: "DKK", baseCurrency: "EUR",
  }), "DKK");
});

Deno.test("falls back to primary market, then base", () => {
  assertEquals(resolveCustomerCurrency({ customerLanguage: "en", primaryMarketCurrency: "DKK" }), "DKK");
  assertEquals(resolveCustomerCurrency({ baseCurrency: "EUR" }), "EUR");
  assertEquals(resolveCustomerCurrency({}), null);
});
