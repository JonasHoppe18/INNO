import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  buildCompatibilityDirective,
  buildCompatibilityOutcome,
  buildCompatibilityProvenance,
  detectCompatibilityProduct,
  detectCompatibilityQuery,
  detectCompatibilityToneViolations,
  isCompatibilityQuestion,
  resolveCompatibility,
  sanitizeCompatibilityDraft,
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

// --- Slice L: exact requested-method handling + send-ready wording ----------

const SLICE_L_ROWS: CompatibilityRow[] = [
  // A-Spire (47) PlayStation: USB-C + AUX confirmed, NO wireless dongle.
  { product_id: 47, target: "playstation", connection: "usb_c", compatible: "yes", reason: null, workaround: null, confidence: "confirmed" },
  { product_id: 47, target: "playstation", connection: "aux_3_5mm", compatible: "yes", reason: null, workaround: null, confidence: "confirmed" },
  // A-Spire Wireless (48) PlayStation: dongle + USB-C confirmed.
  { product_id: 48, target: "playstation", connection: "wireless_dongle", compatible: "yes", reason: null, workaround: null, confidence: "confirmed" },
  { product_id: 48, target: "playstation", connection: "usb_c", compatible: "yes", reason: null, workaround: null, confidence: "confirmed" },
  // brand-wide Xbox.
  { product_id: null, target: "xbox", connection: "aux_3_5mm", compatible: "yes", reason: null, workaround: null, confidence: "confirmed" },
  { product_id: null, target: "xbox", connection: "usb_c", compatible: "no", reason: null, workaround: null, confidence: "confirmed" },
  // SUGGESTED A-Spire dongle row — must stay ignored (dongle must NOT become confirmed for 47).
  { product_id: 47, target: "playstation", connection: "wireless_dongle", compatible: "partial", reason: null, workaround: null, confidence: "suggested" },
];

// Part A — exact requested-method handling

Deno.test("Slice L/A: A-Spire + PlayStation + wireless dongle → dongle NOT claimed, USB-C/AUX offered as alternatives", () => {
  const resolved = [resolveCompatibility(SLICE_L_ROWS, { target: "playstation", productId: 47 })];
  const d = buildCompatibilityDirective(resolved, { wasAsked: true, requestedConnections: ["wireless_dongle"] });
  assert(/USB-C/i.test(d), "confirmed USB-C alternative present");
  assert(/AUX/i.test(d), "confirmed AUX alternative present");
  assert(/Requested method \(wireless dongle\): NOT confirmed/i.test(d));
  // Never a positive dongle verdict (suggested row stayed out of the facts).
  assert(!/wireless dongle: compatible/i.test(d));
});

Deno.test("Slice L/A: A-Spire Wireless + PlayStation + wireless dongle → requested method CONFIRMED", () => {
  const resolved = [resolveCompatibility(SLICE_L_ROWS, { target: "playstation", productId: 48 })];
  const d = buildCompatibilityDirective(resolved, { wasAsked: true, requestedConnections: ["wireless_dongle"] });
  assert(/Requested method \(wireless dongle\): CONFIRMED/i.test(d));
});

Deno.test("Slice L/A: A-Spire + PlayStation + USB-C → requested method CONFIRMED", () => {
  const resolved = [resolveCompatibility(SLICE_L_ROWS, { target: "playstation", productId: 47 })];
  const d = buildCompatibilityDirective(resolved, { wasAsked: true, requestedConnections: ["usb_c"] });
  assert(/Requested method \(USB-C\): CONFIRMED/i.test(d));
});

Deno.test("Slice L/A: A-Spire + PlayStation + AUX → requested method CONFIRMED", () => {
  const resolved = [resolveCompatibility(SLICE_L_ROWS, { target: "playstation", productId: 47 })];
  const d = buildCompatibilityDirective(resolved, { wasAsked: true, requestedConnections: ["aux_3_5mm"] });
  assert(/Requested method \(3\.5mm AUX\): CONFIRMED/i.test(d));
});

Deno.test("Slice L/A: A-Spire + PlayStation with no method → summarize confirmed USB-C/AUX, no requested-method section", () => {
  const resolved = [resolveCompatibility(SLICE_L_ROWS, { target: "playstation", productId: 47 })];
  const d = buildCompatibilityDirective(resolved, { wasAsked: true });
  assert(/USB-C/i.test(d) && /AUX/i.test(d));
  assert(!/Requested method/i.test(d));
});

Deno.test("Slice L/A: suggested A-Spire dongle row stays ignored (dongle never resolves for product 47)", () => {
  const r = resolveCompatibility(SLICE_L_ROWS, { target: "playstation", productId: 47 });
  assert(!r.results.some((x) => x.connection === "wireless_dongle"));
});

Deno.test("Slice L/A: brand-wide Xbox still resolves where applicable", () => {
  const r = resolveCompatibility(SLICE_L_ROWS, { target: "xbox" });
  const byConn = Object.fromEntries(r.results.map((x) => [x.connection, x.compatible]));
  assertEquals(byConn["aux_3_5mm"], "yes");
  assertEquals(byConn["usb_c"], "no");
});

// Part B — send-ready wording (no internal data language, no filler)

const BANNED_CUSTOMER_WORDING: RegExp[] = [
  /not confirmed in our data/i,
  /structured compatibility data/i,
  /in our system/i,
  /I cannot confirm/i,
];

Deno.test("Slice L/B: NOT-CONFIRMED directive keeps hard safety but drops internal data wording", () => {
  const d = buildCompatibilityDirective(
    [{ target: "playstation", known: false, results: [] }],
    { wasAsked: true, requestedConnections: ["aux_3_5mm"] },
  );
  // Hard safety preserved.
  assert(/MUST NOT/.test(d));
  assert(/works with|can be used with|compatible/i.test(d));
  assert(/IGNORE/.test(d));
  assert(/retrieved knowledge|product (descriptions|pages)|stock/i.test(d));
  assert(/overrides all other context/i.test(d));
  // No internal/system data wording leaks to the customer.
  for (const re of BANNED_CUSTOMER_WORDING) assert(!re.test(d), `directive must not contain ${re}`);
  // Discourage "try it directly", discourage filler, instruct natural voice.
  assert(/test the setup themselves/i.test(d));
  assert(/filler/i.test(d));
  assert(/like a support colleague/i.test(d));
});

Deno.test("Slice L/B: CONFIRMED directive is send-ready and free of internal data wording", () => {
  const resolved = [resolveCompatibility(SLICE_L_ROWS, { target: "playstation", productId: 47 })];
  const d = buildCompatibilityDirective(resolved, { wasAsked: true, requestedConnections: ["wireless_dongle"] });
  assert(/like a support colleague/i.test(d));
  assert(/filler/i.test(d));
  for (const re of BANNED_CUSTOMER_WORDING) assert(!re.test(d), `directive must not contain ${re}`);
});

Deno.test("Slice L/B: buildCompatibilityOutcome forwards requestedConnections into the directive", () => {
  const resolved = [resolveCompatibility(SLICE_L_ROWS, { target: "playstation", productId: 47 })];
  const out = buildCompatibilityOutcome(resolved, ["wireless_dongle"]);
  assert(/Requested method \(wireless dongle\): NOT confirmed/i.test(out.directive));
});

// --- Slice M: broad compatibility routing + exact product scoping -----------

const SLICE_M_PRODUCTS = [
  { id: 44, title: "A-Blaze" },
  { id: 45, title: "A-Live" },
  { id: 46, title: "A-Rise" },
  { id: 47, title: "A-Spire" },
  { id: 48, title: "A-Spire Wireless" },
];

// A broad "product + platform" question (no connection, no compat keyword) is a
// compatibility question once we know a product was named.
Deno.test("Slice M: broad product+platform question is a compatibility question when a product is named", () => {
  // Pure text alone is NOT enough (keeps unrelated platform mentions out).
  assertEquals(isCompatibilityQuestion("Can I use A-Spire with PlayStation?"), false);
  // With a named product, it IS a compatibility question.
  assertEquals(
    isCompatibilityQuestion("Can I use A-Spire with PlayStation?", { productMentioned: true }),
    true,
  );
});

Deno.test("Slice M: a platform mention without a product/keyword is still NOT a compatibility question", () => {
  assertEquals(isCompatibilityQuestion("Where is my PlayStation order?", { productMentioned: false }), false);
  // productMentioned cannot force-true without a platform target present.
  assertEquals(isCompatibilityQuestion("I really like my A-Spire", { productMentioned: true }), false);
});

Deno.test("Slice M: explicit keyword / connection still trigger regardless of productMentioned", () => {
  assertEquals(isCompatibilityQuestion("Is A-Spire compatible with PlayStation?"), true);
  assertEquals(isCompatibilityQuestion("Can I use it with PlayStation via the wireless dongle?"), true);
});

Deno.test("Slice M: A-Spire (broad) resolves product 47 — not A-Spire Wireless (48)", () => {
  assertEquals(detectCompatibilityProduct("Can I use A-Spire with PlayStation?", SLICE_M_PRODUCTS), 47);
});

Deno.test("Slice M: A-Spire Wireless (broad) resolves product 48", () => {
  assertEquals(detectCompatibilityProduct("Can I use A-Spire Wireless with PlayStation?", SLICE_M_PRODUCTS), 48);
});

Deno.test("Slice M: broad A-Spire + PlayStation surfaces confirmed USB-C/AUX, never the wireless dongle", () => {
  const resolved = [resolveCompatibility(SLICE_L_ROWS, { target: "playstation", productId: 47 })];
  const out = buildCompatibilityOutcome(resolved, []); // broad: no requested connection
  assert(out.structuredFacts.length > 0);
  assert(/USB-C/i.test(out.directive));
  assert(/AUX/i.test(out.directive));
  assert(!/wireless dongle: compatible/i.test(out.directive));
  assert(!/Requested method/i.test(out.directive));
});

Deno.test("Slice M: broad A-Spire Wireless + PlayStation includes the confirmed wireless dongle", () => {
  const resolved = [resolveCompatibility(SLICE_L_ROWS, { target: "playstation", productId: 48 })];
  const out = buildCompatibilityOutcome(resolved, []);
  assert(/wireless dongle: compatible/i.test(out.directive));
});

Deno.test("Slice M: A-Live never borrows A-Rise/A-Spire facts — stays no_confirmed_row", () => {
  const resolved = [resolveCompatibility(SLICE_L_ROWS, { target: "playstation", productId: 45 })];
  assertEquals(resolved[0].known, false);
  const out = buildCompatibilityOutcome(resolved, ["aux_3_5mm"]);
  assertEquals(out.structuredFacts.length, 0);
  assertEquals(out.guardrails[0]?.reason, "no_confirmed_row");
});

Deno.test("Slice M: ambiguous product mention still does not guess", () => {
  assertEquals(
    detectCompatibilityProduct("Is the A-Spire or A-Rise better for PlayStation?", SLICE_M_PRODUCTS),
    null,
  );
});

// --- Slice N: send-ready tone enforcement -----------------------------------

Deno.test("Slice N: detector flags each banned compatibility phrase", () => {
  assert(detectCompatibilityToneViolations("I cannot confirm compatibility.").includes("cannot_confirm"));
  assert(detectCompatibilityToneViolations("This is not confirmed in our data.").includes("internal_data_wording"));
  assert(detectCompatibilityToneViolations("Please check the exact product specifications.").includes("check_specs"));
  assert(detectCompatibilityToneViolations("You could try it directly to see.").includes("try_it_directly"));
  assert(detectCompatibilityToneViolations("If you have any other questions, feel free to ask.").includes("generic_filler"));
});

Deno.test("Slice N: detector passes a clean send-ready draft", () => {
  const good =
    "Hi there,\n\nA-Live isn't confirmed for PlayStation over AUX, so I wouldn't recommend relying on that setup.\n\nFor PlayStation, I'd recommend choosing a model with confirmed PlayStation compatibility instead.";
  assertEquals(detectCompatibilityToneViolations(good), []);
});

Deno.test("Slice N: sanitizer strips generic filler and the in-our-data qualifier, keeps real content", () => {
  const bad =
    "A-Spire works via USB-C or 3.5mm AUX. The wireless dongle is not confirmed in our data. If you have any other questions, feel free to ask.";
  const out = sanitizeCompatibilityDraft(bad);
  assert(!/in our data/i.test(out));
  assert(!/if you have any other questions/i.test(out));
  assert(!/feel free to ask/i.test(out));
  assert(/A-Spire works via USB-C or 3\.5mm AUX\./.test(out));
  assert(/not confirmed\b/i.test(out)); // keeps the fact, drops the qualifier
});

Deno.test("Slice N: sanitizer rewrites 'I cannot confirm' to a non-robotic equivalent", () => {
  const out = sanitizeCompatibilityDraft(
    "Unfortunately, I cannot confirm compatibility for the A-Live with PlayStation via AUX.",
  );
  assert(!/I cannot confirm/i.test(out));
  assert(/haven['’]?t confirmed/i.test(out));
});

Deno.test("Slice N: sanitizer is idempotent and leaves a clean draft unchanged", () => {
  const good = "A-Spire works with PlayStation over USB-C or 3.5mm AUX.";
  assertEquals(sanitizeCompatibilityDraft(good), good);
  const bad = "Yes. If you have any further questions, feel free to ask.";
  const once = sanitizeCompatibilityDraft(bad);
  assertEquals(sanitizeCompatibilityDraft(once), once);
  assert(!/feel free to ask/i.test(once));
});

Deno.test("Slice N: directive steers to a recommendation and bans inability/check-specs framing without the banned literals", () => {
  const d = buildCompatibilityDirective(
    [{ target: "playstation", known: false, results: [] }],
    { wasAsked: true, requestedConnections: ["aux_3_5mm"] },
  );
  assert(/recommend/i.test(d));
  assert(/inability/i.test(d));
  assert(/check specs|manuals|test the setup/i.test(d));
  for (const re of BANNED_CUSTOMER_WORDING) assert(!re.test(d), `directive must not contain ${re}`);
});
