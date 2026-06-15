import { assertEquals } from "jsr:@std/assert@1";
import {
  evaluateRuntimeKnowledgeDocumentAccess,
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

function plan(primary_intent: string) {
  return { primary_intent, sub_queries: [] } as any;
}

function decision(input: {
  content: string;
  category: string;
  customerMessage: string;
  intent?: string;
  environment?: string;
}): RuntimeKnowledgeDocumentDecision {
  return evaluateRuntimeKnowledgeDocumentAccess({
    source_provider: "knowledge_document",
    content: input.content,
    metadata: {
      environment: input.environment ?? "preview",
      category: input.category,
      section_heading: "Runtime section",
    },
    plan: plan(input.intent ?? "complaint"),
    customerMessage: input.customerMessage,
    shop: SHOP,
  });
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
