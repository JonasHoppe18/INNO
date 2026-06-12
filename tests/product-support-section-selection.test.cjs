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

// ---------------------------------------------------------------------------
// Hybrid (semantic) selection — multilingual.
//
// Embeddings are MOCKED (no live API). Each section gets a basis vector with a
// shared baseline component (mimicking the real compressed space). A query
// embedding aimed at section k has its clear argmax + margin at k. This tests
// the dispatcher routing (lexical-first vs semantic-rescue), the cosine
// ranking, the margin gate and abstention — NOT real cross-lingual semantics
// (those were calibrated against live embeddings during the slice eval).
// ---------------------------------------------------------------------------

const SEM_DIM = HEADINGS.length; // one basis dimension per section
function basisVector(k) {
  // shared baseline 0.3 everywhere + a strong 1.0 spike at k
  const v = new Array(SEM_DIM).fill(0.3);
  v[k] = 1.3;
  return v;
}
function semanticSections() {
  return HEADINGS.map(([chunk_id, section_heading, content], i) => ({
    chunk_id,
    section_key: section_heading.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
    section_heading,
    content: withTitle(section_heading, content),
    section_order: i,
    embedding: basisVector(i),
  }));
}
const H = {
  micUnclear: 1,
  micCableDongle: 2,
  pulsating: 3,
  firmware: 5,
  appPairing: 6,
  powerDisconnect: 7,
  donglePairing: 8,
  dongleDriver: 9,
};

// Danish messages have NO English heading token → forces the semantic path.
const DANISH = [
  ["Min mikrofon virker ikke, og mine venner kan næsten ikke høre mig.", H.micUnclear, "Microphone is not working or sounds unclear"],
  ["Mikrofonen virker med kabel, men ikke når jeg bruger donglen.", H.micCableDongle, "Microphone works with the cable but not with the dongle"],
  ["Lyden kratter, og headsettet mister forbindelsen.", H.firmware, "Firmware update for audio cracking or repeated disconnects"],
  ["Jeg kan ikke forbinde headsettet til appen.", H.appPairing, "Bluetooth pairing with the AceZone app"],
  ["Jeg kan kun høre lyd i den ene side.", H.dongleDriver, "Dongle driver reset for one-earcup audio, weird noises or poor range"],
];

for (const [msg, targetIdx, expected] of DANISH) {
  test(`hybrid: Danish "${msg.slice(0, 28)}…" → ${expected}`, () => {
    const result = selectProductSupportSections({
      latest_customer_message: msg,
      query_embedding: basisVector(targetIdx),
      sections: semanticSections(),
    });
    assert.equal(result.selected_sections.length, 1, "Danish issue selects exactly one section");
    assert.equal(result.selected_sections[0].section_heading, expected);
    assert.notEqual(result.confidence, "low");
    assert.equal(result.reason, "semantic_single_section");
    // diagnostics carry both score arrays
    assert.equal(result.semantic_scores.length, SEM_DIM);
    assert.equal(result.lexical_scores.length, SEM_DIM);
  });
}

test("hybrid: English lexical anchor WINS over a misleading embedding (precision)", () => {
  // Query embedding deliberately points at the WRONG section (micUnclear), but
  // the English lexical anchor ("dongle") must still select Dongle pairing.
  const result = selectProductSupportSections({
    latest_customer_message: "not connecting to the wireless dongle",
    query_embedding: basisVector(H.micUnclear),
    sections: semanticSections(),
  });
  assert.equal(result.selected_sections[0].section_heading, "Dongle pairing");
  assert.equal(result.reason, "lexical_single_section");
});

test("hybrid: English app pairing selects exactly 1 section", () => {
  const result = selectProductSupportSections({
    latest_customer_message: "I cannot connect to the AceZone app",
    query_embedding: basisVector(H.powerDisconnect),
    sections: semanticSections(),
  });
  assert.equal(result.selected_sections.length, 1);
  assert.equal(result.selected_sections[0].section_heading, "Bluetooth pairing with the AceZone app");
});

test("hybrid: ambiguous Danish with low semantic margin abstains (no guide)", () => {
  // Query equidistant between two sections → tiny margin → abstain.
  const a = basisVector(H.micUnclear);
  const b = basisVector(H.donglePairing);
  const mixed = a.map((v, i) => (v + b[i]) / 2);
  const result = selectProductSupportSections({
    latest_customer_message: "Min A-Spire Wireless virker ikke ordentligt.",
    query_embedding: mixed,
    sections: semanticSections(),
  });
  assert.equal(result.selected_sections.length, 0);
  assert.equal(result.confidence, "low");
  assert.equal(result.reason, "semantic_low_margin");
});

test("hybrid: no query embedding → pure lexical path (unchanged behavior)", () => {
  const result = selectProductSupportSections({
    latest_customer_message: "Mikrofonen virker med kabel, men ikke når jeg bruger donglen.",
    sections: semanticSections(), // embeddings present but no query embedding
  });
  // Danish has no lexical anchor and no query embedding → abstain.
  assert.equal(result.selected_sections.length, 0);
  assert.equal(result.confidence, "low");
  assert.equal(result.semantic_scores, undefined);
});

test("hybrid: semantic path never returns a chunk outside the scoped sections", () => {
  const provided = new Set(semanticSections().map((s) => s.chunk_id));
  for (const [msg, targetIdx] of DANISH) {
    const result = selectProductSupportSections({
      latest_customer_message: msg,
      query_embedding: basisVector(targetIdx),
      sections: semanticSections(),
    });
    for (const s of result.selected_sections) assert.ok(provided.has(s.chunk_id));
  }
});

test("hybrid: max 3 cap holds even if many sections are semantically close", () => {
  const flat = new Array(SEM_DIM).fill(0.5); // equidistant to everything
  const result = selectProductSupportSections({
    latest_customer_message: "noget med headsettet",
    query_embedding: flat,
    sections: semanticSections(),
  });
  assert.ok(result.selected_sections.length <= 3);
});

test("context builder threads query embedding into hybrid selection (Danish)", () => {
  const ctx = {
    requested: true,
    document_id: "doc-asp",
    chunks: HEADINGS.map(([id, heading, content], i) => ({
      id,
      content: withTitle(heading, content),
      metadata: {
        section_heading: heading,
        category: "product_support",
        product_scope: "product-9114609942851",
        section_order: i,
      },
      embedding: basisVector(i),
    })),
  };
  const result = buildKnowledgeDocPreviewContext(ctx, {
    latestCustomerMessage: "Mikrofonen virker med kabel, men ikke når jeg bruger donglen.",
    queryEmbedding: basisVector(H.micCableDongle),
  });
  assert.equal(result.diagnostics.injected, true);
  assert.deepEqual(result.diagnostics.section_headings, [
    "Microphone works with the cable but not with the dongle",
  ]);
  const sel = result.diagnostics.product_support_section_selection;
  assert.equal(Array.isArray(sel.semantic_scores), true);
  assert.equal(Array.isArray(sel.lexical_scores), true);
});

// ---------------------------------------------------------------------------
// Low-confidence clarification: directive strength + banner correctness
// ---------------------------------------------------------------------------
const {
  wasPreviewDocumentInjected,
  wasPreviewDocumentClarification,
} = require("../apps/web/lib/server/knowledge-doc-preview-comparison.ts");

test("low-confidence blockText is a short language-agnostic instruction (no canned reply, no 'source of truth' frame)", () => {
  const result = buildKnowledgeDocPreviewContext(productSupportContext(), {
    latestCustomerMessage: "My A-Spire Wireless does not work properly.",
  });
  assert.equal(result.diagnostics.reason, "product_support_low_confidence");
  assert.ok(!result.blockText.includes("source of truth"));
  assert.ok(/clarification question/i.test(result.blockText));
  assert.ok(/do not provide troubleshooting/i.test(result.blockText));
  // No canned per-language reply text and no guide content leak.
  assert.ok(!result.blockText.includes("is the issue related to the microphone"));
  assert.ok(!result.blockText.includes("## Factory reset"));
});

test("banner: low-confidence clarification counts as preview USED, not unused", () => {
  const lowConf = {
    preview_document_context: {
      injected: true,
      preview_chunk_ids: [],
      reason: "product_support_low_confidence",
    },
  };
  assert.equal(wasPreviewDocumentInjected(lowConf), true);
  assert.equal(wasPreviewDocumentClarification(lowConf), true);
});

test("banner: a real section injection is USED but not a clarification", () => {
  const injected = {
    preview_document_context: {
      injected: true,
      preview_chunk_ids: ["c6"],
      reason: "product_support_selected",
    },
  };
  assert.equal(wasPreviewDocumentInjected(injected), true);
  assert.equal(wasPreviewDocumentClarification(injected), false);
});

test("banner: a genuinely uninjected run is still reported as not used", () => {
  const none = {
    preview_document_context: { injected: false, preview_chunk_ids: [], reason: "missing_document_id" },
  };
  assert.equal(wasPreviewDocumentInjected(none), false);
  assert.equal(wasPreviewDocumentClarification(none), false);
});

// ---------------------------------------------------------------------------
// Clarification trigger is language-agnostic: ambiguous EN/DA/DE/FR all abstain
// (reason product_support_low_confidence) → pipeline switches the writer into
// clarification-only mode regardless of language. A specific issue still selects.
// ---------------------------------------------------------------------------
const {
  isProductSupportClarificationReason,
} = require("../supabase/functions/generate-draft-v2/stages/product-support-clarification.ts");

const AMBIGUOUS = [
  ["en", "My A-Spire Wireless does not work properly."],
  ["da", "Mit A-Spire Wireless virker ikke ordentligt."],
  ["de", "Mein A-Spire Wireless funktioniert nicht richtig."],
  ["fr", "Mon A-Spire Wireless ne fonctionne pas correctement."],
];

for (const [lang, msg] of AMBIGUOUS) {
  test(`ambiguous ${lang} message abstains → clarification-only trigger (no section)`, () => {
    // No query embedding (lexical path); ambiguous wording has no heading anchor.
    const result = buildKnowledgeDocPreviewContext(productSupportContext(), {
      latestCustomerMessage: msg,
    });
    assert.equal(result.diagnostics.reason, "product_support_low_confidence");
    assert.deepEqual(result.diagnostics.section_headings, []);
    assert.equal(
      isProductSupportClarificationReason(result.diagnostics.reason),
      true,
      "pipeline would enable clarification-only mode",
    );
  });
}

test("specific app-pairing issue still selects a section (no clarification mode)", () => {
  const result = buildKnowledgeDocPreviewContext(productSupportContext(), {
    latestCustomerMessage: "My A-Spire Wireless will not connect to the AceZone app.",
  });
  assert.deepEqual(result.diagnostics.section_headings, [
    "Bluetooth pairing with the AceZone app",
  ]);
  assert.equal(
    isProductSupportClarificationReason(result.diagnostics.reason),
    false,
  );
});

test("Returns & Refunds preview never triggers clarification mode", () => {
  const returnsContext = {
    requested: true,
    document_id: "doc-returns",
    chunks: [
      { id: "r1", content: "30 days return window.", metadata: { section_heading: "Return window", category: "returns", section_order: 0 } },
    ],
  };
  const result = buildKnowledgeDocPreviewContext(returnsContext, {
    latestCustomerMessage: "anything unclear",
  });
  assert.equal(isProductSupportClarificationReason(result.diagnostics.reason), false);
});
