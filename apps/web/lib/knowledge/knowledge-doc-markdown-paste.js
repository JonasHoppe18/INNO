import { parseKnowledgeDocumentMarkdown } from "./knowledge-doc-markdown-roundtrip.js";

const STRUCTURED_MARKDOWN_PATTERNS = [
  /^ {0,3}#{1,3}\s+\S/m,
  /^ {0,3}\d+[.)]\s+\S/m,
  /^ {0,3}[-*+]\s+\S/m,
  /\[[^\]\n]+\]\(https?:\/\/[^)\s]+[^)]*\)/,
  /(^|[^\w])\*\*[^*\n][\s\S]*?[^*\n]\*\*($|[^\w])/,
  /(^|[^\w])\*[^*\n][^*\n]*[^*\n]\*($|[^\w])/,
];

function hasHtmlTag(text) {
  return /<\/?[a-z][\s\S]*>/i.test(text);
}

export function isLikelyStructuredMarkdownPaste(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  if (hasHtmlTag(value)) return false;
  return STRUCTURED_MARKDOWN_PATTERNS.some((pattern) => pattern.test(value));
}

export function parseKnowledgeDocumentMarkdownPaste(text) {
  if (!isLikelyStructuredMarkdownPaste(text)) return null;
  const parsed = parseKnowledgeDocumentMarkdown(text);
  if (!parsed || parsed.type !== "doc" || !Array.isArray(parsed.content)) {
    return null;
  }
  return parsed.content.length > 0 ? parsed.content : null;
}
