import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../apps/web/components/knowledge/KnowledgeCategoryDetail.jsx", import.meta.url),
  "utf8",
);

test("General knowledge category renders document editor and keeps snippets", () => {
  assert.match(source, /categorySlug === "general"/);
  assert.match(source, /hasGeneralDocument && \(/);
  assert.match(source, /<KnowledgeDocumentEditorCard/);
  assert.match(source, /category="general"/);
  assert.match(source, /documentType="general"/);
  assert.match(source, /title="General Knowledge"/);
  assert.match(source, /<SnippetList/);
  assert.doesNotMatch(source, /categorySlug === "general" && false/);
});
