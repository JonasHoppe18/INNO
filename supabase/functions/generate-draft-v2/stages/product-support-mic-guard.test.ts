import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  type ProductSupportSection,
  selectProductSupportSections,
} from "./product-support-section-selector.ts";

// Minimal stand-in reproducing the manual A-Blaze mis-selection: the
// microphone-specific Generic-USB-Audio guide is the ONLY section whose heading
// lexically anchors on the customer's "dongle"/"cable" wording, so without a
// guard the lexical path selects it even though the live issue is cracking /
// disconnecting audio with NO microphone symptom. No embeddings → pure lexical
// path (the path that mis-selected the guide in the UI run).
const SECTIONS: ProductSupportSection[] = [
  {
    chunk_id: "mic-dongle",
    section_key: "mic_cable_vs_dongle",
    section_heading: "Microphone works with the cable but not with the dongle",
    content:
      "Update the dongle driver through Device Manager and select Generic USB Audio.",
  },
  {
    chunk_id: "earpads",
    section_key: "earpads",
    section_heading: "Replacing the ear pads",
    content: "How to remove and replace the ear pads.",
  },
];

Deno.test("dongle-only cracking/disconnect does NOT select the microphone Generic USB Audio guide", () => {
  const selection = selectProductSupportSections({
    latest_customer_message:
      "My A-Blaze keeps disconnecting and the audio is cracking with the wireless dongle. It does not occur through the USB-C cable.",
    conversation_history:
      "It only occurs with the wireless dongle. The issue does not occur over the cable.",
    sections: SECTIONS,
  });
  const headings = selection.selected_sections.map((s) => s.section_heading);
  assert(
    !headings.some((h) => /microphone/i.test(h)),
    `microphone guide must not be selected, got: ${JSON.stringify(headings)}`,
  );
});

Deno.test("an actual microphone-by-cable-vs-dongle issue STILL selects the Generic USB Audio guide", () => {
  const selection = selectProductSupportSections({
    latest_customer_message:
      "My microphone works with the cable but not with the dongle. No sound from the mic over the dongle.",
    sections: SECTIONS,
  });
  const headings = selection.selected_sections.map((s) => s.section_heading);
  assertEquals(
    headings.includes("Microphone works with the cable but not with the dongle"),
    true,
    `expected the microphone guide, got: ${JSON.stringify(headings)}`,
  );
});

Deno.test("mic guard does not fire when there is no non-microphone audio issue", () => {
  // A plain pairing question with no disconnect/cracking signal: the guard must
  // stay inert (it only removes the mic section for non-mic AUDIO faults).
  const selection = selectProductSupportSections({
    latest_customer_message:
      "How do I replace the ear pads on my headset?",
    sections: SECTIONS,
  });
  const headings = selection.selected_sections.map((s) => s.section_heading);
  assertEquals(headings, ["Replacing the ear pads"]);
});
