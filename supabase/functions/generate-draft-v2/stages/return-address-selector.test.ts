import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  buildReturnsGroundingDirective,
  extractCustomerCountryFromText,
  hasGroundedReturnAddressChunk,
  parseReturnAddresses,
  type ReturnsChunkLike,
  selectReturnAddress,
  selectReturnsPolicyContents,
} from "./returns-grounding.ts";

const DK = "AceZone International ApS\nØster Allé 56, 5th floor\n2100 København Ø\nDenmark";
const US = "AceZone Returns\nPrep Partners\n49 Innovation Drive\nRochester NH 03867\nUSA";

const addrChunks: ReturnsChunkLike[] = [
  { source_provider: "knowledge_document", document_category: "returns", content: `# Returns & Refunds\n\n## Default return address\n\n${DK}` },
  { source_provider: "knowledge_document", document_category: "returns", content: `# Returns & Refunds\n\n## US return address (Amazon US Orders and United States orders)\n\n${US}` },
  { source_provider: "knowledge_document", document_category: "returns", content: "# Returns & Refunds\n\n## Return shipping\n\nFor ordinary returns, the customer arranges and pays for return shipping." },
];

// --- parseReturnAddresses: generic classification (no hardcoded country rules) ---

Deno.test("parseReturnAddresses classifies default + country-specific generically", () => {
  const entries = parseReturnAddresses(selectReturnsPolicyContents(addrChunks));
  assertEquals(entries.length, 2); // ignores non-address "Return shipping" section
  const def = entries.find((e) => e.kind === "default");
  const country = entries.find((e) => e.kind === "country");
  assert(def, "expected a default entry");
  assert(def!.address.includes("Øster Allé 56"));
  assertEquals(def!.countries.length, 0);
  assert(country, "expected a country-specific entry");
  assert(country!.address.includes("Prep Partners"));
  // country tokens extracted from heading + parenthetical, normalized
  assert(country!.countries.includes("us"));
  assert(country!.countries.includes("united states"));
});

Deno.test("parseReturnAddresses returns [] when no address sections present", () => {
  const noAddr: ReturnsChunkLike[] = [
    { source_provider: "knowledge_document", document_category: "returns", content: "# Returns & Refunds\n\n## Return window\n\n30 days." },
    { source_provider: "knowledge_document", document_category: "returns", content: "# Returns & Refunds\n\n## Refund processing\n\nProcessed after receipt." },
  ];
  assertEquals(parseReturnAddresses(selectReturnsPolicyContents(noAddr)).length, 0);
});

// --- selectReturnAddress: country-aware selection + stop conditions ---

Deno.test("selectReturnAddress: US customer → US address", () => {
  const entries = parseReturnAddresses(selectReturnsPolicyContents(addrChunks));
  const sel = selectReturnAddress({ entries, customerCountry: "US" });
  assertEquals(sel.basis, "country_match");
  assert(sel.address?.includes("Prep Partners"));
});

Deno.test("selectReturnAddress: 'United States' customer → US address", () => {
  const entries = parseReturnAddresses(selectReturnsPolicyContents(addrChunks));
  const sel = selectReturnAddress({ entries, customerCountry: "United States" });
  assertEquals(sel.basis, "country_match");
  assert(sel.address?.includes("Rochester NH 03867"));
});

Deno.test("selectReturnAddress: non-US customer (DK/SE/DE/PT) with no specific address → default", () => {
  const entries = parseReturnAddresses(selectReturnsPolicyContents(addrChunks));
  for (const c of ["DK", "Denmark", "SE", "Germany", "Portugal"]) {
    const sel = selectReturnAddress({ entries, customerCountry: c });
    assertEquals(sel.basis, "default", `expected default for ${c}`);
    assert(sel.address?.includes("Øster Allé 56"), `expected DK address for ${c}`);
  }
});

Deno.test("selectReturnAddress: orderCountry takes precedence over customerCountry", () => {
  const entries = parseReturnAddresses(selectReturnsPolicyContents(addrChunks));
  const sel = selectReturnAddress({ entries, orderCountry: "US", customerCountry: "DK" });
  assertEquals(sel.basis, "country_match");
  assert(sel.address?.includes("Prep Partners"));
});

Deno.test("selectReturnAddress: unknown country → default ONLY when a clear default exists", () => {
  const entries = parseReturnAddresses(selectReturnsPolicyContents(addrChunks));
  const sel = selectReturnAddress({ entries });
  assertEquals(sel.basis, "default");
  assert(sel.address?.includes("Øster Allé 56"));
});

Deno.test("selectReturnAddress: unknown country + no default (only country-specific) → ask/route, no guess", () => {
  const entries = parseReturnAddresses([
    `# Returns & Refunds\n\n## US return address\n\n${US}`,
  ]);
  const sel = selectReturnAddress({ entries });
  assertEquals(sel.basis, "ask_or_route");
  assertEquals(sel.address, null);
});

Deno.test("selectReturnAddress: known country, no match, no default → ask/route, no guess", () => {
  const entries = parseReturnAddresses([
    `# Returns & Refunds\n\n## US return address\n\n${US}`,
  ]);
  const sel = selectReturnAddress({ entries, customerCountry: "Germany" });
  assertEquals(sel.basis, "ask_or_route");
  assertEquals(sel.address, null);
});

Deno.test("selectReturnAddress: multiple defaults → ambiguous → ask/route, no guess", () => {
  const entries = parseReturnAddresses([
    `# Returns & Refunds\n\n## Default return address\n\n${DK}`,
    `# Returns & Refunds\n\n## General return address\n\nOther Co\n1 Main St\nCity`,
  ]);
  const sel = selectReturnAddress({ entries, customerCountry: "DK" });
  assertEquals(sel.basis, "ask_or_route");
  assertEquals(sel.address, null);
});

Deno.test("selectReturnAddress: no entries at all → ask/route", () => {
  const sel = selectReturnAddress({ entries: [], customerCountry: "US" });
  assertEquals(sel.basis, "ask_or_route");
  assertEquals(sel.address, null);
});

// --- extractCustomerCountryFromText: deterministic fallback country signal ---

Deno.test("extractCustomerCountryFromText: reads contact-form country field (g-034)", () => {
  const body =
    "You received a new message from your online store's contact form.\nCountry Code: US\nName: [redacted]\nYour Country: United States\nWhat Do You Need Help With?: refund";
  const c = extractCustomerCountryFromText(body);
  // selecting with this value must resolve to the US address
  const entries = parseReturnAddresses(selectReturnsPolicyContents(addrChunks));
  assertEquals(selectReturnAddress({ entries, customerCountry: c }).basis, "country_match");
});

Deno.test("extractCustomerCountryFromText: falls back to Country Code when no full name", () => {
  const c = extractCustomerCountryFromText("Country Code: US\nName: x");
  assert(c && /us/i.test(c));
});

Deno.test("extractCustomerCountryFromText: returns null when no country field", () => {
  assertEquals(extractCustomerCountryFromText("Hi, my headset is broken. Please help."), null);
});

// --- buildReturnsGroundingDirective: generic rendering from a selection ---

Deno.test("directive: US selection grounds the US address, never the default", () => {
  const entries = parseReturnAddresses(selectReturnsPolicyContents(addrChunks));
  const sel = selectReturnAddress({ entries, customerCountry: "US" });
  const d = buildReturnsGroundingDirective({ isReturnRefundIntent: true, selection: sel, orderNumber: "#4542" });
  assert(d.includes("Prep Partners"));
  assert(d.includes("Rochester NH 03867"));
  assert(!d.includes("Øster Allé 56"));
  assert(d.includes("#4542"));
  // no hardcoded country-routing wording
  assert(!/default \(Denmark\)/i.test(d));
});

Deno.test("directive: default selection grounds the default address", () => {
  const entries = parseReturnAddresses(selectReturnsPolicyContents(addrChunks));
  const sel = selectReturnAddress({ entries, customerCountry: "DE" });
  const d = buildReturnsGroundingDirective({ isReturnRefundIntent: true, selection: sel });
  assert(d.includes("Øster Allé 56"));
  assert(!d.includes("Prep Partners"));
  assert(/customer arranges and pays for return shipping|CUSTOMER arranges and pays/i.test(d));
  assert(/Do NOT promise a prepaid return label/i.test(d));
});

Deno.test("directive: ask_or_route selection forbids stating any address", () => {
  const sel = selectReturnAddress({ entries: [], customerCountry: "US" });
  const d = buildReturnsGroundingDirective({ isReturnRefundIntent: true, selection: sel });
  assert(/Do NOT state any return address/i.test(d));
  assert(/never invent.*placeholder/i.test(d));
});

Deno.test("directive: inert when not a return/refund ticket", () => {
  const sel = selectReturnAddress({ entries: [], customerCountry: "US" });
  assertEquals(buildReturnsGroundingDirective({ isReturnRefundIntent: false, selection: sel }), "");
});

// --- hasGroundedReturnAddressChunk: pipeline gate helper ---

Deno.test("hasGroundedReturnAddressChunk: true when an address section is retrieved", () => {
  assert(hasGroundedReturnAddressChunk(addrChunks));
});

Deno.test("hasGroundedReturnAddressChunk: false when only non-address returns sections retrieved (g-034 case)", () => {
  const noAddr: ReturnsChunkLike[] = [
    { source_provider: "knowledge_document", document_category: "returns", content: "# Returns & Refunds\n\n## Return window\n\n30 days." },
    { source_provider: "knowledge_document", document_category: "returns", content: "# Returns & Refunds\n\n## Refund processing\n\nAfter receipt." },
    { source_provider: "knowledge_document", document_category: "returns", content: "# Returns & Refunds\n\n## Opened or tested products\n\nAssessed on condition." },
  ];
  assertEquals(hasGroundedReturnAddressChunk(noAddr), false);
});
