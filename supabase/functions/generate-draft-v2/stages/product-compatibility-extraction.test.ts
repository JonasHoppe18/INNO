// Tests for the PURE website/product compatibility extractor (Slice F).
//
// Run: deno test --allow-read product-compatibility-extraction.test.ts
// (--allow-read is needed only by the "purity / not wired into runtime" test,
//  which reads sibling source files; all other tests are pure.)
//
// Fixtures are the EXACT AceZone strings recovered by the read-only presence
// probe (body_html `Compatibility:` lines + the OCR comparison-chart text).
// Everything the extractor emits MUST be confidence='suggested' and is never
// served by the runtime (which serves confirmed-only).

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  extractCompatibilityCandidates,
  type CompatibilityCandidate,
} from "./product-compatibility-extraction.ts";

// --- AceZone fixtures (from the probe) -------------------------------------
const ASPIRE_WIRELESS_BODY =
  "Compatibility: PC/Mac, PS4/5 (USB/Analog/Dongle), Switch (Analog/BT), Mobile";
const ASPIRE_WIRELESS_URL = "https://www.acezone.io/products/a-spire-wireless";
const ASPIRE_WIRELESS_ID = 48;

function byTargetConn(candidates: CompatibilityCandidate[], target: string, connection: string | null) {
  return candidates.find((c) => c.target === target && c.connection === connection);
}

Deno.test("1. A-Spire Wireless body_html yields suggested, product-specific candidates", () => {
  const out = extractCompatibilityCandidates({
    productId: ASPIRE_WIRELESS_ID,
    productTitle: "A-Spire Wireless",
    productUrl: ASPIRE_WIRELESS_URL,
    bodyHtml: ASPIRE_WIRELESS_BODY,
    sourceType: "body_html",
  });

  assert(out.length > 0, "expected candidates");
  // Rule 8: product-specific, never brand-wide, for single-product evidence.
  for (const c of out) {
    assertEquals(c.product_id, ASPIRE_WIRELESS_ID);
    assertEquals(c.confidence, "suggested");
    assertEquals(c.source, "website_compatibility_extraction");
    assertEquals(c.source_url, ASPIRE_WIRELESS_URL);
    assert(c.evidence_text.toLowerCase().includes("compatibility"));
  }
  // PlayStation via all three stated connections.
  assert(byTargetConn(out, "playstation", "usb_c"));
  assert(byTargetConn(out, "playstation", "aux_3_5mm"));
  assert(byTargetConn(out, "playstation", "wireless_dongle"));
  // Switch via the two stated connections.
  assert(byTargetConn(out, "switch", "aux_3_5mm"));
  assert(byTargetConn(out, "switch", "bluetooth"));
  // PC and Mac are listed without a connection -> emitted but flagged.
  const pc = byTargetConn(out, "pc", null);
  const mac = byTargetConn(out, "mac", null);
  assert(pc && pc.needs_review, "pc should be needs_review (no connection stated)");
  assert(mac && mac.needs_review, "mac should be needs_review (no connection stated)");
});

Deno.test("2. 'Analog' normalizes to aux_3_5mm", () => {
  const out = extractCompatibilityCandidates({
    productId: 1,
    bodyHtml: "Compatibility: Switch (Analog/BT)",
    sourceType: "body_html",
  });
  assert(byTargetConn(out, "switch", "aux_3_5mm"), "Analog -> aux_3_5mm");
  assert(byTargetConn(out, "switch", "bluetooth"), "BT -> bluetooth");
});

Deno.test("3. Dongle disambiguation: dongle -> wireless_dongle, distinct from wired usb_c", () => {
  const out = extractCompatibilityCandidates({
    productId: 1,
    bodyHtml: "Compatibility: PS4/5 (USB/Analog/Dongle)",
    sourceType: "body_html",
  });
  const dongle = byTargetConn(out, "playstation", "wireless_dongle");
  const usbc = byTargetConn(out, "playstation", "usb_c");
  const aux = byTargetConn(out, "playstation", "aux_3_5mm");
  assert(dongle, "Dongle -> wireless_dongle");
  assert(usbc, "USB -> wired usb_c (stated separately)");
  assert(aux, "Analog -> aux_3_5mm");
  // They are three distinct candidates, not one conflated row.
  assert(dongle !== usbc);
});

Deno.test("3b. 'wireless USB-C dongle' (single phrase) maps ONLY to wireless_dongle, never usb_c", () => {
  const out = extractCompatibilityCandidates({
    productId: 1,
    bodyHtml: "Compatibility: PS5 (wireless USB-C dongle)",
    sourceType: "body_html",
  });
  assert(byTargetConn(out, "playstation", "wireless_dongle"), "phrase -> wireless_dongle");
  assertEquals(
    byTargetConn(out, "playstation", "usb_c"),
    undefined,
    "the single 'wireless USB-C dongle' phrase must NOT also produce wired usb_c",
  );
});

Deno.test("4. 'Mobile' is flagged needs_review (never silently confirmed)", () => {
  const out = extractCompatibilityCandidates({
    productId: 1,
    bodyHtml: "Compatibility: Mobile",
    sourceType: "body_html",
  });
  assert(out.length > 0, "Mobile should still yield candidates");
  for (const c of out) {
    assert(c.needs_review, "every Mobile-derived candidate must be needs_review");
    assert(
      (c.review_note ?? "").toLowerCase().includes("mobile"),
      "review_note should explain the Mobile ambiguity",
    );
  }
  // Represented as ios/android suggestions, never as a confirmed 'mobile' truth.
  const targets = new Set(out.map((c) => c.target));
  assert(targets.has("ios") && targets.has("android"));
});

Deno.test("5. Xbox cross-source conflict (absent in body_html, present in OCR chart) is flagged, not clean-confirmed", () => {
  const out = extractCompatibilityCandidates({
    productId: ASPIRE_WIRELESS_ID,
    productUrl: ASPIRE_WIRELESS_URL,
    bodyHtml: ASPIRE_WIRELESS_BODY, // no Xbox here
    ocrText:
      "COMPATIBILITY PC & MacOS (Wireless & USB-C) PS5 (Wireless & USB-C) PS4 (AUX) Nintendo Switch (AUX & BT) XBOX (AUX)",
    sourceType: "body_html",
  });
  const xbox = out.filter((c) => c.target === "xbox");
  assert(xbox.length > 0, "an xbox candidate should be surfaced from the OCR conflict");
  // The connection stated next to XBOX in the chart ("(AUX)") is captured.
  assert(
    xbox.some((c) => c.connection === "aux_3_5mm"),
    "the OCR-stated connection (AUX) should be captured for the xbox conflict",
  );
  for (const c of xbox) {
    assert(c.needs_review, "xbox conflict candidate must be needs_review");
    assert(
      (c.review_note ?? "").toLowerCase().includes("conflict"),
      "review_note should mark the cross-source conflict",
    );
  }
  // Must NOT emit a low-risk, ready-to-confirm xbox row.
  assertEquals(
    xbox.some((c) => c.needs_review === false),
    false,
    "no clean (needs_review=false) xbox candidate may be produced from a conflict",
  );
});

Deno.test("6. 'only Switch 2' is preserved in condition + needs_review", () => {
  const out = extractCompatibilityCandidates({
    productId: 1,
    bodyHtml: "Compatibility: PC/Mac, Switch 2 only (Dongle)",
    sourceType: "body_html",
  });
  const sw = out.filter((c) => c.target === "switch");
  assert(sw.length > 0, "switch candidate expected");
  for (const c of sw) {
    assert(c.needs_review, "Switch 2 only -> needs_review");
    assert(
      (c.condition ?? "").toLowerCase().includes("switch 2"),
      "condition must preserve 'Switch 2'",
    );
  }
});

Deno.test("7. every candidate is confidence='suggested'", () => {
  const out = extractCompatibilityCandidates({
    productId: ASPIRE_WIRELESS_ID,
    productUrl: ASPIRE_WIRELESS_URL,
    bodyHtml: ASPIRE_WIRELESS_BODY,
    sourceType: "body_html",
  });
  assert(out.length > 0);
  for (const c of out) assertEquals(c.confidence, "suggested");
});

Deno.test("8. extractor is pure and NOT imported by the runtime pipeline", async () => {
  const moduleSrc = await Deno.readTextFile(
    new URL("./product-compatibility-extraction.ts", import.meta.url),
  );
  // No DB / network / env access in the pure module. (The conventional
  // `// supabase/functions/...` path header is allowed — we check for actual
  // client/network/env *usage*, not the word "supabase".)
  for (
    const forbidden of [
      "createClient",
      "@supabase/supabase-js",
      "SUPABASE_",
      "fetch(",
      "Deno.env",
      "openai",
    ]
  ) {
    assert(
      !moduleSrc.includes(forbidden),
      `pure module must not reference '${forbidden}'`,
    );
  }
  // Not wired into the runtime pipeline.
  const pipelineSrc = await Deno.readTextFile(new URL("../pipeline.ts", import.meta.url));
  assert(
    !pipelineSrc.includes("product-compatibility-extraction"),
    "pipeline.ts must NOT import the suggestion extractor (runtime stays confirmed-only)",
  );
});

// --- OCR scoping (Slice H): OCR is secondary, never a first source ----------

Deno.test("OCR scoping: a product with NO body_html Compatibility line gets ZERO candidates even with shop-level OCR", () => {
  const out = extractCompatibilityCandidates({
    productId: 49,
    productTitle: "Ear pads",
    productUrl: "https://www.acezone.io/products/spare-parts",
    bodyHtml: "Ear pads spare part. Replaceable memory-foam cushions for AceZone headsets.",
    ocrText:
      "COMPATIBILITY PC & MacOS (Wireless & USB-C) PS5 (Wireless & USB-C) PS4 (AUX) Nintendo Switch (AUX & BT) XBOX (AUX)",
    sourceType: "body_html",
  });
  assertEquals(out.length, 0, "no primary Compatibility line => OCR must not invent candidates");
});

Deno.test("OCR scoping: A-Live / IEM-like products do not inherit PlayStation/Xbox/Switch from OCR alone", () => {
  for (const bodyHtml of ["A-Live audio mixer. USB powered.", "IEM + Sound Card bundle. In-ear monitors."]) {
    const out = extractCompatibilityCandidates({
      productId: 45,
      bodyHtml,
      ocrText: "XBOX (AUX) PS5 (Wireless & USB-C) Nintendo Switch (AUX & BT)",
    });
    assertEquals(out.length, 0);
    assertEquals(
      out.filter((c) => ["xbox", "playstation", "switch"].includes(c.target ?? "")).length,
      0,
    );
  }
});

Deno.test("OCR scoping: a product WITH a primary line still gets OCR conflict candidates (behavior preserved)", () => {
  const out = extractCompatibilityCandidates({
    productId: 48,
    bodyHtml: "Compatibility: PC/Mac, PS4/5 (USB/Analog/Dongle), Switch (Analog/BT), Mobile", // no Xbox
    ocrText: "XBOX (AUX)",
  });
  const xbox = out.filter((c) => c.target === "xbox");
  assert(xbox.length > 0 && xbox.every((c) => c.needs_review), "primary present => OCR conflict still flagged");
});

// --- Extra rule coverage ----------------------------------------------------

Deno.test("rule 6: 'not compatible' attaches only to its own platform scope", () => {
  const out = extractCompatibilityCandidates({
    productId: 1,
    bodyHtml: "Compatibility: PC/Mac (USB-C), Xbox (not compatible)",
    sourceType: "body_html",
  });
  const xbox = out.filter((c) => c.target === "xbox");
  assert(xbox.length > 0 && xbox.every((c) => c.compatible === "no"), "xbox -> no");
  // PC/Mac stay compatible (scope is not leaked).
  const pc = byTargetConn(out, "pc", "usb_c");
  assert(pc && pc.compatible === "yes", "pc remains compatible");
});

Deno.test("rule 4: PS4 and PS5 with DIFFERENT connections -> playstation needs_review", () => {
  const out = extractCompatibilityCandidates({
    productId: 1,
    bodyHtml: "Compatibility: PS5 (USB-C), PS4 (Analog)",
    sourceType: "body_html",
  });
  const ps = out.filter((c) => c.target === "playstation");
  assert(ps.length > 0);
  assert(
    ps.some((c) => c.needs_review),
    "differing PS4/PS5 connections must raise needs_review",
  );
});
