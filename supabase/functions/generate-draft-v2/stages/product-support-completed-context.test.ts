import { assert, assertEquals } from "jsr:@std/assert@1";
import { buildKnowledgeDocPreviewContext } from "./knowledge-doc-preview-context.ts";

const PRODUCT_SUPPORT_DOC = {
  document_id: "ps-doc",
  sections: [
    {
      chunk_id: "mic-dongle",
      section_heading: "Microphone works with the cable but not with the dongle",
      content: "Select Generic USB Audio in Device Manager.",
      category: "product_support",
      product_scope: "product:gid://shopify/Product/1",
    },
    {
      chunk_id: "earpads",
      section_heading: "Replacing the ear pads",
      content: "How to replace the ear pads.",
      category: "product_support",
      product_scope: "product:gid://shopify/Product/1",
    },
  ],
};

const A_BLAZE_MESSAGE =
  "My A-Blaze keeps disconnecting and the audio is cracking with the wireless " +
  "dongle. I already updated the headset and dongle firmware, reinstalled the " +
  "USB driver and completed a factory reset. It does not occur over the USB-C cable.";

Deno.test("product-support preview surfaces a completed-troubleshooting block for A-Blaze", () => {
  const result = buildKnowledgeDocPreviewContext(PRODUCT_SUPPORT_DOC, {
    latestCustomerMessage: A_BLAZE_MESSAGE,
  });
  const block = result.completedTroubleshootingBlock ?? "";
  assert(/already completed/i.test(block), "expected completed-troubleshooting block");
  assert(/firmware/i.test(block));
  assert(/driver/i.test(block));
  assert(/factory reset/i.test(block));
  assert(/order number/i.test(block));
});

Deno.test("Returns & Refunds preview is unchanged — no completed-troubleshooting block", () => {
  const before = buildKnowledgeDocPreviewContext({
    document_id: "rr-doc",
    sections: [
      {
        chunk_id: "rw",
        section_key: "return_window",
        section_heading: "Return window",
        content: "30 days",
      },
    ],
  });
  // Block text identical to the legacy "inject all" behavior and no new field.
  assert(before.blockText?.includes("## Return window"));
  assertEquals(before.completedTroubleshootingBlock, null);
  assertEquals(before.diagnostics?.reason, "injected");
});

Deno.test("ordinary runtime (no preview context) is untouched", () => {
  const result = buildKnowledgeDocPreviewContext(null);
  assertEquals(result.blockText, null);
  assertEquals(result.diagnostics, null);
  assertEquals(result.completedTroubleshootingBlock, null);
});

Deno.test("product-support preview with no completed steps yields no block", () => {
  const result = buildKnowledgeDocPreviewContext(PRODUCT_SUPPORT_DOC, {
    latestCustomerMessage: "My microphone does not work through the dongle.",
  });
  assertEquals(result.completedTroubleshootingBlock, null);
});
