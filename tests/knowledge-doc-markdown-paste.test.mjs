import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isLikelyStructuredMarkdownPaste,
  parseKnowledgeDocumentMarkdownPaste,
} from "../apps/web/lib/knowledge/knowledge-doc-markdown-paste.js";
import {
  serializeKnowledgeDocumentMarkdown,
} from "../apps/web/lib/knowledge/knowledge-doc-markdown-roundtrip.js";

function asDocument(content) {
  return { type: "doc", content };
}

function serializedPaste(markdown) {
  const parsed = parseKnowledgeDocumentMarkdownPaste(markdown);
  assert.ok(parsed, "expected markdown paste to parse");
  return serializeKnowledgeDocumentMarkdown(asDocument(parsed));
}

test("H2 markdown paste parses as a heading node", () => {
  const parsed = parseKnowledgeDocumentMarkdownPaste("## Return window\n\n30 days.");

  assert.equal(parsed?.[0]?.type, "heading");
  assert.equal(parsed?.[0]?.attrs?.level, 2);
  assert.match(serializedPaste("## Return window\n\n30 days."), /^## Return window/m);
});

test("ordered-list markdown paste keeps ordered list structure", () => {
  const parsed = parseKnowledgeDocumentMarkdownPaste(`1. Turn the headset on.
2. Connect the headset with USB-C.
3. Run the updater.`);

  assert.equal(parsed?.[0]?.type, "orderedList");
  assert.equal(parsed?.[0]?.content?.length, 3);
  const output = serializeKnowledgeDocumentMarkdown(asDocument(parsed));
  assert.match(output, /1\. Turn the headset on\./);
  assert.match(output, /2\. Connect the headset with USB-C\./);
  assert.match(output, /3\. Run the updater\./);
});

test("bullet-list markdown paste keeps bullet list structure", () => {
  const parsed = parseKnowledgeDocumentMarkdownPaste(`- cracking audio
- unstable sound
- repeated disconnects`);

  assert.equal(parsed?.[0]?.type, "bulletList");
  assert.equal(parsed?.[0]?.content?.length, 3);
  const output = serializeKnowledgeDocumentMarkdown(asDocument(parsed));
  assert.match(output, /- cracking audio/);
  assert.match(output, /- unstable sound/);
  assert.match(output, /- repeated disconnects/);
});

test("mixed markdown document paste preserves headings, paragraphs, and lists", () => {
  const sample = `## Firmware update for audio cracking or repeated disconnects

Use this guide when the customer experiences cracking audio, unstable sound or repeated disconnects while using the headset.

Update both the headset and the dongle:

1. Turn the headset on.
2. Make sure the headset is not connected to any Bluetooth device.
3. Disconnect the USB-C dongle from the computer.
4. Connect the headset to the computer using the USB-C cable.

Use this guide when the customer experiences:

- cracking audio
- unstable sound
- repeated disconnects`;

  const parsed = parseKnowledgeDocumentMarkdownPaste(sample);
  assert.deepEqual(parsed?.map((node) => node.type), [
    "heading",
    "paragraph",
    "paragraph",
    "orderedList",
    "paragraph",
    "bulletList",
  ]);
  assert.equal(parsed?.filter((node) => node.type === "heading" && node.attrs?.level === 2).length, 1);
  assert.equal(parsed?.filter((node) => node.type === "orderedList").length, 1);
  assert.equal(parsed?.filter((node) => node.type === "bulletList").length, 1);
  assert.equal(parsed?.[3]?.content?.length, 4);
  assert.ok(parsed?.[3]?.content?.every((node) => node.type === "listItem"));
  assert.equal(parsed?.[5]?.content?.length, 3);
  assert.ok(parsed?.[5]?.content?.every((node) => node.type === "listItem"));

  const output = serializeKnowledgeDocumentMarkdown(asDocument(parsed));
  assert.match(output, /^## Firmware update for audio cracking or repeated disconnects/m);
  assert.match(output, /1\. Turn the headset on\./);
  assert.match(output, /4\. Connect the headset to the computer using the USB-C cable\./);
  assert.match(output, /- repeated disconnects/);
});

test("ordinary prose paste remains ordinary prose", () => {
  const text = "The firmware version is stable and the update takes around ten minutes.";

  assert.equal(isLikelyStructuredMarkdownPaste(text), false);
  assert.equal(parseKnowledgeDocumentMarkdownPaste(text), null);
});

test("version numbers and numbered prose do not trigger markdown parsing", () => {
  const text = "The firmware version is 1.2.3 and the update takes around 10 minutes.";

  assert.equal(isLikelyStructuredMarkdownPaste(text), false);
  assert.equal(parseKnowledgeDocumentMarkdownPaste(text), null);
});

test("links and inline formatting remain safe markdown", () => {
  const output = serializedPaste("Read [the update guide](https://example.com/update) before using **firmware mode**.");

  assert.match(output, /\\?\[the update guide\]\(https:\/\/example\.com\/update\)/);
  assert.match(output, /\*\*firmware mode\*\*/);
});

test("script and html text is not parsed as executable html", () => {
  const text = `## Safe heading

<script>alert("x")</script>`;

  assert.equal(isLikelyStructuredMarkdownPaste(text), false);
  assert.equal(parseKnowledgeDocumentMarkdownPaste(text), null);
});

test("save and reload round-trip preserves pasted list boundaries", () => {
  const pasted = parseKnowledgeDocumentMarkdownPaste(`## Setup

1. First step
2. Second step

- Note one
- Note two`);
  const saved = serializeKnowledgeDocumentMarkdown(asDocument(pasted));
  const reloaded = parseKnowledgeDocumentMarkdownPaste(saved);

  assert.equal(reloaded?.[0]?.type, "heading");
  assert.equal(reloaded?.[1]?.type, "orderedList");
  assert.equal(reloaded?.[2]?.type, "bulletList");
});

test("shared editor wires markdown-aware paste without category-specific logic", () => {
  const editorSource = readFileSync(
    new URL("../apps/web/components/knowledge/KnowledgeDocsEditor.jsx", import.meta.url),
    "utf8",
  );

  assert.match(editorSource, /handlePaste/);
  assert.match(editorSource, /parseKnowledgeDocumentMarkdownPaste/);
  assert.match(editorSource, /event\.preventDefault\(\)/);
  assert.match(editorSource, /list-decimal/);
  assert.match(editorSource, /list-disc/);
  assert.doesNotMatch(editorSource, /Returns & Refunds|Product Support|AceZone/);
});
