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
