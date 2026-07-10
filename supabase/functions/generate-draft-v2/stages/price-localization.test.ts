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

Deno.test("header does not claim resolved currency when no line actually used it", () => {
  const block = buildPriceLocalizationBlock({
    text: "Hvad koster A-Blaze?",
    currency: "SEK",
    products: [{ title: "A-Blaze", presentment_prices: { EUR: "199.00" }, price: "199.00", base_currency: "EUR" }],
  });
  const headerLine = block.split("\n")[0];
  // header must not claim SEK — no line actually quotes SEK
  assert(!headerLine.includes("SEK"));
  assert(headerLine.includes("produktets valuta"));
  // the fallback line itself is still correctly labeled EUR
  assert(block.includes("- A-Blaze: 199.00 EUR"));
});

Deno.test("header keeps resolved currency label when at least one line used it", () => {
  const block = buildPriceLocalizationBlock({
    text: "Hvad koster A-Blaze og B-Glow?",
    currency: "DKK",
    products: [
      { title: "A-Blaze", presentment_prices: { EUR: "199.00", DKK: "1499.00" }, price: "199.00", base_currency: "EUR" },
      { title: "B-Glow", presentment_prices: { EUR: "99.00" }, price: "99.00", base_currency: "EUR" },
    ],
  });
  const headerLine = block.split("\n")[0];
  assert(headerLine.includes("DKK"));
  // fallback product still correctly labeled with its own base currency
  assert(block.includes("- B-Glow: 99.00 EUR"));
});

Deno.test("empty when not a price question", () => {
  assertEquals(buildPriceLocalizationBlock({ text: "Hej", currency: "DKK", products: [] }), "");
});
