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

Deno.test("customer-provided return tracking block enforces safe structure + names carrier", () => {
  const block = detectCustomerProvidedReturnTracking({
    latestCustomerMessage:
      "I returned my order #4478. The USPS tracking number is 9588871095290073926950. When will I get my refund?",
    conversationHistory: [{ role: "customer", text: "I want my refund." }],
    plan: { primary_intent: "refund", required_facts: ["order_state"] },
  })?.blockText ?? "";

  // Required safe content
  assertStringIncludes(block, "acknowledge we have received the number");
  assertStringIncludes(block, "a refund has NOT been issued yet");
  assertStringIncludes(block, "the USPS tracking status"); // names the customer's carrier
  assertStringIncludes(block, "cannot confirm whether the return package has arrived");
  assertStringIncludes(block, "processed internally");
  assertStringIncludes(block, "review/investigate the return status further");

  // The forbidden phrases appear ONLY on the FORBIDDEN line (as prohibitions),
  // never as standalone guidance.
  const lines = block.split("\n");
  const forbiddenLine = lines.find((l) => l.startsWith("FORBIDDEN")) ?? "";
  for (const phrase of ["the refund will be issued", "once processed", "keep an eye on the tracking", "you will be notified"]) {
    assertStringIncludes(forbiddenLine, phrase);
    // not present on any non-FORBIDDEN line
    const elsewhere = lines.filter((l) => !l.startsWith("FORBIDDEN")).join("\n");
    if (elsewhere.includes(phrase)) throw new Error(`"${phrase}" leaked outside the FORBIDDEN line`);
  }
});

Deno.test("return tracking block uses generic carrier wording when carrier not named", () => {
  const block = detectCustomerProvidedReturnTracking({
    latestCustomerMessage: "I returned it. Tracking number is 9588871095290073926950. Refund?",
    conversationHistory: [{ role: "customer", text: "return for refund" }],
    plan: { primary_intent: "refund", required_facts: [] },
  })?.blockText ?? "";
  assertStringIncludes(block, "the carrier tracking status");
});
