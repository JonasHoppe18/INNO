import { assertEquals } from "jsr:@std/assert";
import {
  filterSoftDisabledRows,
  isKnowledgeRowSoftDisabled,
} from "./knowledge-flags.ts";

Deno.test("active by default when no flags present", () => {
  assertEquals(isKnowledgeRowSoftDisabled({}), false);
  assertEquals(isKnowledgeRowSoftDisabled(null), false);
  assertEquals(isKnowledgeRowSoftDisabled(undefined), false);
  assertEquals(isKnowledgeRowSoftDisabled({ category: "returns" }), false);
});

Deno.test("archived hides the row (string or boolean)", () => {
  assertEquals(isKnowledgeRowSoftDisabled({ archived: "true" }), true);
  assertEquals(isKnowledgeRowSoftDisabled({ archived: true }), true);
  assertEquals(isKnowledgeRowSoftDisabled({ archived: "false" }), false);
  assertEquals(isKnowledgeRowSoftDisabled({ archived: false }), false);
});

Deno.test("disabled_for_ai hides the row", () => {
  assertEquals(isKnowledgeRowSoftDisabled({ disabled_for_ai: "true" }), true);
  assertEquals(isKnowledgeRowSoftDisabled({ disabled_for_ai: true }), true);
  assertEquals(isKnowledgeRowSoftDisabled({ disabled_for_ai: false }), false);
});

Deno.test("active_for_ai=false hides the row, true/missing keeps it", () => {
  assertEquals(isKnowledgeRowSoftDisabled({ active_for_ai: "false" }), true);
  assertEquals(isKnowledgeRowSoftDisabled({ active_for_ai: false }), true);
  assertEquals(isKnowledgeRowSoftDisabled({ active_for_ai: "true" }), false);
  assertEquals(isKnowledgeRowSoftDisabled({ active_for_ai: true }), false);
});

Deno.test("preview canonical doc chunk (active_for_ai=false) is hidden", () => {
  const previewDocChunk = {
    environment: "preview",
    active_for_ai: false,
    curated_document: true,
    category: "returns",
  };
  assertEquals(isKnowledgeRowSoftDisabled(previewDocChunk), true);
});

Deno.test("promoted canonical doc chunk (active_for_ai=true) is visible", () => {
  const liveDocChunk = {
    environment: "production",
    active_for_ai: true,
    curated_document: true,
    category: "returns",
  };
  assertEquals(isKnowledgeRowSoftDisabled(liveDocChunk), false);
});

Deno.test("filterSoftDisabledRows keeps only active rows", () => {
  const rows = [
    { id: 1, metadata: {} },
    { id: 2, metadata: { archived: "true" } },
    { id: 3, metadata: { active_for_ai: false } },
    { id: 4, metadata: { disabled_for_ai: true } },
    { id: 5, metadata: { active_for_ai: true } },
  ];
  assertEquals(filterSoftDisabledRows(rows).map((r) => r.id), [1, 5]);
});
