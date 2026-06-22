import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  buildCompatibilityDirective,
  buildCompatibilityProvenance,
  detectCompatibilityQuery,
  isCompatibilityQuestion,
  resolveCompatibility,
  type CompatibilityRow,
} from "./product-compatibility.ts";

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
  assert(/do not guess|not confirmed/i.test(block));
  // Must not assert a compatibility verdict it doesn't have.
  assert(!/\b(yes|compatible)\b/i.test(block.replace(/not confirmed/gi, "")));
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
