import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  buildReturnsGroundingDirective,
  detectFabricatedReturnAddress,
  extractReturnAddresses,
  groundedReturnAddresses,
  isReturnRefundIntent,
  resolveReturnCountryPreference,
  type ReturnsChunkLike,
  selectReturnsPolicyContents,
  stripAddressLinesFromExample,
} from "./returns-grounding.ts";

const DK = "AceZone International ApS\nØster Allé 56, 5th floor\n2100 København Ø\nDenmark";
const US = "AceZone Returns\nPrep Partners\n49 Innovation Drive\nRochester NH 03867\nUSA";

const returnsChunks: ReturnsChunkLike[] = [
  { source_provider: "knowledge_document", metadata: { category: "returns", usable_as: "policy" }, content: `# Returns & Refunds\n\n## Default return address\n\n${DK}` },
  { source_provider: "knowledge_document", metadata: { category: "returns", usable_as: "policy" }, content: `# Returns & Refunds\n\n## US return address\n\n${US}` },
  { source_provider: "knowledge_document", metadata: { category: "returns", usable_as: "policy" }, content: "# Returns & Refunds\n\n## Return shipping\n\nFor ordinary returns, the customer arranges and pays for return shipping." },
  { source_provider: "manual_text", metadata: { category: "returns" }, content: "some manual note" },
];

Deno.test("isReturnRefundIntent detects intent + keywords", () => {
  assert(isReturnRefundIntent("refund", ""));
  assert(isReturnRefundIntent("return", ""));
  assert(isReturnRefundIntent("other", "I want a refund please"));
  assert(isReturnRefundIntent("product_question", "jeg vil gerne returnere"));
  assertEquals(isReturnRefundIntent("product_question", "where can I buy A-Rise"), false);
});

Deno.test("isReturnRefundIntent: 'complaint' intent alone does NOT trigger (mic troubleshooting)", () => {
  // The classifier labels product-troubleshooting as "complaint"; without any
  // return/refund wording this must NOT ground the canonical returns doc.
  assertEquals(
    isReturnRefundIntent("complaint", "My A-Spire Wireless microphone is not working."),
    false,
  );
});

Deno.test("isReturnRefundIntent: 'exchange' intent alone does NOT trigger (ear-pads purchase)", () => {
  // The classifier labels purchase/replacement questions as "exchange"; without
  // return/refund wording this must NOT ground the canonical returns doc.
  assertEquals(
    isReturnRefundIntent("exchange", "Can I buy replacement ear pads for A-Spire?"),
    false,
  );
});

Deno.test("isReturnRefundIntent: complaint/exchange WITH return wording still triggers", () => {
  // Genuine return context inside a complaint/exchange ticket is still caught by
  // the keyword regex, so grounding is preserved where it matters.
  assert(isReturnRefundIntent("complaint", "It's broken, I want to return it for a refund."));
  assert(isReturnRefundIntent("exchange", "jeg vil gerne returnere og have pengene tilbage"));
});

Deno.test("selectReturnsPolicyContents picks only the returns knowledge_document", () => {
  const got = selectReturnsPolicyContents(returnsChunks);
  assertEquals(got.length, 3);
  assert(got.some((c) => /Default return address/.test(c)));
});

Deno.test("extractReturnAddresses parses default + US blocks", () => {
  const a = extractReturnAddresses(selectReturnsPolicyContents(returnsChunks));
  assert(a.default?.includes("Øster Allé 56"));
  assert(a.default?.includes("Denmark"));
  assert(a.us?.includes("Prep Partners"));
  assert(a.us?.includes("Rochester NH 03867"));
});

Deno.test("resolveReturnCountryPreference: US only when clearly US, else default", () => {
  assertEquals(resolveReturnCountryPreference({ orderCountry: "US" }), "us");
  assertEquals(resolveReturnCountryPreference({ customerCountry: "United States" }), "us");
  assertEquals(resolveReturnCountryPreference({ orderCountry: "DE" }), "default");
  assertEquals(resolveReturnCountryPreference({ orderCountry: "Germany" }), "default");
  assertEquals(resolveReturnCountryPreference({}), "default");
});

Deno.test("directive: Germany/EU uses Denmark address, not US", () => {
  const a = extractReturnAddresses(selectReturnsPolicyContents(returnsChunks));
  const d = buildReturnsGroundingDirective({ isReturnRefundIntent: true, addresses: a, countryPreference: "default", orderNumber: "#4542" });
  assert(d.includes("Øster Allé 56"));
  assert(!d.includes("Prep Partners"));
  assert(/Do NOT use the US address/i.test(d));
  assert(/customer arranges and pays for return shipping|CUSTOMER arranges and pays/i.test(d));
  assert(/Do NOT promise a prepaid return label/i.test(d));
  assert(/assessed based on the returned item/i.test(d));
  assert(d.includes("#4542"));
});

Deno.test("directive: US customer uses US address", () => {
  const a = extractReturnAddresses(selectReturnsPolicyContents(returnsChunks));
  const d = buildReturnsGroundingDirective({ isReturnRefundIntent: true, addresses: a, countryPreference: "us" });
  assert(d.includes("Prep Partners"));
  assert(d.includes("Rochester NH 03867"));
});

Deno.test("directive: no grounded address → forbid inventing, no placeholder", () => {
  const d = buildReturnsGroundingDirective({ isReturnRefundIntent: true, addresses: { default: null, us: null }, countryPreference: "default" });
  assert(/Do NOT state any return address/i.test(d));
  assert(/never invent one or use a placeholder/i.test(d));
});

Deno.test("verifier guard: blocks the fake placeholder address", () => {
  const draft = "Hi,\nPlease return to:\nAceZone Returns\n1234 Return St.\nCity, Postal Code";
  assert(detectFabricatedReturnAddress(draft, { isReturnRefundIntent: true, groundedAddresses: [DK, US] }));
});

Deno.test("verifier guard: does NOT block the real Denmark address", () => {
  const draft = `Hi Sebastian,\nYou can return the headset to:\n${DK}\nPlease include your order number.`;
  assertEquals(detectFabricatedReturnAddress(draft, { isReturnRefundIntent: true, groundedAddresses: [DK, US] }), false);
});

Deno.test("verifier guard: does NOT block the real US address", () => {
  const draft = `Hi,\nReturn to:\n${US}`;
  assertEquals(detectFabricatedReturnAddress(draft, { isReturnRefundIntent: true, groundedAddresses: [DK, US] }), false);
});

Deno.test("verifier guard: blocks an ungrounded street address", () => {
  const draft = "Hi,\nReturn to:\nSome Warehouse\n99 Madeup Avenue\n9999 Faketown\nNowhere";
  assert(detectFabricatedReturnAddress(draft, { isReturnRefundIntent: true, groundedAddresses: [DK, US] }));
});

Deno.test("verifier guard: inert when not a return/refund ticket", () => {
  assertEquals(detectFabricatedReturnAddress("99 Madeup Avenue", { isReturnRefundIntent: false, groundedAddresses: [DK, US] }), false);
});

Deno.test("stripAddressLinesFromExample removes address lines, keeps tone", () => {
  const example = `Hi,\nThanks for reaching out.\nPlease return to:\nAceZone International ApS\nØster Allé 56, 5th floor\n2100 København Ø\nDenmark\nKind regards`;
  const out = stripAddressLinesFromExample(example);
  assert(out.includes("Thanks for reaching out."));
  assert(out.includes("Kind regards"));
  assert(!/Øster Allé 56/.test(out));
  assert(!/2100 København/.test(out));
  assert(!/^Denmark$/m.test(out));
});

Deno.test("selectReturnsPolicyContents works with RetrievedChunk document_category", () => {
  // RetrievedChunk exposes document_category (not metadata.category).
  const chunks: ReturnsChunkLike[] = [
    { source_provider: "knowledge_document", document_category: "returns", content: `# Returns & Refunds\n\n## Default return address\n\n${DK}` },
    { source_provider: "knowledge_document", document_category: "product_support", content: "# A-Spire — Product Support" },
  ];
  const contents = selectReturnsPolicyContents(chunks);
  assertEquals(contents.length, 1);
  assert(extractReturnAddresses(contents).default?.includes("Øster Allé 56"));
});

Deno.test("groundedReturnAddresses returns both blocks", () => {
  const g = groundedReturnAddresses(selectReturnsPolicyContents(returnsChunks));
  assertEquals(g.length, 2);
});
