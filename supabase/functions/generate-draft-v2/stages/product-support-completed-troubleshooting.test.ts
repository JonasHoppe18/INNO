import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  buildCompletedTroubleshootingBlock,
  detectCompletedTroubleshooting,
} from "./product-support-completed-troubleshooting.ts";

const A_BLAZE_FIRST_TURN =
  "Hi, my A-Blaze keeps disconnecting and the audio is cracking. I have " +
  "already updated both the headset and dongle firmware, reinstalled the " +
  "USB driver and completed a factory reset. The issue is still there.";

const A_BLAZE_LATER_FACTS = [
  "I use the wireless dongle.",
  "Bluetooth is disabled.",
  "The issue also happens on another computer.",
  "The standby timer is already disabled.",
  "It only occurs with the wireless dongle.",
  "It does not occur through the USB-C cable.",
].join("\n");

Deno.test("detects completed headset + dongle firmware updates", () => {
  const steps = detectCompletedTroubleshooting(A_BLAZE_FIRST_TURN);
  assert(
    steps.some((s) => /headset/i.test(s) && /firmware/i.test(s)),
    "expected headset firmware step",
  );
  assert(
    steps.some((s) => /dongle/i.test(s) && /firmware/i.test(s)),
    "expected dongle firmware step",
  );
});

Deno.test("detects completed USB driver reinstall", () => {
  const steps = detectCompletedTroubleshooting(A_BLAZE_FIRST_TURN);
  assert(steps.some((s) => /driver/i.test(s)), "expected USB driver step");
});

Deno.test("detects completed factory reset", () => {
  const steps = detectCompletedTroubleshooting(A_BLAZE_FIRST_TURN);
  assert(steps.some((s) => /factory reset/i.test(s)), "expected factory reset step");
});

Deno.test("detects later-turn facts (standby timer, bluetooth, other device, cable, isolated)", () => {
  const steps = detectCompletedTroubleshooting(A_BLAZE_LATER_FACTS);
  assert(steps.some((s) => /standby/i.test(s)), "expected standby timer step");
  assert(steps.some((s) => /bluetooth/i.test(s)), "expected bluetooth step");
  assert(steps.some((s) => /another|other/i.test(s)), "expected other-device step");
  assert(steps.some((s) => /cable/i.test(s)), "expected cable-isolation step");
  assert(steps.some((s) => /dongle/i.test(s)), "expected dongle-isolation step");
});

Deno.test("returns no steps for a message with no completed troubleshooting", () => {
  assertEquals(
    detectCompletedTroubleshooting("Hi, my headset keeps disconnecting. Please help."),
    [],
  );
});

Deno.test("returns no steps for empty / nullish input", () => {
  assertEquals(detectCompletedTroubleshooting(""), []);
  assertEquals(detectCompletedTroubleshooting(undefined as unknown as string), []);
});

Deno.test("block lists completed steps and forbids repeating them or equivalent variants", () => {
  const block = buildCompletedTroubleshootingBlock(
    detectCompletedTroubleshooting(A_BLAZE_FIRST_TURN),
  );
  assert(block, "expected a block when steps are present");
  assert(/already completed/i.test(block!));
  assert(/firmware/i.test(block!));
  assert(/driver/i.test(block!));
  assert(/factory reset/i.test(block!));
  // Must forbid repeating AND equivalent variants (e.g. another dongle-driver flow).
  assert(/do not repeat/i.test(block!));
  assert(/equivalent/i.test(block!));
});

Deno.test("block asks for the order number FIRST when troubleshooting is exhausted", () => {
  const block = buildCompletedTroubleshootingBlock(["completed a factory reset"]);
  assert(block);
  const orderIdx = block!.search(/order number/i);
  const proofIdx = block!.search(/proof of purchase/i);
  assert(orderIdx >= 0, "expected an order-number ask");
  assert(proofIdx >= 0, "expected a proof-of-purchase fallback");
  assert(orderIdx < proofIdx, "order number must be requested before proof of purchase");
});

Deno.test("block forbids additional unrelated steps and unverified promises", () => {
  const block = buildCompletedTroubleshootingBlock(["completed a factory reset"])!;
  assert(/do not propose additional/i.test(block));
  assert(/warranty|replacement|refund|approval/i.test(block));
});

Deno.test("block is null when no steps were completed", () => {
  assertEquals(buildCompletedTroubleshootingBlock([]), null);
});

Deno.test("block has no shop/product hardcoding", () => {
  const block = buildCompletedTroubleshootingBlock(["completed a factory reset"])!
    .toLowerCase();
  for (const term of ["acezone", "a-spire", "a-blaze", "aspire", "shopify"]) {
    assert(!block.includes(term), `block must not hardcode "${term}"`);
  }
});
