import { assertEquals } from "jsr:@std/assert";
import { parseIssueMetadataResponse } from "./generateIssueMetadata.ts";

Deno.test("parseIssueMetadataResponse — extracts valid fields", () => {
  const validProductIds = new Set(["prod-abc", "prod-xyz"]);
  const result = parseIssueMetadataResponse(
    JSON.stringify({
      issue_summary: "Customer reports a broken zipper on their bag.",
      detected_product_id: "prod-abc",
    }),
    validProductIds,
  );
  assertEquals(result.issue_summary, "Customer reports a broken zipper on their bag.");
  assertEquals(result.detected_product_id, "prod-abc");
});

Deno.test("parseIssueMetadataResponse — rejects product id not in list", () => {
  const validProductIds = new Set(["prod-abc"]);
  const result = parseIssueMetadataResponse(
    JSON.stringify({ issue_summary: "Some issue.", detected_product_id: "prod-unknown" }),
    validProductIds,
  );
  assertEquals(result.detected_product_id, null);
});

Deno.test("parseIssueMetadataResponse — handles invalid JSON gracefully", () => {
  const result = parseIssueMetadataResponse("not json", new Set());
  assertEquals(result.issue_summary, null);
  assertEquals(result.detected_product_id, null);
});

Deno.test("parseIssueMetadataResponse — trims and caps issue_summary at 500 chars", () => {
  const longText = "x".repeat(600);
  const result = parseIssueMetadataResponse(
    JSON.stringify({ issue_summary: longText, detected_product_id: null }),
    new Set(),
  );
  assertEquals(result.issue_summary?.length, 500);
});
