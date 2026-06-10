import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  KNOWLEDGE_DOCS_TOOLBAR_ACTIONS,
  SECTION_HEADING_LEVEL,
  SECTION_HEADING_LABEL,
  SECTION_HEADING_TOOLTIP,
} from "../apps/web/lib/knowledge/knowledge-doc-editor-config.js";
import { roundTripKnowledgeDocumentMarkdown } from "../apps/web/lib/knowledge/knowledge-doc-markdown-roundtrip.js";

const editorSource = readFileSync(
  new URL("../apps/web/components/knowledge/KnowledgeDocsEditor.jsx", import.meta.url),
  "utf8",
);

test("toolbar exposes one section heading action and no H1 or H3 controls", () => {
  assert.deepEqual(KNOWLEDGE_DOCS_TOOLBAR_ACTIONS, [
    "bold",
    "italic",
    "section_heading",
    "bullet_list",
    "ordered_list",
    "link",
  ]);
  assert.equal(KNOWLEDGE_DOCS_TOOLBAR_ACTIONS.includes("h1"), false);
  assert.equal(KNOWLEDGE_DOCS_TOOLBAR_ACTIONS.includes("h3"), false);
  assert.equal(KNOWLEDGE_DOCS_TOOLBAR_ACTIONS.includes("heading_1"), false);
  assert.equal(KNOWLEDGE_DOCS_TOOLBAR_ACTIONS.includes("heading_3"), false);
  assert.doesNotMatch(editorSource, /Heading1|Heading3/);
  assert.doesNotMatch(editorSource, /label="H1"|label="H3"/);
});

test("section heading action maps to Markdown H2", () => {
  assert.equal(SECTION_HEADING_LEVEL, 2);
  assert.equal(SECTION_HEADING_LABEL, "Section heading");
  assert.match(SECTION_HEADING_TOOLTIP, /focused AI knowledge section/);
  assert.doesNotMatch(SECTION_HEADING_TOOLTIP, /chunk/i);

  const output = roundTripKnowledgeDocumentMarkdown("## Refund processing\n\nRefunds take 5 business days.");
  assert.match(output, /^## Refund processing/m);
});

test("existing documents with an H1 still load without losing H2 boundaries", () => {
  const output = roundTripKnowledgeDocumentMarkdown(`# Returns & Refunds

## Return window

30 days.

## Internal guidance

Keep replies concise.`);

  assert.ok(output.includes("# Returns & Refunds"));
  assert.ok(output.includes("## Return window"));
  assert.ok(output.includes("## Internal guidance"));
  assert.ok(output.indexOf("## Return window") < output.indexOf("## Internal guidance"));
});
