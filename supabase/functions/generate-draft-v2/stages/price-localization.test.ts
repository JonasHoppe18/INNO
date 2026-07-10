// @ts-nocheck
import { assert, assertEquals } from "jsr:@std/assert@1";
import { isPriceQuestion, buildPriceLocalizationBlock } from "./price-localization.ts";

Deno.test("isPriceQuestion detects Danish + English price cues", () => {
  assert(isPriceQuestion("Hvad koster A-Blaze?"));
  assert(isPriceQuestion("what is the price of the headset"));
  assert(!isPriceQuestion("Hvornår er den på lager?"));
});

Deno.test("block quotes the resolved currency from presentment map", () => {
  const block = buildPriceLocalizationBlock({
    text: "Hvad koster A-Blaze?",
    currency: "DKK",
    products: [{ title: "A-Blaze", presentment_prices: { EUR: "199.00", DKK: "1499.00" }, price: "199.00", base_currency: "EUR" }],
  });
  assert(block.includes("DKK"));
  assert(block.includes("1499.00"));
  assert(!block.includes("199.00 EUR")); // must not quote the base when DKK exists
});

Deno.test("block falls back to base price + label when currency missing", () => {
  const block = buildPriceLocalizationBlock({
    text: "price of A-Blaze",
    currency: "SEK",
    products: [{ title: "A-Blaze", presentment_prices: { EUR: "199.00" }, price: "199.00", base_currency: "EUR" }],
  });
  assert(block.includes("EUR"));
  assert(block.includes("199.00"));
});

Deno.test("empty when not a price question", () => {
  assertEquals(buildPriceLocalizationBlock({ text: "Hej", currency: "DKK", products: [] }), "");
});
