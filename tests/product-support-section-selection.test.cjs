require("sucrase/register/ts-legacy-module-interop");

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  selectProductSupportSections,
  PRODUCT_SUPPORT_LOW_CONFIDENCE_INSTRUCTION,
} = require("../supabase/functions/generate-draft-v2/stages/product-support-section-selector.ts");
const {
  buildKnowledgeDocPreviewContext,
} = require("../supabase/functions/generate-draft-v2/stages/knowledge-doc-preview-context.ts");

// Fixture mirrors the manually inserted A-Spire Wireless document: each chunk's
// content starts with the document title + heading (so the product name is a
// ubiquitous token suppressed by IDF), followed by representative section text.
const HEADINGS = [
  ["sec-0", "Product overview", "The A-Spire Wireless is a wireless gaming headset. Overview of features: ANC, EQ, wireless dongle and bluetooth music."],
  ["sec-1", "Microphone is not working or sounds unclear", "Check the microphone format in Windows: Settings System Sound Input Headset Microphone set format to 48000hz. Update firmware. In Discord turn off Krisp use Studio profile, turn off Voice Clarity. The microphone sounds unclear."],
  ["sec-2", "Microphone works with the cable but not with the dongle", "If the microphone works through the USB-C cable but not through the wireless dongle, open Device Manager, find the AceZone Dongle, update driver, pick Generic USB Audio, restart the computer."],
  ["sec-3", "Pulsating or distorted microphone", "If the microphone sounds pulsating, distorted or unstable, close other audio software. In Discord turn off Krisp use Studio. Turn off Voice Clarity. If it persists follow the factory reset guide."],
  ["sec-4", "Microphone keeps muting and unmuting", "If the microphone keeps muting and unmuting it may be a faulty mute switch. Ask the customer for a video."],
  ["sec-5", "Firmware update for audio cracking or repeated disconnects", "Use the AceZone Firmware Updater from the Microsoft Store to fix audio cracking and repeated disconnects. Update both the headset and the dongle firmware."],
  ["sec-6", "Bluetooth pairing with the AceZone app", "If the headset will not connect to the AceZone app, delete saved devices, hold the ANC button to enter pairing mode and connect again through the app."],
  ["sec-7", "Headset will not power on or keeps disconnecting", "If the headset will not power on or keeps disconnecting, reset the bluetooth connection: turn bluetooth off on every device, remove saved devices, enter pairing mode."],
  ["sec-8", "Dongle pairing", "To reconnect the headset to the wireless dongle: reset the dongle until the LED turns purple, hold the ANC button to enter pairing mode, then connect the dongle again."],
  ["sec-9", "Dongle driver reset for one-earcup audio, weird noises or poor range", "Use this if there is audio in only one earcup, weird noises in one earcup or poor wireless dongle range. Open Device Manager, uninstall the headset drivers, reconnect to the same USB port."],
  ["sec-10", "Factory reset", "To factory reset: turn the headset off, hold the power button for 15 seconds until the voice prompt. Re-pair the dongle. Turn off the Standby Timer."],
  ["sec-11", "When to escalate for further review", "Escalate for further review if the issue persists after the guides. A warranty claim needs an order number or proof of purchase. Return for swap and inspection."],
];

// Real preview chunks embed the document title in every section, so the
// product name is a ubiquitous (IDF≈0) token. Mirror that here.
const TITLE_PREFIX = "# A-Spire Wireless — Product Support";
function withTitle(heading, content) {
  return `${TITLE_PREFIX}\n\n## ${heading}\n\n${content}`;
}

function sectionsFixture(extra = []) {
  const base = HEADINGS.map(([chunk_id, section_heading, content], i) => ({
    chunk_id,
    section_key: section_heading.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
    section_heading,
    content: withTitle(section_heading, content),
    section_order: i,
  }));
  return [...base, ...extra];
}

function firstHeading(message, history) {
  const result = selectProductSupportSections({
    latest_customer_message: message,
    conversation_history: history,
    sections: sectionsFixture(),
  });
  return result;
}

const CASES = [
  ["My A-Spire Wireless will not connect to the AceZone app anymore.", "Bluetooth pairing with the AceZone app"],
  ["My headset is not connecting to the wireless dongle.", "Dongle pairing"],
  ["The microphone sounds bad and people can barely understand me.", "Microphone is not working or sounds unclear"],
  ["My microphone works with USB-C but not through the dongle.", "Microphone works with the cable but not with the dongle"],
  ["The microphone sounds pulsating and unstable.", "Pulsating or distorted microphone"],
  ["I only get sound in one earcup and hear weird noises.", "Dongle driver reset for one-earcup audio, weird noises or poor range"],
  ["My sound is cracking. How do I update the firmware?", "Firmware update for audio cracking or repeated disconnects"],
  ["My headset keeps disconnecting and powers off randomly.", "Headset will not power on or keeps disconnecting"],
];

for (const [message, expectedHeading] of CASES) {
  test(`selects "${expectedHeading}" for: ${message}`, () => {
    const result = firstHeading(message);
    assert.ok(result.selected_sections.length >= 1, "expected at least one section");
    assert.ok(result.selected_sections.length <= 3, "max 3 sections");
    assert.equal(result.selected_sections[0].section_heading, expectedHeading);
    assert.notEqual(result.confidence, "low");
  });
}

test("ambiguous question → low confidence, no sections, clarification instruction wired", () => {
  const result = firstHeading("My A-Spire Wireless does not work properly.");
  assert.equal(result.selected_sections.length, 0);
  assert.equal(result.confidence, "low");
  assert.match(PRODUCT_SUPPORT_LOW_CONFIDENCE_INSTRUCTION, /clarification question/i);
});

test("multi-concept message stays capped at max 3 sections", () => {
  const result = firstHeading(
    "My microphone is unclear, the dongle pairing fails, the firmware cracking persists, and one earcup has weird noises.",
  );
  assert.ok(result.selected_sections.length <= 3);
});

test("custom user-created H2 heading remains selectable", () => {
  const custom = {
    chunk_id: "sec-custom",
    section_key: "glasses_mode_comfort",
    section_heading: "Glasses mode comfort adjustments",
    content: withTitle(
      "Glasses mode comfort adjustments",
      "If wearing glasses is uncomfortable, enable glasses mode in the app to relax the ANC seal.",
    ),
    section_order: 12,
  };
  const result = selectProductSupportSections({
    latest_customer_message: "Wearing glasses with this headset is uncomfortable, how do I fix the glasses fit?",
    sections: sectionsFixture([custom]),
  });
  assert.equal(result.selected_sections[0].section_heading, "Glasses mode comfort adjustments");
});

test("selection never returns a chunk outside the provided (scoped) sections", () => {
  const provided = new Set(sectionsFixture().map((s) => s.chunk_id));
  for (const [message] of CASES) {
    const result = firstHeading(message);
    for (const section of result.selected_sections) {
      assert.ok(provided.has(section.chunk_id), `leaked chunk ${section.chunk_id}`);
    }
  }
});

test("empty section list → low confidence, no throw", () => {
  const result = selectProductSupportSections({
    latest_customer_message: "anything",
    sections: [],
  });
  assert.equal(result.confidence, "low");
  assert.equal(result.selected_sections.length, 0);
});

test("deterministic: same input yields identical selection", () => {
  const a = firstHeading("My headset keeps disconnecting and powers off randomly.");
  const b = firstHeading("My headset keeps disconnecting and powers off randomly.");
  assert.deepEqual(
    a.selected_sections.map((s) => s.chunk_id),
    b.selected_sections.map((s) => s.chunk_id),
  );
});

// ---- Context-builder integration ----

function productSupportContext() {
  return {
    requested: true,
    document_id: "doc-asp",
    chunks: HEADINGS.map(([id, heading, content], i) => ({
      id,
      content: withTitle(heading, content),
      metadata: {
        section_heading: heading,
        section_key: heading.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
        category: "product_support",
        product_scope: "product-9114609942851",
        section_order: i,
      },
    })),
  };
}

test("context builder injects ONLY the selected product-support section", () => {
  const result = buildKnowledgeDocPreviewContext(productSupportContext(), {
    latestCustomerMessage: "My A-Spire Wireless will not connect to the AceZone app anymore.",
  });
  assert.equal(result.diagnostics.injected, true);
  assert.deepEqual(result.diagnostics.section_headings, ["Bluetooth pairing with the AceZone app"]);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].source_label, "Draft document: Bluetooth pairing with the AceZone app");
  // diagnostics carry the additive selection block
  const sel = result.diagnostics.product_support_section_selection;
  assert.equal(sel.product_scope, "product-9114609942851");
  assert.equal(sel.document_id, "doc-asp");
  assert.deepEqual(sel.selected_headings, ["Bluetooth pairing with the AceZone app"]);
  assert.equal(sel.confidence !== "low", true);
  // only the selected section content reaches the writer block
  assert.ok(result.blockText.includes("## Bluetooth pairing with the AceZone app"));
  assert.ok(!result.blockText.includes("## Factory reset"));
});

test("context builder low-confidence injects clarification instruction, no guides", () => {
  const result = buildKnowledgeDocPreviewContext(productSupportContext(), {
    latestCustomerMessage: "My A-Spire Wireless does not work properly.",
  });
  assert.equal(result.diagnostics.injected, true);
  assert.equal(result.diagnostics.reason, "product_support_low_confidence");
  assert.deepEqual(result.diagnostics.section_headings, []);
  assert.equal(result.sources.length, 0);
  assert.ok(result.blockText.includes(PRODUCT_SUPPORT_LOW_CONFIDENCE_INSTRUCTION));
  assert.ok(!result.blockText.includes("## Dongle pairing"));
  assert.equal(result.diagnostics.product_support_section_selection.confidence, "low");
});

test("Returns & Refunds preview is UNCHANGED — all sections injected, no selection", () => {
  const returnsContext = {
    requested: true,
    document_id: "doc-returns",
    chunks: [
      { id: "r1", content: "30 days return window.", metadata: { section_heading: "Return window", category: "returns", section_order: 0 } },
      { id: "r2", content: "Customer pays return shipping.", metadata: { section_heading: "Return shipping", category: "returns", section_order: 1 } },
    ],
  };
  // Even with a customer message present, a non product-support doc injects all.
  const result = buildKnowledgeDocPreviewContext(returnsContext, {
    latestCustomerMessage: "How do I return my microphone dongle?",
  });
  assert.equal(result.diagnostics.injected, true);
  assert.equal(result.diagnostics.reason, "injected");
  assert.deepEqual(result.diagnostics.section_headings, ["Return window", "Return shipping"]);
  assert.equal(result.sources.length, 2);
  assert.equal(result.diagnostics.product_support_section_selection, undefined);
});

test("product-support doc with NO customer message abstains (never injects all guides)", () => {
  const result = buildKnowledgeDocPreviewContext(productSupportContext(), {});
  assert.equal(result.diagnostics.injected, true);
  assert.equal(result.diagnostics.reason, "product_support_low_confidence");
  assert.deepEqual(result.diagnostics.section_headings, []);
  assert.equal(result.sources.length, 0);
  assert.ok(result.blockText.includes(PRODUCT_SUPPORT_LOW_CONFIDENCE_INSTRUCTION));
  // no guide content leaks
  assert.ok(!result.blockText.includes("## Dongle pairing"));
  assert.equal(result.diagnostics.product_support_section_selection.confidence, "low");
  assert.equal(result.diagnostics.product_support_section_selection.reason, "no_customer_message");
});

test("missing document id still returns safe non-injected diagnostics", () => {
  const result = buildKnowledgeDocPreviewContext({ requested: true, document_id: "", chunks: [] });
  assert.equal(result.blockText, null);
  assert.equal(result.diagnostics.injected, false);
});
