import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const categoryDetail = read(
  "apps/web/components/knowledge/KnowledgeCategoryDetail.jsx",
);
const productDetail = read(
  "apps/web/components/knowledge/KnowledgeProductDetail.jsx",
);
const documentCard = read(
  "apps/web/components/knowledge/KnowledgeDocumentEditorCard.jsx",
);
const documentEditor = read(
  "apps/web/components/knowledge/KnowledgeDocsEditor.jsx",
);

test("knowledge detail pages no longer expose the legacy snippet flow", () => {
  assert.doesNotMatch(categoryDetail, /api\/knowledge\/snippets/);
  assert.doesNotMatch(categoryDetail, /Add snippet/);
  assert.doesNotMatch(categoryDetail, /SnippetEditor/);
  assert.doesNotMatch(categoryDetail, /legacy snippets/i);
  assert.doesNotMatch(productDetail, /SnippetTwoPanel/);
  assert.doesNotMatch(productDetail, /legacy snippets/i);
});

test("knowledge document editing uses one calm editor surface", () => {
  assert.match(documentCard, /<section className="flex flex-col gap-5"/);
  assert.match(documentCard, /<Badge variant="secondary"/);
  assert.doesNotMatch(documentCard, /rounded-xl border bg-card overflow-hidden/);
  assert.match(documentEditor, /rounded-xl border bg-card/);
  assert.doesNotMatch(documentEditor, /shadow-sm/);
  assert.doesNotMatch(documentEditor, /ProseMirror_h2.*border-b/);
});
