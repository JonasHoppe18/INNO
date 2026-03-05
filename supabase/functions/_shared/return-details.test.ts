import { assertEquals, assertMatch } from "jsr:@std/assert@1";

import {
  applyMatchedSubjectOrderNumber,
  extractReturnDetails,
  missingReturnDetails,
} from "./return-details.ts";

Deno.test("extractReturnDetails finds order number and reason", () => {
  const details = extractReturnDetails(
    "Return request",
    "Hi, I want to return Order #1050 because the fit is too small.",
  );

  assertEquals(details.order_number, "#1050");
  assertMatch(String(details.return_reason || ""), /fit is too small/i);
});

Deno.test("applyMatchedSubjectOrderNumber fills missing order number", () => {
  const details = extractReturnDetails(
    "Return request",
    "Hi, I want to return this item because it does not fit.",
  );
  const enriched = applyMatchedSubjectOrderNumber(details, "1050");
  assertEquals(enriched.order_number, "#1050");
});

Deno.test("missingReturnDetails does not require reason unless policy requires it", () => {
  const details = {
    order_number: "#1050",
    customer_name: "Jonas",
    return_reason: null,
  };
  assertEquals(missingReturnDetails(details, { requireReason: false }), []);
  assertEquals(missingReturnDetails(details, { requireReason: true }), ["return_reason"]);
});
