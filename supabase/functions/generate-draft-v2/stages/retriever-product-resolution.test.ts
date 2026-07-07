import { assertEquals } from "jsr:@std/assert@1";
import {
  extractMentionedProductTerms,
  resolveMostSpecificProductTerms,
} from "./retriever.ts";

const SHOP = {
  product_overview:
    "- A-Blaze\n- A-Live\n- A-Rise\n- A-Spire\n- A-Spire Wireless\n- Ear pads\n- IEM + Sound Card",
};

// ---- B1: resolveMostSpecificProductTerms (pure helper) ----

Deno.test("drops shorter term that is substring of a longer matched term", () => {
  // "a-spire" is a substring of "a-spire wireless" → only the specific one survives
  const out = resolveMostSpecificProductTerms(["a-spire", "a-spire wireless"]);
  assertEquals(out, ["a-spire wireless"]);
});

Deno.test("keeps a single term unchanged", () => {
  assertEquals(resolveMostSpecificProductTerms(["a-spire"]), ["a-spire"]);
});

Deno.test("keeps two genuinely different products", () => {
  const out = resolveMostSpecificProductTerms(["a-blaze", "a-spire wireless"]);
  assertEquals(out.sort(), ["a-blaze", "a-spire wireless"].sort());
});

Deno.test("keeps both different products even when one is also substring-overlapping", () => {
  // a-spire ⊂ a-spire wireless (drop a-spire), but a-blaze is independent (keep)
  const out = resolveMostSpecificProductTerms([
    "a-spire",
    "a-spire wireless",
    "a-blaze",
  ]);
  assertEquals(out.sort(), ["a-blaze", "a-spire wireless"].sort());
});

Deno.test("does not drop a term that merely shares a token but is not a substring", () => {
  // "a-live" is not a substring of "a-spire wireless"
  const out = resolveMostSpecificProductTerms(["a-live", "a-spire wireless"]);
  assertEquals(out.sort(), ["a-live", "a-spire wireless"].sort());
});

Deno.test("is idempotent / dedupes exact duplicates", () => {
  assertEquals(resolveMostSpecificProductTerms(["a-spire", "a-spire"]), [
    "a-spire",
  ]);
});

// ---- B1 integration: extractMentionedProductTerms applies resolution ----

Deno.test("A-Spire Wireless message resolves only to the specific term", () => {
  const out = extractMentionedProductTerms(
    "My A-Spire Wireless dongle won't connect",
    SHOP,
  );
  assertEquals(out, ["a-spire wireless"]);
});

Deno.test("A-Spire (wired) message still resolves correctly", () => {
  const out = extractMentionedProductTerms(
    "My A-Spire headset cable is broken",
    SHOP,
  );
  assertEquals(out, ["a-spire"]);
});

Deno.test("two different product names in one message both resolve", () => {
  const out = extractMentionedProductTerms(
    "I have both an A-Blaze and an A-Spire Wireless",
    SHOP,
  );
  assertEquals(out.sort(), ["a-blaze", "a-spire wireless"].sort());
});

Deno.test("matching is case-insensitive", () => {
  const out = extractMentionedProductTerms("MY a-SPIRE wireless", SHOP);
  assertEquals(out, ["a-spire wireless"]);
});

// ---- Connector normalization: +, &, and ----

Deno.test("'IEM and Sound Card' matches 'IEM + Sound Card' from product_overview", () => {
  const out = extractMentionedProductTerms(
    "When will the IEM and Sound Card be released?",
    SHOP,
  );
  assertEquals(out, ["iem + sound card"]);
});

Deno.test("'IEM & Sound Card' matches 'IEM + Sound Card' from product_overview", () => {
  const out = extractMentionedProductTerms(
    "Is the IEM & Sound Card available?",
    SHOP,
  );
  assertEquals(out, ["iem + sound card"]);
});

Deno.test("'IEM + Sound Card' still matches literally", () => {
  const out = extractMentionedProductTerms(
    "Tell me about the IEM + Sound Card",
    SHOP,
  );
  assertEquals(out, ["iem + sound card"]);
});

Deno.test("generic headset message does not match any product", () => {
  const out = extractMentionedProductTerms(
    "Can I use the AceZone app with my headset?",
    SHOP,
  );
  assertEquals(out, []);
});

// Production regression: real product_overview lines are "Name: long description"
// (~120+ chars). The index treated the WHOLE line as the term and the ≥3/≤80
// length filter then dropped every product — extraction returned [] for the
// entire shop, silently disabling the product-support document gate and all
// cross-product logic (observed live on e-004/g-020).
const PROD_SHOP = {
  product_overview: [
    "- A-Blaze: The A-Blaze brings tournament-level precision to wireless gaming. Featuring Hybrid ANC and sound-isolating earcups, it b",
    "- A-Spire: The A-Spire is a premium gaming headset, equipped with cutting-edge Advanced Hybrid Active Noise Cancellation (ANC) tail",
    "- A-Spire Wireless: The A-Spire Wireless is the pinnacle of wireless gaming headsets, introducing Advanced Hybrid ANC specifically designed",
    "- Ear pads: Spare Ear Pads for AceZone Headsets ⚠️ Note: When ordering, please write in the comment field at checkout which headset",
    "- IEM + Sound Card: At AceZone, years of experience in professional esports audio engineering have led us here.",
  ].join("\n"),
};

Deno.test("extracts product name from 'Name: description' overview lines", () => {
  assertEquals(
    extractMentionedProductTerms("my A-Spire headset cracked near the headband", PROD_SHOP),
    ["a-spire"],
  );
});

Deno.test("most-specific resolution still applies with description-format overview", () => {
  assertEquals(
    extractMentionedProductTerms("problem med mit A-Spire Wireless headset", PROD_SHOP),
    ["a-spire wireless"],
  );
});

Deno.test("hyphen-less mention matches hyphenated product name", () => {
  // g-020: "mit a spire acezone headset" — no hyphen in the customer text.
  assertEquals(
    extractMentionedProductTerms("Jeg har smidt min dongle væk til mit a spire acezone headset", PROD_SHOP),
    ["a-spire"],
  );
});

Deno.test("connector variants still resolve with description-format overview", () => {
  assertEquals(
    extractMentionedProductTerms("spørgsmål om IEM and Sound Card", PROD_SHOP),
    ["iem + sound card"],
  );
});
