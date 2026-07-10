import { assertEquals } from "jsr:@std/assert@1";
import { detectStepGuideChunks } from "./step-guide-mode.ts";

// Send-ready analysis (2026-07-07): ~20/28 non-send-ready drafts were
// CORRECT but incomplete — the writer's universal brevity rules ("højst 1-2
// sætninger mere", "aldrig knowledge ordret") compress step-by-step guides
// that human agents paste in full (factory reset dropped, firmware steps
// dropped). Guide-mode detection lets the prompt mode-split: decisive AND
// complete.

const GUIDE = `# A-Spire Wireless — Product Support

## Bluetooth pairing with the AceZone app

- Make sure your headset is powered on and that no cables are connected.
- Make sure your phone's Bluetooth is turned on.
- Press and hold the power button until you hear the pairing voice.
- Pair the headset in your phone's Bluetooth settings.
- Open the AceZone app and tap "+".`;

const POLICY = `# Returns & Refunds

## Return window

Products may be returned within 30 days of delivery.`;

Deno.test("detects a selected step-by-step guide chunk", () => {
  assertEquals(detectStepGuideChunks([{ content: GUIDE }]), true);
});

Deno.test("numbered steps also count", () => {
  const numbered = "## Factory reset\n\n1. Power off the headset.\n2. Hold the ANC button for 8 seconds.\n3. Wait for the purple light.";
  assertEquals(detectStepGuideChunks([{ content: numbered }]), true);
});

Deno.test("short policy text is not a guide", () => {
  assertEquals(detectStepGuideChunks([{ content: POLICY }]), false);
});

Deno.test("empty selection is not a guide", () => {
  assertEquals(detectStepGuideChunks([]), false);
  assertEquals(detectStepGuideChunks([{ content: "" }]), false);
});
