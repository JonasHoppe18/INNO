import assert from "node:assert/strict";
import test from "node:test";

import { roundTripKnowledgeDocumentMarkdown } from "../apps/web/lib/knowledge/knowledge-doc-markdown-roundtrip.js";

function lines(markdown) {
  return roundTripKnowledgeDocumentMarkdown(markdown).split("\n");
}

test("headings round-trip as markdown heading levels in order", () => {
  assert.deepEqual(lines(`# Returns & Refunds

## Return window

30 days.

### Exceptions

Holiday periods may differ.`), [
    "# Returns & Refunds",
    "",
    "## Return window",
    "",
    "30 days.",
    "",
    "### Exceptions",
    "",
    "Holiday periods may differ.",
  ]);
});

test("paragraphs, bold, italic, and links are preserved", () => {
  const output = roundTripKnowledgeDocumentMarkdown(`## Return shipping

Customers **must** contact us before sending *opened* products.

Read [the portal](https://example.com/returns).`);

  assert.match(output, /Customers \*\*must\*\* contact us before sending \*opened\* products\./);
  assert.match(output, /Read \\?\[the portal\]\(https:\/\/example\.com\/returns\)\./);
});

test("bullet and ordered lists are preserved", () => {
  const output = roundTripKnowledgeDocumentMarkdown(`## Return checklist

- Pack the product
- Include order number

1. Receive return
2. Inspect product`);

  assert.match(output, /- Pack the product/);
  assert.match(output, /- Include order number/);
  assert.match(output, /1\. Receive return/);
  assert.match(output, /2\. Inspect product/);
});

test("empty H2 sections remain representable", () => {
  const output = roundTripKnowledgeDocumentMarkdown(`## Return window

## Return shipping

Customer pays return shipping.`);

  assert.match(output, /## Return window\n\n## Return shipping/);
});

test("loaded document serializes without losing H2 section boundaries", () => {
  const output = roundTripKnowledgeDocumentMarkdown(`# Returns & Refunds

## Return window

30 days.

## Default return address

AceZone International ApS
Øster Allé 56, 5th floor`);

  assert.ok(output.includes("# Returns & Refunds"));
  assert.ok(output.includes("## Return window"));
  assert.ok(output.includes("## Default return address"));
  assert.ok(output.indexOf("## Return window") < output.indexOf("## Default return address"));
});
