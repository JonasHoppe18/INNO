// @ts-nocheck
import { assert, assertEquals } from "jsr:@std/assert@1";
import { extractSuggestedSpecs } from "./product-text-spec-extraction.ts";

const AT = "2026-06-20T00:00:00.000Z";
const URL = "https://www.acezone.io/products/a-spire-wireless";

// Representative AceZone body_html (HTML preserved to exercise stripping).
const WIRELESS_BODY = `
  <p>The A-Spire Wireless is the pinnacle of wireless gaming headsets.</p>
  <li>Fully customizable via AceZone app <span>8-Band EQ, sidetone control, ANC &amp; transparency control, 5-Band EQ for mic, ANC glasses mode +more</span></li>
  <h3>Specifications:</h3>
  <li>Connectivity: 2.4 GHz wireless USB-C dongle, USB-C to USB-A cable, 3.5mm Jack, Bluetooth 5.4 (LE Audio)</li>
  <li>DAC: 384 kHz / 24-bit</li>
  <li>Style: Over-ear, closed-back design</li>
`;

function extract(body, opts = {}) {
  return extractSuggestedSpecs({
    productId: 2,
    title: "A-Spire Wireless",
    productUrl: URL,
    bodyHtml: body,
    now: AT,
    ...opts,
  });
}

function byKey(rows, key) {
  return rows.find((r) => r.spec_key === key);
}

Deno.test("extracts connection_types from a Connectivity line (canonical tokens)", () => {
  const r = byKey(extract(WIRELESS_BODY), "connection_types");
  assert(r, "connection_types not extracted");
  for (const t of ["USB-C", "wireless dongle", "3.5mm AUX", "Bluetooth"]) {
    assert(r.spec_value.includes(t), `missing ${t} in "${r.spec_value}"`);
  }
  assert(r.evidence_text.toLowerCase().includes("connectivity"));
});

Deno.test("extracts dac_quality raw value from a DAC line", () => {
  const r = byKey(extract(WIRELESS_BODY), "dac_quality");
  assert(r);
  assert(r.spec_value.includes("384 kHz"));
  assert(r.evidence_text.includes("DAC"));
});

Deno.test("extracts eq_app_bands from '8-Band EQ' as a number, not the mic 5-band", () => {
  const r = byKey(extract(WIRELESS_BODY), "eq_app_bands");
  assert(r);
  assertEquals(r.value_num, 8);
  assertEquals(r.unit, "bands");
});

Deno.test("extracts anc_app_control and transparency_mode from explicit app text", () => {
  const rows = extract(WIRELESS_BODY);
  assertEquals(byKey(rows, "anc_app_control").value_bool, true);
  assertEquals(byKey(rows, "transparency_mode").value_bool, true);
});

Deno.test("extracts glasses_mode only when explicitly mentioned", () => {
  assertEquals(byKey(extract(WIRELESS_BODY), "glasses_mode").value_bool, true);
});

Deno.test("does NOT infer glasses_mode=false when missing (no spec emitted)", () => {
  const noGlasses = `<li>Connectivity: USB-C, 3.5mm Jack, Bluetooth 5.0</li><li>DAC: 192 kHz / 24-bit</li>`;
  assertEquals(byKey(extract(noGlasses), "glasses_mode"), undefined);
});

Deno.test("every suggested spec carries evidence_text, source_url, suggested confidence and extraction source", () => {
  for (const r of extract(WIRELESS_BODY)) {
    assert(r.evidence_text && r.evidence_text.length > 0);
    assertEquals(r.source_url, URL);
    assertEquals(r.confidence, "suggested");
    assertEquals(r.source, "product_page_extraction");
    assertEquals(r.extracted_at, AT);
  }
});

Deno.test("relative/comparative DAC claims are flagged needs_review and never produce a ranking fact", () => {
  // A comparative phrase (the manual_text 3927 style) must not become an
  // absolute dac_quality ranking; only the raw "DAC: X" line is a fact.
  const relative = `<li>This model offers a better DAC than the A-Spire.</li>`;
  const rows = extract(relative);
  const dac = byKey(rows, "dac_quality");
  // No raw "DAC: X" line -> no dac_quality fact extracted.
  assertEquals(dac, undefined);
});

Deno.test("dac_quality from a real DAC line is suggested and flagged for human review", () => {
  const r = byKey(extract(WIRELESS_BODY), "dac_quality");
  assertEquals(r.confidence, "suggested");
  assertEquals(r.needs_review, true);
});

Deno.test("blank / unknown text creates no specs", () => {
  assertEquals(extract("").length, 0);
  assertEquals(extract("<p>Just some marketing fluff with no specs.</p>").length, 0);
});
