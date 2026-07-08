import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  detectCustomerProvidedReturnTracking,
  extractCustomerProvidedTrackingNumbers,
} from "./return-tracking-attribution.ts";

Deno.test("extracts customer-provided tracking numbers from latest message", () => {
  assertEquals(
    extractCustomerProvidedTrackingNumbers(
      "The USPS tracking number is 9588871095290073926950",
    ),
    ["9588871095290073926950"],
  );
});

Deno.test("return/refund thread tracking is attributed as customer return tracking", () => {
  const result = detectCustomerProvidedReturnTracking({
    latestCustomerMessage: "The USPS tracking number is 9588871095290073926950",
    conversationHistory: [
      { role: "customer", text: "Looking to get a refund for my recent purchase." },
      { role: "customer", text: "I am still going to go through with the refund." },
      {
        role: "agent",
        text: "Quoted prior support reply:\nPlease choose a trackable service and send the return to us.",
      },
    ],
    plan: {
      primary_intent: "tracking",
      required_facts: ["order_state", "tracking"],
    },
  });

  assertEquals(result?.kind, "customer_provided_return_tracking");
  assertEquals(result?.tracking_numbers, ["9588871095290073926950"]);
  assertStringIncludes(result?.blockText ?? "", "return-shipment tracking");
  assertStringIncludes(result?.blockText ?? "", "not outbound order tracking");
  assertStringIncludes(result?.blockText ?? "", "Do not call this the tracking number for the order");
});

Deno.test("ordinary outbound tracking request is unchanged", () => {
  const result = detectCustomerProvidedReturnTracking({
    latestCustomerMessage: "Can you send me the tracking link for my order?",
    conversationHistory: [
      { role: "customer", text: "My order number is 4478." },
    ],
    plan: {
      primary_intent: "tracking",
      required_facts: ["order_state", "tracking"],
    },
  });

  assertEquals(result, null);
});

Deno.test("tracking URL guidance forbids mismatched outbound links", () => {
  const result = detectCustomerProvidedReturnTracking({
    latestCustomerMessage: "The tracking number is 9588871095290073926950",
    conversationHistory: [
      { role: "customer", text: "I want to return it for a refund." },
    ],
    plan: null,
  });

  assertStringIncludes(result?.blockText ?? "", "contains exactly the customer-provided tracking number");
  assertStringIncludes(result?.blockText ?? "", "omit the URL when uncertain");
});

Deno.test("customer-provided return tracking block enforces safe employee-ready structure", () => {
  const block = detectCustomerProvidedReturnTracking({
    latestCustomerMessage:
      "I returned my order #4478. The USPS tracking number is 9588871095290073926950. When will I get my refund?",
    conversationHistory: [{ role: "customer", text: "I want my refund." }],
    plan: { primary_intent: "refund", required_facts: ["order_state"] },
  })?.blockText ?? "";

  // Required safe content
  assertStringIncludes(block, "plain employee wording");
  assertStringIncludes(block, "Do NOT write 'we have noted'");
  assertStringIncludes(block, "refund has not been issued/made yet");
  assertStringIncludes(block, "receipt of the return is not confirmed yet");
  assertStringIncludes(block, "Do NOT write 'registered with us'");
  assertStringIncludes(block, "customer-facing next step only");
  if (block.includes("cannot currently verify")) {
    throw new Error("Block should not force 'cannot currently verify carrier status' wording");
  }
  if (block.includes("Say the team can")) {
    throw new Error("Block must not instruct the writer to use team-handoff wording");
  }

  // Core forbidden phrases still appear as prohibitions, never as standalone
  // positive guidance.
  const lines = block.split("\n");
  const forbiddenLine = lines.find((l) => l.startsWith("FORBIDDEN")) ?? "";
  for (const phrase of [
    "we have noted",
    "registered with us",
    "confirm next steps",
    "manual review",
    "teamet kan",
    "the refund will be issued",
    "once processed",
    "keep an eye on the tracking",
    "you will be notified",
  ]) {
    assertStringIncludes(forbiddenLine, phrase);
    const elsewhere = lines
      .filter((l) => !l.startsWith("FORBIDDEN") && !l.includes("Do NOT write"))
      .join("\n");
    if (elsewhere.includes(phrase)) {
      throw new Error(`"${phrase}" leaked outside the FORBIDDEN line`);
    }
  }
});

Deno.test("return tracking block avoids carrier verification claims when carrier not named", () => {
  const block = detectCustomerProvidedReturnTracking({
    latestCustomerMessage: "I returned it. Tracking number is 9588871095290073926950. Refund?",
    conversationHistory: [{ role: "customer", text: "return for refund" }],
    plan: { primary_intent: "refund", required_facts: [] },
  })?.blockText ?? "";
  assertStringIncludes(block, "Do not present carrier status");
  assertStringIncludes(block, "unless verified facts explicitly support it");
});
