import { assertEquals } from "jsr:@std/assert@1";
import {
  detectMissingDamageDocumentationAsk,
  isPhysicalDamageMessage,
} from "./damage-documentation-ask.ts";

// A CS employee never arranges a warranty replacement for PHYSICAL damage
// without seeing documentation first. The writer directive prioritises
// foto/video, but the model skips it in a share of runs (observed on
// T-051002: replacement offered, no photo ask). Deterministic backstop.

const DAMAGE_MSG =
  "A small plastic piece on the microphone has broken off and keeps falling out.";

Deno.test("physical-damage message detection (EN + DA)", () => {
  assertEquals(isPhysicalDamageMessage(DAMAGE_MSG), true);
  assertEquals(isPhysicalDamageMessage("Mit headset er knækket ved bøjlen"), true);
  assertEquals(isPhysicalDamageMessage("My mic sounds distorted in calls"), false);
});

Deno.test("flags replacement offer without a photo/video ask", () => {
  const v = detectMissingDamageDocumentationAsk({
    draftText:
      "Hi Mark, since the plastic piece has broken off, we can proceed with a replacement under warranty. Let me know if you'd like us to arrange it.",
    customerMessage: DAMAGE_MSG,
    imageAttachmentCount: 0,
  });
  assertEquals(v.length > 0, true);
});

Deno.test("satisfied when the draft asks for photos or video", () => {
  for (
    const draft of [
      "We can arrange a replacement. Please send clear photos of the damage first.",
      "Vi kan sende en erstatning — send os gerne en kort video eller billeder af skaden.",
    ]
  ) {
    assertEquals(
      detectMissingDamageDocumentationAsk({
        draftText: draft,
        customerMessage: DAMAGE_MSG,
        imageAttachmentCount: 0,
      }),
      [],
      draft,
    );
  }
});

Deno.test("inactive when the customer already attached images", () => {
  const v = detectMissingDamageDocumentationAsk({
    draftText: "We can proceed with a replacement under warranty.",
    customerMessage: DAMAGE_MSG,
    imageAttachmentCount: 2,
  });
  assertEquals(v, []);
});

Deno.test("inactive when the message is not physical damage", () => {
  const v = detectMissingDamageDocumentationAsk({
    draftText: "We can arrange a replacement for you.",
    customerMessage: "My headset keeps disconnecting from the dongle.",
    imageAttachmentCount: 0,
  });
  assertEquals(v, []);
});

Deno.test("inactive when the draft does not offer replacement/repair", () => {
  const v = detectMissingDamageDocumentationAsk({
    draftText: "Could you tell me when you bought the headset?",
    customerMessage: DAMAGE_MSG,
    imageAttachmentCount: 0,
  });
  assertEquals(v, []);
});
