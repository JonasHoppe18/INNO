import { assert, assertEquals } from "jsr:@std/assert@1";
import { shippingCountrySignal } from "./fact-resolver.ts";
import {
  parseReturnAddresses,
  selectReturnAddress,
  selectReturnsPolicyContents,
  type ReturnsChunkLike,
} from "./returns-grounding.ts";

// --- shippingCountrySignal: preserve Shopify shipping country (name or code) ---

Deno.test("shippingCountrySignal: full country name", () => {
  assertEquals(shippingCountrySignal({ country: "United States" }), "United States");
});

Deno.test("shippingCountrySignal: country_code (REST) when no full name", () => {
  assertEquals(shippingCountrySignal({ country_code: "US" }), "US");
});

Deno.test("shippingCountrySignal: countryCode / countryCodeV2 (GraphQL) when no full name", () => {
  assertEquals(shippingCountrySignal({ countryCode: "US" }), "US");
  assertEquals(shippingCountrySignal({ countryCodeV2: "US" }), "US");
});

Deno.test("shippingCountrySignal: prefers full country name over code", () => {
  assertEquals(
    shippingCountrySignal({ country: "United States", countryCode: "XX" }),
    "United States",
  );
});

Deno.test("shippingCountrySignal: empty when no country signal", () => {
  assertEquals(shippingCountrySignal({}), "");
  assertEquals(shippingCountrySignal({ city: "Berlin" }), "");
});

// --- end-to-end at unit level: order country (name OR code) drives selection ---

const DK = "AceZone International ApS\nØster Allé 56, 5th floor\n2100 København Ø\nDenmark";
const US = "AceZone Returns\nPrep Partners\n49 Innovation Drive\nRochester NH 03867\nUSA";
const addrChunks: ReturnsChunkLike[] = [
  { source_provider: "knowledge_document", document_category: "returns", content: `# Returns & Refunds\n\n## Default return address\n\n${DK}` },
  { source_provider: "knowledge_document", document_category: "returns", content: `# Returns & Refunds\n\n## US return address (Amazon US Orders and United States orders)\n\n${US}` },
];
const entries = () => parseReturnAddresses(selectReturnsPolicyContents(addrChunks));

Deno.test("order shipping country_code='US' selects US-specific return address", () => {
  const orderCountry = shippingCountrySignal({ countryCode: "US" });
  const sel = selectReturnAddress({ entries: entries(), orderCountry });
  assertEquals(sel.basis, "country_match");
  assert(sel.address?.includes("Prep Partners"));
});

Deno.test("order shipping country='United States' selects US-specific return address", () => {
  const orderCountry = shippingCountrySignal({ country: "United States" });
  const sel = selectReturnAddress({ entries: entries(), orderCountry });
  assertEquals(sel.basis, "country_match");
  assert(sel.address?.includes("Rochester NH 03867"));
});

Deno.test("order country signal takes precedence over customer-text fallback", () => {
  const orderCountry = shippingCountrySignal({ countryCode: "US" });
  const sel = selectReturnAddress({ entries: entries(), orderCountry, customerCountry: "Denmark" });
  assertEquals(sel.basis, "country_match");
  assert(sel.address?.includes("Prep Partners"));
});

Deno.test("missing order country still falls back to customer_country/contact-form", () => {
  const orderCountry = shippingCountrySignal({});
  const sel = selectReturnAddress({ entries: entries(), orderCountry, customerCountry: "US" });
  assertEquals(sel.basis, "country_match");
  assert(sel.address?.includes("Prep Partners"));
});

Deno.test("non-US country code with no country-specific address → default/general", () => {
  const orderCountry = shippingCountrySignal({ countryCode: "DE" });
  const sel = selectReturnAddress({ entries: entries(), orderCountry });
  assertEquals(sel.basis, "default");
  assert(sel.address?.includes("Øster Allé 56"));
});
