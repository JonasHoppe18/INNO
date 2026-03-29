import { assertEquals } from "jsr:@std/assert@1";

import { resolveReturnMissingDetails } from "./return-missing-guard.ts";

Deno.test("resolveReturnMissingDetails removes order/name when selected order is known", () => {
  const result = resolveReturnMissingDetails({
    missingDetails: ["order_number", "customer_name", "return_reason"],
    selectedOrder: { id: 12345 },
  });

  assertEquals(result.effectiveMissingDetails, ["return_reason"]);
  assertEquals(result.knownOrderNumber, true);
  assertEquals(result.knownCustomerName, false);
});

Deno.test("resolveReturnMissingDetails removes customer_name when first name is known", () => {
  const result = resolveReturnMissingDetails({
    missingDetails: ["customer_name", "return_reason"],
    customerFirstName: "An",
  });

  assertEquals(result.effectiveMissingDetails, ["return_reason"]);
  assertEquals(result.knownCustomerName, true);
});

Deno.test("resolveReturnMissingDetails can infer order/name from prior customer messages only", () => {
  const result = resolveReturnMissingDetails({
    missingDetails: ["order_number", "customer_name"],
    threadHistory: [
      {
        role: "support",
        text: "Hi An, please share your details.",
      },
      {
        role: "customer",
        text: "Thanks.\nName: An Tran\nOrder number: #778812",
      },
    ],
  });

  assertEquals(result.effectiveMissingDetails, ["order_number"]);
  assertEquals(result.knownOrderNumber, false);
  assertEquals(result.knownCustomerName, true);
  assertEquals(result.historyProvidedOrderNumber, true);
  assertEquals(result.historyProvidedCustomerName, true);
});

Deno.test("resolveReturnMissingDetails does not treat contact-form labels as order number", () => {
  const result = resolveReturnMissingDetails({
    missingDetails: ["order_number", "customer_name"],
    threadHistory: [
      {
        role: "customer",
        text:
          "If Applicable, Place Of Purchase And Order Number:\n\nWhat Is Your Request Regarding?:\nA-Spire\n\nName:\nAn",
      },
    ],
  });

  assertEquals(result.knownOrderNumber, false);
  assertEquals(result.historyProvidedOrderNumber, false);
  assertEquals(result.knownCustomerName, true);
  assertEquals(result.effectiveMissingDetails, ["order_number"]);
});
