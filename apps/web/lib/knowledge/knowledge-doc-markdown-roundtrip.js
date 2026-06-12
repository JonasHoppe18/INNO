import StarterKit from "@tiptap/starter-kit";
import { MarkdownManager } from "@tiptap/markdown";

const markdownManager = new MarkdownManager({
  extensions: [
    StarterKit.configure({
      heading: {
        levels: [1, 2, 3],
      },
      link: {
        openOnClick: false,
      },
    }),
  ],
});

export function parseKnowledgeDocumentMarkdown(markdown) {
  return markdownManager.parse(String(markdown || ""));
}

export function serializeKnowledgeDocumentMarkdown(content) {
  return normalizeKnowledgeDocumentMarkdown(markdownManager.serialize(content));
}

export function normalizeKnowledgeDocumentMarkdown(markdown) {
  return String(markdown || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function roundTripKnowledgeDocumentMarkdown(markdown) {
  const parsed = parseKnowledgeDocumentMarkdown(markdown);
  return serializeKnowledgeDocumentMarkdown(parsed);
}
