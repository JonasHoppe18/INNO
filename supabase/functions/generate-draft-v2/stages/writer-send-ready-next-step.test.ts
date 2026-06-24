import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { buildSendReadyNextStepStandardBlock } from "./writer.ts";

Deno.test("spare-part/lost dongle directive asks for order number or purchase context", () => {
  const block = buildSendReadyNextStepStandardBlock({
    latestCustomerMessage:
      "I lost my A-Spire Wireless dongle. Can I buy a new one?",
    replyMode: "concise",
  }).toLowerCase();

  assertStringIncludes(block, "accessory/spare-part request");
  assertStringIncludes(block, "order number or purchase context");
  assertStringIncludes(block, "identify the exact replacement part");
  assertStringIncludes(block, "correct compatible replacement part");
  assertStringIncludes(block, "do not answer only with a generic webshop");
  assertStringIncludes(block, "stock");
  assertStringIncludes(block, "availability");
});

Deno.test("technical procedure directive requires exact source values and no generic steps", () => {
  const block = buildSendReadyNextStepStandardBlock({
    latestCustomerMessage:
      "My A-Spire Wireless will not power on even while charging.",
    replyMode: "procedure",
  }).toLowerCase();

  assertStringIncludes(block, "technical procedures");
  assertStringIncludes(block, "preserve exact values");
  assertStringIncludes(block, "15 seconds");
  assertStringIncludes(block, "never change it to 10 seconds");
  assertStringIncludes(block, "do not add generic troubleshooting steps");
  assertStringIncludes(block, "retrieved source");
});

Deno.test("send-ready next-step block is empty for ordinary concise non-accessory replies", () => {
  const block = buildSendReadyNextStepStandardBlock({
    latestCustomerMessage: "Thanks for the update.",
    replyMode: "concise",
  });

  assertEquals(block, "");
});

Deno.test("lost accessory directive does not require procedure mode", () => {
  const block = buildSendReadyNextStepStandardBlock({
    latestCustomerMessage: "The cable is missing. I need a replacement.",
    replyMode: "concise",
  });

  assert(block.length > 0);
  assertStringIncludes(block.toLowerCase(), "order number or purchase context");
});
