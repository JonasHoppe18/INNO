import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { buildSendReadyNextStepStandardBlock } from "./writer.ts";

Deno.test("accessory replacement directive uses merchant knowledge for next step", () => {
  const block = buildSendReadyNextStepStandardBlock({
    latestCustomerMessage:
      "I lost the remote for my X200 chair. Can I buy a new one?",
    replyMode: "concise",
  }).toLowerCase();

  assertStringIncludes(block, "accessory/spare-part request");
  assertStringIncludes(block, "merchant knowledge");
  assertStringIncludes(block, "retrieved sources");
  assertStringIncludes(block, "shop configuration");
  assertStringIncludes(block, "determine the required next step");
  assertStringIncludes(block, "do not default to ordinary webshop");
  assert(!block.includes("lead with asking for the order number"));
});

Deno.test("Danish missing accessory directive uses neutral fallback when process is unspecified", () => {
  const block = buildSendReadyNextStepStandardBlock({
    latestCustomerMessage:
      "Mit tilbehør mangler til min model X200. Kan jeg købe et nyt?",
    replyMode: "concise",
  }).toLowerCase();

  assertStringIncludes(block, "accessory/spare-part request");
  assertStringIncludes(block, "merchant knowledge");
  assertStringIncludes(block, "ask one neutral clarification question");
  assertStringIncludes(block, "exact part/accessory needed");
  assertStringIncludes(block, "which product/model it is for");
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
  assertStringIncludes(block.toLowerCase(), "merchant knowledge");
});
