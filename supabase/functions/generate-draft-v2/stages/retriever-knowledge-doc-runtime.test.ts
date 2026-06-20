import { assertEquals } from "jsr:@std/assert@1";
import {
  buildScoreBreakdown,
  evaluateRuntimeKnowledgeDocumentAccess,
  type RetrievedChunk,
  type RuntimeKnowledgeDocumentDecision,
} from "./retriever.ts";

const SHOP = {
  product_overview: [
    "- A-Spire Wireless",
    "- A-Spire",
    "- A-Blaze",
    "- A-Rise",
    "- Ear pads",
    "- IEM + Sound Card",
    "- A-Live",
  ].join("\n"),
};

function plan(primary_intent: string, resolution_stage?: string) {
  return { primary_intent, resolution_stage: resolution_stage ?? "info_only", sub_queries: [] } as any;
}

function decision(input: {
  content: string;
  category: string;
  customerMessage: string;
  intent?: string;
  resolution_stage?: string;
  environment?: string;
  metadata?: Record<string, unknown>;
}): RuntimeKnowledgeDocumentDecision {
  return evaluateRuntimeKnowledgeDocumentAccess({
    source_provider: "knowledge_document",
    content: input.content,
    metadata: {
      environment: input.environment ?? "preview",
      category: input.category,
      section_heading: "Runtime section",
      ...input.metadata,
    },
    plan: plan(input.intent ?? "complaint", input.resolution_stage),
    customerMessage: input.customerMessage,
    shop: SHOP,
  });
}

function chunk(
  input: Partial<RetrievedChunk> & {
    id: string;
    content: string;
    source_label: string;
  },
): RetrievedChunk {
  return {
    kind: "document",
    similarity: 0.05,
    usable_as: "background",
    risk_flags: [],
    applies_to_all_products: false,
    chunk_issue_types: [],
    products: [],
    ...input,
  };
}

function finalScore(
  candidate: RetrievedChunk,
  options: {
    mentionedProducts: string[];
    issueTerms: string[];
  },
): number {
  return buildScoreBreakdown({
    chunk: candidate,
    mentionedProducts: options.mentionedProducts,
    otherProducts: [],
    issueTerms: options.issueTerms,
  }).final_score;
}

Deno.test("inbox runtime may include same-product Product Support document chunks", () => {
  const result = decision({
    category: "product_support",
    content:
      "# A-Spire Wireless — Product Support\n\n## Firmware update\nReconnect the dongle and update firmware.",
    customerMessage: "My A-Spire Wireless keeps disconnecting and cracking.",
  });
  assertEquals(result, { allowed: true, reason: "same_product_context" });
});

Deno.test("Product Support ownership uses metadata, not cross-product body mentions", () => {
  const blocked = decision({
    category: "product_support",
    content:
      "# A-Blaze — Product Support\n\n## Compatibility note\nDo not use this guide for A-Spire Wireless dongle issues.",
    metadata: { product_title: "A-Blaze" },
    customerMessage: "My A-Spire Wireless keeps disconnecting and cracking.",
  });
  assertEquals(blocked, { allowed: false, reason: "wrong_product_context" });
});

Deno.test("same-product metadata passes even if body mentions another product", () => {
  const allowed = decision({
    category: "product_support",
    content:
      "# A-Spire Wireless — Product Support\n\n## Compatibility note\nDo not confuse this with A-Blaze Bluetooth pairing.",
    metadata: { product_title: "A-Spire Wireless" },
    customerMessage: "My A-Spire Wireless keeps disconnecting and cracking.",
  });
  assertEquals(allowed, { allowed: true, reason: "same_product_context" });
});

Deno.test("inbox runtime excludes wrong-product Product Support document chunks", () => {
  const result = decision({
    category: "product_support",
    content:
      "# A-Blaze — Product Support\n\n## Disconnects\nUse this for A-Blaze Bluetooth disconnects.",
    customerMessage: "My A-Spire Wireless keeps disconnecting and cracking.",
  });
  assertEquals(result, { allowed: false, reason: "wrong_product_context" });
});

Deno.test("wired A-Spire document is excluded from A-Spire Wireless inbox context", () => {
  const result = decision({
    category: "product_support",
    content:
      "# A-Spire — Product Support\n\n## Headset loses connection\nUse this for the wired headset.",
    customerMessage: "My A-Spire Wireless keeps disconnecting.",
  });
  assertEquals(result, { allowed: false, reason: "wrong_product_context" });
});

Deno.test("production Product Support chunks use the same runtime scope gate", () => {
  const result = decision({
    category: "product_support",
    content:
      "# A-Blaze — Product Support\n\n## Microphone\nUse this for A-Blaze microphone issues.",
    customerMessage: "My A-Blaze microphone is not working.",
    environment: "production",
  });
  assertEquals(result, { allowed: true, reason: "same_product_context" });
});

Deno.test("ambiguous Product Support product context fails closed", () => {
  const result = decision({
    category: "product_support",
    content:
      "# A-Blaze — Product Support\n\n## Bluetooth\nUse this for A-Blaze Bluetooth pairing.",
    customerMessage: "My A-Blaze and A-Rise both have app problems.",
  });
  assertEquals(result, { allowed: false, reason: "ambiguous_product_context" });
});

Deno.test("missing Product Support product context fails closed for non-software queries", () => {
  const result = decision({
    category: "product_support",
    content:
      "# A-Blaze — Product Support\n\n## Physical damage\nUse this for A-Blaze physical damage.",
    customerMessage: "My headset is broken.",
  });
  assertEquals(result, { allowed: false, reason: "missing_product_context" });
});

Deno.test("Product Support chunks without trusted product ownership fail closed", () => {
  const result = decision({
    category: "product_support",
    content:
      "## Bluetooth\nThis guide mentions A-Blaze and A-Spire Wireless only in body examples.",
    customerMessage: "My A-Blaze has app problems.",
  });
  assertEquals(result, {
    allowed: false,
    reason: "document_product_unresolved",
  });
});

Deno.test("generic Ear pads document appears only for ear-pad context", () => {
  const allowed = decision({
    category: "product_support",
    content:
      "# Ear pads — Product Support\n\n## Compatibility by headset\nUse this for replacement ear pad compatibility.",
    customerMessage: "Do you have replacement ear pads for A-Rise?",
  });
  assertEquals(allowed, { allowed: true, reason: "ear_pads_context" });

  const blocked = decision({
    category: "product_support",
    content:
      "# Ear pads — Product Support\n\n## Compatibility by headset\nUse this for replacement ear pad compatibility.",
    customerMessage: "My A-Rise cable is broken.",
  });
  assertEquals(blocked, {
    allowed: false,
    reason: "ear_pads_document_without_context",
  });
});

Deno.test("product-specific ear-pad sections still require matching product", () => {
  const result = decision({
    category: "product_support",
    content:
      "# A-Rise — Product Support\n\n## Ear pads for A-Rise\nUse this for A-Rise ear pads.",
    customerMessage: "Do you have replacement ear pads for A-Spire Wireless?",
  });
  assertEquals(result, { allowed: false, reason: "wrong_product_context" });
});

Deno.test("Returns & Refunds chunks only appear for return or refund context", () => {
  const allowed = decision({
    category: "returns",
    content:
      "# Returns & Refunds\n\n## Return window\nCustomers can return within the documented window.",
    customerMessage: "How many days do I have to return my order?",
    intent: "return",
  });
  assertEquals(allowed, { allowed: true, reason: "returns_context" });

  const blocked = decision({
    category: "returns",
    content:
      "# Returns & Refunds\n\n## Return window\nCustomers can return within the documented window.",
    customerMessage: "My A-Blaze microphone is not working.",
    intent: "complaint",
  });
  assertEquals(blocked, { allowed: false, reason: "not_returns_context" });
});

// ---- General technical support context ----

Deno.test("technical support doc allows robotic Windows microphone questions", () => {
  const result = decision({
    category: "technical_support",
    content:
      "# General PC Audio Troubleshooting\n\n## Windows microphone format and sound enhancements\nSet the microphone format to 48000Hz and disable sound enhancements.",
    customerMessage: "My mic sounds robotic on Windows",
  });
  assertEquals(result, { allowed: true, reason: "technical_support_context" });
});

Deno.test("technical support doc allows Discord microphone questions", () => {
  const result = decision({
    category: "technical_support",
    content:
      "# General PC Audio Troubleshooting\n\n## Discord microphone processing\nTurn off Krisp and noise suppression if the microphone sounds bad in Discord.",
    customerMessage: "My microphone sounds bad in Discord",
  });
  assertEquals(result, { allowed: true, reason: "technical_support_context" });
});

Deno.test("technical support doc allows 48kHz microphone format questions", () => {
  const result = decision({
    category: "technical_support",
    content:
      "# General PC Audio Troubleshooting\n\n## Windows microphone format\nSet Headset Microphone to 48000Hz if it is currently 16000Hz.",
    customerMessage: "How do I set my microphone to 48kHz?",
  });
  assertEquals(result, { allowed: true, reason: "technical_support_context" });
});

Deno.test("technical support doc blocks order status questions", () => {
  const result = decision({
    category: "technical_support",
    content:
      "# General PC Audio Troubleshooting\n\n## Windows microphone format\nSet Headset Microphone to 48000Hz.",
    customerMessage: "Where is my order?",
  });
  assertEquals(result, { allowed: false, reason: "not_technical_support_context" });
});

Deno.test("technical support doc blocks return questions", () => {
  const result = decision({
    category: "technical_support",
    content:
      "# General PC Audio Troubleshooting\n\n## Windows microphone format\nSet Headset Microphone to 48000Hz.",
    customerMessage: "Can I return my headset?",
    intent: "return",
  });
  assertEquals(result, { allowed: false, reason: "not_technical_support_context" });
});

Deno.test("technical support doc blocks product comparison questions", () => {
  const result = decision({
    category: "technical_support",
    content:
      "# General PC Audio Troubleshooting\n\n## Windows microphone format\nSet Headset Microphone to 48000Hz.",
    customerMessage: "Which headset should I choose?",
    intent: "product_question",
  });
  assertEquals(result, { allowed: false, reason: "not_technical_support_context" });
});

Deno.test("legacy non-document knowledge remains allowed by the document gate", () => {
  const result = evaluateRuntimeKnowledgeDocumentAccess({
    source_provider: "manual_text",
    content: "Legacy troubleshooting snippet",
    metadata: { audience: "public" },
    plan: plan("complaint"),
    customerMessage: "My A-Blaze microphone is not working.",
    shop: SHOP,
  });
  assertEquals(result, { allowed: true, reason: "not_knowledge_document" });
});

Deno.test("unsupported document environments are not used in inbox retrieval", () => {
  const result = decision({
    category: "product_support",
    content:
      "# A-Blaze — Product Support\n\n## Microphone\nUse this for A-Blaze microphone issues.",
    customerMessage: "My A-Blaze microphone is not working.",
    environment: "staging",
  });
  assertEquals(result, {
    allowed: false,
    reason: "unsupported_document_environment",
  });
});

Deno.test("same-product A-Spire Wireless Knowledge Doc receives post-gate retrieval boost", () => {
  const access = decision({
    category: "product_support",
    metadata: { product_title: "A-Spire Wireless" },
    content:
      "# A-Spire Wireless — Product Support\n\n## Firmware update for audio cracking or repeated disconnects\nUpdate the headset and dongle firmware.",
    customerMessage:
      "My A-Spire Wireless keeps disconnecting and the audio is cracking.",
  });
  assertEquals(access, { allowed: true, reason: "same_product_context" });

  const doc = chunk({
    id: "doc-aspire",
    content:
      "# A-Spire Wireless — Product Support\n\n## Firmware update for audio cracking or repeated disconnects\nUpdate the headset and dongle firmware.",
    source_label: "knowledge_document",
    source_provider: "knowledge_document",
    document_category: "product_support",
    knowledge_document_access_reason: access.reason,
    products: ["a-spire wireless"],
    similarity: 0.04,
  });
  const legacy = chunk({
    id: "legacy-aspire",
    content: "Firmware updater notes for A-Spire Wireless audio cracking.",
    source_label: "manual_text: Firmware note",
    kind: "snippet",
    products: ["a-spire wireless"],
    similarity: 0.10,
  });

  const score = (c: RetrievedChunk) =>
    finalScore(c, {
      mentionedProducts: ["A-Spire Wireless"],
      issueTerms: ["firmware", "audio", "connectivity"],
    });
  assertEquals(score(doc) > score(legacy), true);
  assertEquals(
    buildScoreBreakdown({
      chunk: doc,
      mentionedProducts: ["A-Spire Wireless"],
      otherProducts: [],
      issueTerms: ["firmware", "audio", "connectivity"],
    }).product_support_doc_boost > 0,
    true,
  );
});

Deno.test("same-product A-Blaze Knowledge Doc receives post-gate retrieval boost", () => {
  const access = decision({
    category: "product_support",
    metadata: { product_title: "A-Blaze" },
    content:
      "# A-Blaze — Product Support\n\n## Microphone is not working or sounds unclear\nUse this for A-Blaze microphone issues.",
    customerMessage: "My A-Blaze microphone sounds bad and unclear.",
  });
  assertEquals(access, { allowed: true, reason: "same_product_context" });

  const doc = chunk({
    id: "doc-ablaze",
    content:
      "# A-Blaze — Product Support\n\n## Microphone is not working or sounds unclear\nUse this for A-Blaze microphone issues.",
    source_label: "knowledge_document",
    source_provider: "knowledge_document",
    document_category: "product_support",
    knowledge_document_access_reason: access.reason,
    products: ["a-blaze"],
    similarity: 0.04,
  });
  const legacy = chunk({
    id: "legacy-ablaze",
    content: "General A-Blaze microphone troubleshooting.",
    source_label: "manual_text: A-Blaze mic",
    kind: "snippet",
    products: ["a-blaze"],
    similarity: 0.10,
  });

  assertEquals(
    finalScore(doc, {
      mentionedProducts: ["A-Blaze"],
      issueTerms: ["microphone"],
    }) >
      finalScore(legacy, {
        mentionedProducts: ["A-Blaze"],
        issueTerms: ["microphone"],
      }),
    true,
  );
});

Deno.test("Product Support boost matches issue terms by token and phrase boundaries", () => {
  const boostFor = (content: string, issueTerms: string[]) =>
    buildScoreBreakdown({
      chunk: chunk({
        id: "doc-aspire",
        content,
        source_label: "knowledge_document",
        source_provider: "knowledge_document",
        document_category: "product_support",
        knowledge_document_access_reason: "same_product_context",
        products: ["a-spire wireless"],
        similarity: 0.04,
      }),
      mentionedProducts: ["A-Spire Wireless"],
      otherProducts: [],
      issueTerms,
    }).product_support_doc_boost;

  assertEquals(
    boostFor(
      "# A-Spire Wireless — Product Support\n\n## App pairing\nUse this for app connection issues.",
      ["app"],
    ) > 0,
    true,
  );
  assertEquals(
    boostFor(
      "# A-Spire Wireless — Product Support\n\n## Random note\nThis happens when status appears in the application log.",
      ["app"],
    ),
    0,
  );
  assertEquals(
    boostFor(
      "# A-Spire Wireless — Product Support\n\n## Ear pads\nUse this for replacement ear pads.",
      ["ear_pads"],
    ) > 0,
    true,
  );
  assertEquals(
    boostFor(
      "# A-Spire Wireless — Product Support\n\n## Ear pads\nUse this for replacement ear pads.",
      ["ear-pads"],
    ) > 0,
    true,
  );
  assertEquals(
    boostFor(
      "# A-Spire Wireless — Product Support\n\n## Audio quality\nUse this for audio quality issues.",
      ["audio quality"],
    ) > 0,
    true,
  );
});

Deno.test("wrong-product Product Support docs remain excluded before boost can apply", () => {
  const blocked = decision({
    category: "product_support",
    content:
      "# A-Blaze — Product Support\n\n## Compatibility note\nThis body mentions A-Spire Wireless and dongle disconnects.",
    metadata: { product_title: "A-Blaze" },
    customerMessage: "My A-Spire Wireless dongle keeps disconnecting.",
  });
  assertEquals(blocked, { allowed: false, reason: "wrong_product_context" });
});

Deno.test("legacy knowledge is preserved alongside boosted Product Support docs", () => {
  const doc = chunk({
    id: "doc-aspire",
    content:
      "# A-Spire Wireless — Product Support\n\n## Dongle pairing\nPair the wireless dongle with the headset.",
    source_label: "knowledge_document",
    source_provider: "knowledge_document",
    document_category: "product_support",
    knowledge_document_access_reason: "same_product_context",
    products: ["a-spire wireless"],
    similarity: 0.04,
  });
  const legacy = chunk({
    id: "legacy-aspire",
    content: "Legacy A-Spire Wireless dongle pairing note.",
    source_label: "manual_text: Dongle pairing",
    kind: "snippet",
    products: ["a-spire wireless"],
    similarity: 0.08,
  });
  const ranked = [legacy, doc].sort((a, b) =>
    finalScore(b, {
      mentionedProducts: ["A-Spire Wireless"],
      issueTerms: ["pairing", "connectivity"],
    }) -
    finalScore(a, {
      mentionedProducts: ["A-Spire Wireless"],
      issueTerms: ["pairing", "connectivity"],
    })
  );
  assertEquals(ranked.map((c) => c.id), ["doc-aspire", "legacy-aspire"]);
});

Deno.test("Returns & Refunds Knowledge Doc scoring is unchanged by Product Support boost", () => {
  const returnsDoc = chunk({
    id: "doc-returns",
    content:
      "# Returns & Refunds\n\n## Refund processing\nRefunds are processed after the return is received.",
    source_label: "knowledge_document",
    source_provider: "knowledge_document",
    document_category: "returns",
    knowledge_document_access_reason: "returns_context",
    similarity: 0.08,
  });
  const breakdown = buildScoreBreakdown({
    chunk: returnsDoc,
    mentionedProducts: [],
    otherProducts: [],
    issueTerms: ["refund", "return"],
  });
  assertEquals(breakdown.product_support_doc_boost, 0);
});

Deno.test("Ear pads Knowledge Doc is boosted only for ear-pad context", () => {
  const doc = chunk({
    id: "doc-ear-pads",
    content:
      "# Ear pads — Product Support\n\n## Compatibility by headset\nUse this for replacement ear pad compatibility.",
    source_label: "knowledge_document",
    source_provider: "knowledge_document",
    document_category: "product_support",
    knowledge_document_access_reason: "ear_pads_context",
    products: ["ear pads"],
    similarity: 0.04,
  });
  const earPadCases = [
    {
      message: "Do you have replacement ear pads for A-Spire Wireless?",
      mentionedProducts: ["A-Spire Wireless"],
    },
    {
      message: "Are A-Rise ear pads available?",
      mentionedProducts: ["A-Rise"],
    },
    {
      message: "Which ear pads fit A-Blaze?",
      mentionedProducts: ["A-Blaze"],
    },
    {
      message: "Can I buy new cushions for my A-Spire?",
      mentionedProducts: ["A-Spire"],
    },
  ];

  for (const { message, mentionedProducts } of earPadCases) {
    const allowed = decision({
      category: "product_support",
      content:
        "# Ear pads — Product Support\n\n## Compatibility by headset\nUse this for replacement ear pad compatibility.",
      customerMessage: message,
    });
    assertEquals(allowed, { allowed: true, reason: "ear_pads_context" });

    const allowedBreakdown = buildScoreBreakdown({
      chunk: doc,
      mentionedProducts,
      otherProducts: [],
      issueTerms: ["ear_pads"],
    });
    assertEquals(allowedBreakdown.product_support_doc_boost > 0, true);
    assertEquals(allowedBreakdown.cross_product_penalty, 0);
  }

  for (
    const message of [
      "My A-Spire Wireless has bad audio.",
      "My A-Blaze microphone is not working.",
      "My A-Rise won't turn on.",
      "A-Spire Wireless Bluetooth pairing issue.",
    ]
  ) {
    const blocked = decision({
      category: "product_support",
      content:
        "# Ear pads — Product Support\n\n## Compatibility by headset\nUse this for replacement ear pad compatibility.",
      customerMessage: message,
    });
    assertEquals(blocked, {
      allowed: false,
      reason: "ear_pads_document_without_context",
    });
  }
});

// ---- Cross-product software/app/Bluetooth context ----

Deno.test("app question without product allows app-related document sections", () => {
  const result = decision({
    category: "product_support",
    content:
      "# A-Rise — Product Support\n\n## App and Bluetooth setup\nUse this for AceZone app pairing with A-Rise.",
    customerMessage: "Can I use the AceZone app with my headset?",
    metadata: { section_heading: "App and Bluetooth setup" },
  });
  assertEquals(result, { allowed: true, reason: "cross_product_software_context" });
});

Deno.test("firmware question without product allows firmware-related document sections", () => {
  const result = decision({
    category: "product_support",
    content:
      "# A-Spire Wireless — Product Support\n\n## Firmware update\nUpdate the headset and dongle firmware.",
    customerMessage: "How do I update the firmware on my headset?",
    metadata: { section_heading: "Firmware update" },
  });
  assertEquals(result, { allowed: true, reason: "cross_product_software_context" });
});

Deno.test("bluetooth question without product allows bluetooth-related document sections", () => {
  const result = decision({
    category: "product_support",
    content:
      "# A-Blaze — Product Support\n\n## Bluetooth pairing\nUse this for A-Blaze Bluetooth pairing.",
    customerMessage: "My headset won't connect via Bluetooth.",
    metadata: { section_heading: "Bluetooth pairing" },
  });
  assertEquals(result, { allowed: true, reason: "cross_product_software_context" });
});

Deno.test("software context does NOT allow sections without software/app signals", () => {
  const result = decision({
    category: "product_support",
    content:
      "# A-Rise — Product Support\n\n## Ear pads for A-Rise\nUse this for A-Rise ear pad compatibility.",
    customerMessage: "Can I use the AceZone app with my headset?",
    metadata: { section_heading: "Ear pads for A-Rise" },
  });
  assertEquals(result, { allowed: false, reason: "missing_product_context" });
});

Deno.test("non-software question without product still fails closed", () => {
  const result = decision({
    category: "product_support",
    content:
      "# A-Rise — Product Support\n\n## App and Bluetooth setup\nUse this for AceZone app pairing.",
    customerMessage: "Where can I buy a replacement cable?",
    metadata: { section_heading: "App and Bluetooth setup" },
  });
  assertEquals(result, { allowed: false, reason: "missing_product_context" });
});

// ---- Cross-product accessory (cable / adapter) context ----

Deno.test("adapter question without product allows cable/adapter document sections", () => {
  const result = decision({
    category: "product_support",
    content:
      "# A-Blaze — Product Support\n\n## Cable and adapter compatibility\nAny standard USB-C to USB-A adapter should work.",
    customerMessage: "Can I use a USB-C to USB-A adapter with the dongle?",
    metadata: { section_heading: "Cable and adapter compatibility" },
  });
  assertEquals(result, { allowed: true, reason: "cross_product_accessory_context" });
});

Deno.test("cable question without product allows cable/adapter document sections", () => {
  const result = decision({
    category: "product_support",
    content:
      "# A-Spire Wireless — Product Support\n\n## Cable and adapter compatibility\nAny standard USB-C cable works.",
    customerMessage: "Can I use any USB-C cable with my headset?",
    metadata: { section_heading: "Cable and adapter compatibility" },
  });
  assertEquals(result, { allowed: true, reason: "cross_product_accessory_context" });
});

Deno.test("accessory context does NOT allow non-accessory document sections", () => {
  const result = decision({
    category: "product_support",
    content:
      "# A-Blaze — Product Support\n\n## Microphone troubleshooting\nSet the mic format to 48000Hz.",
    customerMessage: "Can I use a USB-C to USB-A adapter with the dongle?",
    metadata: { section_heading: "Microphone troubleshooting" },
  });
  assertEquals(result, { allowed: false, reason: "missing_product_context" });
});

Deno.test("generic product question without accessory signal still fails closed", () => {
  const result = decision({
    category: "product_support",
    content:
      "# A-Blaze — Product Support\n\n## Cable and adapter compatibility\nAny standard USB-C cable works.",
    customerMessage: "Which headset should I choose?",
    metadata: { section_heading: "Cable and adapter compatibility" },
  });
  assertEquals(result, { allowed: false, reason: "missing_product_context" });
});

Deno.test("pure adapter compatibility does NOT pull in the Returns & Refunds doc", () => {
  const result = decision({
    category: "returns",
    content:
      "# Returns & Refunds\n\n## Cable, adapter and accessory replacements\nWarranty handling for accessories.",
    customerMessage: "Can I use a USB-C to USB-A adapter with the dongle?",
    intent: "product_question",
    metadata: { section_heading: "Cable, adapter and accessory replacements" },
  });
  assertEquals(result, { allowed: false, reason: "not_returns_context" });
});

Deno.test("warranty/replacement cable question still retrieves Returns & Refunds", () => {
  const result = decision({
    category: "returns",
    content:
      "# Returns & Refunds\n\n## Cable, adapter and accessory replacements\nWarranty handling for accessories.",
    customerMessage: "My cable is defective, can I get a replacement under warranty?",
    intent: "return",
    metadata: { section_heading: "Cable, adapter and accessory replacements" },
  });
  assertEquals(result, { allowed: true, reason: "returns_context" });
});

Deno.test("IEM + Sound Card matches with 'and' connector in customer message", () => {
  const result = decision({
    category: "product_support",
    content:
      "# IEM + Sound Card — Product Support\n\n## Release date or availability\nExplain that AceZone cannot provide a release estimate.",
    customerMessage: "When will the IEM and sound card be released?",
    metadata: { product_title: "IEM + Sound Card" },
  });
  assertEquals(result, { allowed: true, reason: "same_product_context" });
});

Deno.test("cross-product software context Knowledge Doc receives post-gate retrieval boost", () => {
  const access = decision({
    category: "product_support",
    content:
      "# A-Rise — Product Support\n\n## App and Bluetooth setup\nUse this for AceZone app pairing with A-Rise.",
    customerMessage: "Can I use the AceZone app with my headset?",
    metadata: { section_heading: "App and Bluetooth setup" },
  });
  assertEquals(access, { allowed: true, reason: "cross_product_software_context" });

  const doc = chunk({
    id: "doc-app-rise",
    content:
      "# A-Rise — Product Support\n\n## App and Bluetooth setup\nUse this for AceZone app pairing with A-Rise.",
    source_label: "knowledge_document",
    source_provider: "knowledge_document",
    document_category: "product_support",
    knowledge_document_access_reason: access.reason,
    products: ["a-rise"],
    similarity: 0.04,
  });

  const score = finalScore(doc, {
    mentionedProducts: [],
    issueTerms: ["app", "connectivity"],
  });
  const breakdown = buildScoreBreakdown({
    chunk: doc,
    mentionedProducts: [],
    otherProducts: [],
    issueTerms: ["app", "connectivity"],
  });
  assertEquals(breakdown.product_support_doc_boost > 0, true);
  assertEquals(breakdown.cross_product_penalty, 0);
});

// ---- initiate_warranty_repair opens returns gate for complaint intent ----

Deno.test("complaint + initiate_warranty_repair allows Returns & Refunds chunks", () => {
  const result = decision({
    category: "returns",
    content:
      "# Returns & Refunds\n\n## Return for swap\nIf troubleshooting is exhausted, ask the customer for their order number.",
    customerMessage:
      "I tried all troubleshooting steps and the headset still does not work.",
    intent: "complaint",
    resolution_stage: "initiate_warranty_repair",
  });
  assertEquals(result, { allowed: true, reason: "returns_context" });
});

Deno.test("generic complaint without initiate_warranty_repair still blocks Returns & Refunds chunks", () => {
  const result = decision({
    category: "returns",
    content:
      "# Returns & Refunds\n\n## Return window\nCustomers can return within the documented window.",
    customerMessage: "My A-Blaze microphone is not working.",
    intent: "complaint",
    resolution_stage: "troubleshoot_first",
  });
  assertEquals(result, { allowed: false, reason: "not_returns_context" });
});

Deno.test("return/refund/exchange intents still allow Returns & Refunds chunks regardless of resolution_stage", () => {
  for (const intent of ["return", "refund", "exchange"]) {
    const result = decision({
      category: "returns",
      content:
        "# Returns & Refunds\n\n## Refund processing\nRefunds are processed after the return is received.",
      customerMessage: "I want to return my headset.",
      intent,
    });
    assertEquals(result, { allowed: true, reason: "returns_context" });
  }
});

Deno.test("initiate_warranty_repair does not affect product_support gate", () => {
  const result = decision({
    category: "product_support",
    content:
      "# A-Blaze — Product Support\n\n## Physical damage\nUse this for A-Blaze physical damage.",
    customerMessage: "My headset is broken.",
    intent: "complaint",
    resolution_stage: "initiate_warranty_repair",
  });
  assertEquals(result, { allowed: false, reason: "missing_product_context" });
});
