import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  buildKnowledgeSelectionDirective,
  buildLiveFactAuthorityBlock,
  buildSendReadyNextStepStandardBlock,
  hasConcreteShippingAddress,
} from "./writer.ts";

Deno.test("global authority block forbids invented backorder and tag updates", () => {
  const block = buildLiveFactAuthorityBlock().toLowerCase();
  assertStringIncludes(block, "backorder/venteliste");
  assertStringIncludes(block, "tilføjet et tag/en note");
  assertStringIncludes(block, "historiske svar");
  assertStringIncludes(block, "udført action-resultat");
});

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
  assertStringIncludes(block, "explains why the exact symptom happens");
  assertStringIncludes(block, "one short sentence before the steps");
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

Deno.test("address-change wording is not mistaken for a supplied new address", () => {
  for (
    const message of [
      "I need to change the shipping address for order 1234.",
      "Can you send it to another address?",
      "Jeg vil gerne ændre leveringsadressen.",
      "The postal code is wrong — can you update it?",
    ]
  ) {
    assertEquals(hasConcreteShippingAddress(message), false, message);
  }
});

Deno.test("recognises concrete international shipping-address formats", () => {
  for (
    const message of [
      "Please change it to 12 Main Street, 78701 Austin.",
      "Den nye adresse er Kystvejen 5, 8000 Aarhus.",
      "Adresse: Strandvejen 42\nPostnummer: 2900",
    ]
  ) {
    assertEquals(hasConcreteShippingAddress(message), true, message);
  }
});

Deno.test("multiple answer-bearing chunks require one latest-issue-specific guide", () => {
  const block = buildKnowledgeSelectionDirective([
    { usable_as: "policy", content: "General audio troubleshooting" },
    { usable_as: "procedure", content: "Dongle-specific driver steps" },
  ]).toLowerCase();

  assertStringIncludes(block, "seneste uløste problem");
  assertStringIncludes(block, "use this guide when");
  assertStringIncludes(block, "snævreste guide");
  assertStringIncludes(block, "bland ikke trin fra flere guider");
});

Deno.test("single answer-bearing chunk needs no selection directive", () => {
  assertEquals(
    buildKnowledgeSelectionDirective([
      { usable_as: "procedure", content: "One exact guide" },
      { usable_as: "background", content: "Non-authoritative context" },
    ]),
    "",
  );
});
