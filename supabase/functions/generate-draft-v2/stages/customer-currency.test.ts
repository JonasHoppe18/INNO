// @ts-nocheck
import { assertEquals } from "jsr:@std/assert@1";
import { resolveCustomerCurrency } from "./customer-currency.ts";

Deno.test("order currency wins over everything", () => {
  assertEquals(resolveCustomerCurrency({
    orderCurrency: "SEK", customerCountry: "US", customerLanguage: "da", primaryMarketCurrency: "DKK", baseCurrency: "EUR",
  }), "SEK");
});

Deno.test("customer country wins over language (US customer writing Danish gets USD)", () => {
  assertEquals(resolveCustomerCurrency({
    customerCountry: "US", customerLanguage: "da", primaryMarketCurrency: "DKK", baseCurrency: "EUR",
  }), "USD");
});

Deno.test("Danish country maps to DKK even when language undetected (short message)", () => {
  assertEquals(resolveCustomerCurrency({
    customerCountry: "DK", customerLanguage: "", primaryMarketCurrency: null, baseCurrency: null,
  }), "DKK");
});

Deno.test("country accepts ISO codes and common names, EU countries map to EUR", () => {
  assertEquals(resolveCustomerCurrency({ customerCountry: "DE" }), "EUR");
  assertEquals(resolveCustomerCurrency({ customerCountry: "Germany" }), "EUR");
  assertEquals(resolveCustomerCurrency({ customerCountry: "Usa" }), "USD");
  assertEquals(resolveCustomerCurrency({ customerCountry: "Denmark" }), "DKK");
  assertEquals(resolveCustomerCurrency({ customerCountry: "United Kingdom" }), "GBP");
  assertEquals(resolveCustomerCurrency({ customerCountry: "SE" }), "SEK");
});

Deno.test("unknown country falls through to next signal", () => {
  assertEquals(resolveCustomerCurrency({ customerCountry: "Narnia", customerLanguage: "da" }), "DKK");
  assertEquals(resolveCustomerCurrency({ customerCountry: "", primaryMarketCurrency: "DKK" }), "DKK");
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
