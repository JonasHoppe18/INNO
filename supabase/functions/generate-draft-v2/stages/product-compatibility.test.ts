import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  buildCompatibilityDirective,
  buildCompatibilityOutcome,
  buildCompatibilityProvenance,
  detectCompatibilityProduct,
  detectCompatibilityQuery,
  isCompatibilityQuestion,
  resolveCompatibility,
  type CompatibilityRow,
} from "./product-compatibility.ts";

// --- Slice J: product-identity wiring --------------------------------------

const ACEZONE_PRODUCTS = [
  { id: 44, title: "A-Blaze" },
  { id: 46, title: "A-Rise" },
  { id: 47, title: "A-Spire" },
  { id: 48, title: "A-Spire Wireless" },
];

Deno.test("detectCompatibilityProduct: a single named product resolves its id", () => {
  assertEquals(
    detectCompatibilityProduct("Can I use my A-Rise with Xbox over AUX?", ACEZONE_PRODUCTS),
    46,
  );
});

Deno.test("detectCompatibilityProduct: prefix-variant resolves to the MOST specific (A-Spire Wireless, not A-Spire)", () => {
  assertEquals(
    detectCompatibilityProduct(
      "Does the A-Spire Wireless work with PlayStation using the wireless dongle?",
      ACEZONE_PRODUCTS,
    ),
    48,
  );
});

Deno.test("detectCompatibilityProduct: ambiguous (two products) returns null — never guess", () => {
  assertEquals(
    detectCompatibilityProduct("Is the A-Rise or the A-Blaze better for Xbox?", ACEZONE_PRODUCTS),
    null,
  );
});

Deno.test("detectCompatibilityProduct: no product mentioned returns null (brand-wide fallback)", () => {
  assertEquals(
    detectCompatibilityProduct("Does your headset work with PlayStation?", ACEZONE_PRODUCTS),
    null,
  );
});

// Realistic AceZone rows: product-specific CONFIRMED + brand-wide CONFIRMED Xbox
// + the two SUGGESTED OCR conflict rows (ids 5/16 → product 44/48 xbox/aux).
const ACEZONE_ROWS: CompatibilityRow[] = [
  // brand-wide confirmed Xbox
  { product_id: null, target: "xbox", connection: "aux_3_5mm", compatible: "yes", reason: null, workaround: null, confidence: "confirmed" },
  { product_id: null, target: "xbox", connection: "usb_c", compatible: "no", reason: null, workaround: null, confidence: "confirmed" },
  { product_id: null, target: "xbox", connection: "wireless_dongle", compatible: "no", reason: null, workaround: null, confidence: "confirmed" },
  // A-Spire Wireless (48) confirmed PlayStation
  { product_id: 48, target: "playstation", connection: "wireless_dongle", compatible: "yes", reason: null, workaround: null, confidence: "confirmed" },
  { product_id: 48, target: "playstation", connection: "usb_c", compatible: "yes", reason: null, workaround: null, confidence: "confirmed" },
  // A-Rise (46) confirmed Xbox AUX (body_html)
  { product_id: 46, target: "xbox", connection: "aux_3_5mm", compatible: "yes", reason: null, workaround: null, confidence: "confirmed" },
  // SUGGESTED OCR conflicts — must NEVER be served
  { product_id: 44, target: "xbox", connection: "aux_3_5mm", compatible: "partial", reason: null, workaround: null, confidence: "suggested" },
  { product_id: 48, target: "xbox", connection: "aux_3_5mm", compatible: "partial", reason: null, workaround: null, confidence: "suggested" },
];

Deno.test("Slice J: A-Spire Wireless (48) + PlayStation resolves confirmed product-specific yes", () => {
  const r = resolveCompatibility(ACEZONE_ROWS, { target: "playstation", productId: 48 });
  assertEquals(r.known, true);
  const byConn = Object.fromEntries(r.results.map((x) => [x.connection, x.compatible]));
  assertEquals(byConn["wireless_dongle"], "yes");
  assertEquals(byConn["usb_c"], "yes");
});

Deno.test("Slice J: A-Rise (46) + Xbox + AUX resolves confirmed yes", () => {
  const r = resolveCompatibility(ACEZONE_ROWS, { target: "xbox", productId: 46 });
  const byConn = Object.fromEntries(r.results.map((x) => [x.connection, x.compatible]));
  assertEquals(byConn["aux_3_5mm"], "yes");
});

Deno.test("Slice J: unknown product + PlayStation abstains when no brand-wide row exists", () => {
  const r = resolveCompatibility(ACEZONE_ROWS, { target: "playstation", productId: 999 });
  assertEquals(r.known, false); // product 999 has no rows; no brand-wide PlayStation row
});

Deno.test("Slice J: suggested OCR rows (ids 5/16) stay ignored — A-Blaze Xbox falls back to brand-wide", () => {
  const r = resolveCompatibility(ACEZONE_ROWS, { target: "xbox", productId: 44 });
  const aux = r.results.find((x) => x.connection === "aux_3_5mm");
  assertEquals(aux?.compatible, "yes"); // brand-wide yes, NOT the suggested 'partial'
});

Deno.test("Slice J: brand-wide Xbox still works when no productId is passed", () => {
  const r = resolveCompatibility(ACEZONE_ROWS, { target: "xbox" });
  const byConn = Object.fromEntries(r.results.map((x) => [x.connection, x.compatible]));
  assertEquals(byConn["aux_3_5mm"], "yes");
  assertEquals(byConn["usb_c"], "no");
});

// --- Slice K: hard guardrail enforcement on the NOT-CONFIRMED path ----------

Deno.test("Slice K: A-Live (no confirmed row) + PlayStation/AUX → NOT-CONFIRMED, never a positive claim", () => {
  // A-Live is product 45 — it has NO compatibility rows and there is no
  // brand-wide PlayStation row, so the lookup is genuinely unknown.
  const resolved = resolveCompatibility(ACEZONE_ROWS, { target: "playstation", productId: 45 });
  assertEquals(resolved.known, false);

  const outcome = buildCompatibilityOutcome([resolved]);
  // No structured facts, and the safe guardrail is emitted.
  assertEquals(outcome.structuredFacts.length, 0);
  assertEquals(outcome.guardrails[0]?.reason, "no_confirmed_row");
  // The directive must NOT contain the confirmed-facts header / a positive claim.
  assert(!/CONFIRMED FACTS \(authoritative\)/.test(outcome.directive));
});

Deno.test("Slice K: NOT-CONFIRMED directive hard-forbids a positive claim and overrides retrieval/product/stock", () => {
  const d = buildCompatibilityDirective(
    [{ target: "playstation", known: false, results: [] }],
    { wasAsked: true },
  );
  assert(/NOT CONFIRMED/i.test(d));
  assert(/MUST NOT/.test(d), "must hard-forbid the positive claim");
  assert(/compatible|works with|can be used with/i.test(d), "names the forbidden claim");
  assert(/ignore/i.test(d), "must tell the writer to ignore non-authoritative signals");
  assert(
    /retriev|product (page|description)|stock/i.test(d),
    "must call out retrieval/product/stock as non-authoritative",
  );
  assert(/overrides all other context/i.test(d), "must outrank all other context regardless of position");
});

const brandXbox: CompatibilityRow[] = [
  { product_id: null, target: "xbox", connection: "usb_c", compatible: "no", reason: "Xbox does not support USB Audio Class driver", workaround: "Use a 3.5mm AUX cable to the Xbox controller", confidence: "confirmed" },
  { product_id: null, target: "xbox", connection: "wireless_dongle", compatible: "no", reason: "Xbox does not support USB Audio Class driver", workaround: "Use a 3.5mm AUX cable to the Xbox controller", confidence: "confirmed" },
  { product_id: null, target: "xbox", connection: "aux_3_5mm", compatible: "yes", reason: null, workaround: null, confidence: "confirmed" },
];

Deno.test("brand-wide compatibility resolves when product_id is null", () => {
  const r = resolveCompatibility(brandXbox, { target: "xbox", connection: "usb_c" });
  assertEquals(r.known, true);
  assertEquals(r.results.length, 1);
  assertEquals(r.results[0].compatible, "no");
  assert(r.results[0].workaround?.includes("AUX"));
});

Deno.test("Xbox without a stated connection returns all confirmed connection results (dongle no + AUX yes)", () => {
  const r = resolveCompatibility(brandXbox, { target: "xbox" });
  assertEquals(r.known, true);
  const byConn = Object.fromEntries(r.results.map((x) => [x.connection, x.compatible]));
  assertEquals(byConn["wireless_dongle"], "no");
  assertEquals(byConn["aux_3_5mm"], "yes");
  assertEquals(byConn["usb_c"], "no");
});

Deno.test("product-specific compatibility overrides brand-wide for the same target+connection", () => {
  const rows: CompatibilityRow[] = [
    ...brandXbox,
    { product_id: 42, target: "xbox", connection: "usb_c", compatible: "yes", reason: "This model ships an Xbox-licensed dongle", workaround: null, confidence: "confirmed" },
  ];
  const r = resolveCompatibility(rows, { target: "xbox", connection: "usb_c", productId: 42 });
  assertEquals(r.results.length, 1);
  assertEquals(r.results[0].compatible, "yes");
  // A different product still gets the brand-wide "no".
  const other = resolveCompatibility(rows, { target: "xbox", connection: "usb_c", productId: 7 });
  assertEquals(other.results[0].compatible, "no");
});

Deno.test("unknown compatibility returns not-confirmed (known=false, empty results)", () => {
  const r = resolveCompatibility(brandXbox, { target: "playstation", connection: "usb_c" });
  assertEquals(r.known, false);
  assertEquals(r.results.length, 0);
});

Deno.test("suggested rows are never served as confirmed", () => {
  const rows: CompatibilityRow[] = [
    { product_id: null, target: "switch", connection: "usb_c", compatible: "yes", reason: null, workaround: null, confidence: "suggested" },
  ];
  const r = resolveCompatibility(rows, { target: "switch", connection: "usb_c" });
  assertEquals(r.known, false);
  assertEquals(r.results.length, 0);
});

Deno.test("detectCompatibilityQuery extracts targets and connections from natural text", () => {
  const q = detectCompatibilityQuery("Is the A-Spire compatible with my Xbox wirelessly?");
  assert(q.targets.includes("xbox"));
  assert(q.connections.includes("wireless_dongle"));

  const q2 = detectCompatibilityQuery("Does it work on PS5 over bluetooth?");
  assert(q2.targets.includes("playstation"));
  assert(q2.connections.includes("bluetooth"));

  const q3 = detectCompatibilityQuery("Can I use the 3.5mm jack with a Nintendo Switch?");
  assert(q3.targets.includes("switch"));
  assert(q3.connections.includes("aux_3_5mm"));
});

Deno.test("isCompatibilityQuestion is true only for platform-compatibility intents", () => {
  assert(isCompatibilityQuestion("Is this headset compatible with Xbox?"));
  assert(isCompatibilityQuestion("does it work with ps5 over usb-c"));
  assertEquals(isCompatibilityQuestion("Where is my order?"), false);
  assertEquals(isCompatibilityQuestion("Can I get a refund?"), false);
});

Deno.test("buildCompatibilityDirective renders confirmed facts and a no-guess rule", () => {
  const resolved = [resolveCompatibility(brandXbox, { target: "xbox" })];
  const block = buildCompatibilityDirective(resolved, { wasAsked: true });
  assert(/xbox/i.test(block));
  assert(block.toLowerCase().includes("aux"));
  // Always carries the anti-guessing instruction.
  assert(/do not guess|not confirmed/i.test(block));
});

Deno.test("buildCompatibilityDirective on an unknown question emits a no-guess directive, no invented facts", () => {
  const resolved = [resolveCompatibility(brandXbox, { target: "playstation", connection: "bluetooth" })];
  const block = buildCompatibilityDirective(resolved, { wasAsked: true });
  assert(/not confirmed/i.test(block));
  assert(/MUST NOT/.test(block)); // hard prohibition (Slice K)
  // Must not assert a positive compatibility verdict (no confirmed-facts block).
  assert(!/CONFIRMED FACTS \(authoritative\)/.test(block));
});

Deno.test("buildCompatibilityDirective returns empty string when not a compatibility question", () => {
  assertEquals(buildCompatibilityDirective([], { wasAsked: false }), "");
});

// --- Stage 5, Slice 1: compatibility provenance ---------------------------

Deno.test("buildCompatibilityProvenance exposes confirmed compatibility facts from shop_product_compatibility", () => {
  const resolved = [resolveCompatibility(brandXbox, { target: "xbox" })];
  const prov = buildCompatibilityProvenance(resolved);

  assert(prov.length > 0);
  for (const f of prov) {
    assertEquals(f.type, "compatibility");
    assertEquals(f.confidence, "confirmed");
    assertEquals(f.origin_table, "shop_product_compatibility");
  }
  const aux = prov.find((f) => /aux/i.test(f.key));
  assert(aux, "expected an AUX compatibility fact");
  assert(/compatible/i.test(aux!.value));
});

Deno.test("buildCompatibilityProvenance never includes a suggested compatibility row", () => {
  const rows: CompatibilityRow[] = [
    { product_id: null, target: "switch", connection: "usb_c", compatible: "yes", reason: null, workaround: null, confidence: "confirmed" },
    { product_id: null, target: "switch", connection: "bluetooth", compatible: "yes", reason: null, workaround: null, confidence: "suggested" },
  ];
  const resolved = [resolveCompatibility(rows, { target: "switch" })];
  const prov = buildCompatibilityProvenance(resolved);
  assertEquals(prov.length, 1);
  assert(/usb-?c/i.test(prov[0].key));
  assert(!prov.some((f) => /bluetooth/i.test(f.key)));
});

Deno.test("buildCompatibilityProvenance returns [] for unknown / empty input", () => {
  assertEquals(buildCompatibilityProvenance([]), []);
  assertEquals(
    buildCompatibilityProvenance([resolveCompatibility(brandXbox, { target: "playstation" })]),
    [],
  );
});

// --- Stage 5, Slice 2B: unknown-compatibility abstention outcome ----------

Deno.test("buildCompatibilityOutcome (known): confirmed directive + structured facts, no guardrail", () => {
  const resolved = [resolveCompatibility(brandXbox, { target: "xbox" })];
  const out = buildCompatibilityOutcome(resolved);
  assert(/CONFIRMED FACTS/i.test(out.directive));
  assert(out.structuredFacts.length > 0);
  for (const f of out.structuredFacts) assertEquals(f.confidence, "confirmed");
  assertEquals(out.guardrails.length, 0);
});

Deno.test("buildCompatibilityOutcome (unknown): NOT-CONFIRMED directive + guardrail, no structured facts", () => {
  // playstation has no rows in brandXbox → unknown.
  const resolved = [resolveCompatibility(brandXbox, { target: "playstation", connection: "bluetooth" })];
  const out = buildCompatibilityOutcome(resolved);
  assert(/NOT CONFIRMED/i.test(out.directive), "must inject the NOT-CONFIRMED directive");
  assert(/MUST NOT/.test(out.directive)); // hard prohibition (Slice K)
  assertEquals(out.structuredFacts.length, 0, "no confirmed structured fact when unknown");
  assertEquals(out.guardrails.length, 1);
  assertEquals(out.guardrails[0].topic, "compatibility");
  assertEquals(out.guardrails[0].reason, "no_confirmed_row");
  assert(out.guardrails[0].message.length > 0);
  // The directive must NOT assert a positive verdict (no confirmed-facts block).
  assert(!/CONFIRMED FACTS \(authoritative\)/.test(out.directive));
});
