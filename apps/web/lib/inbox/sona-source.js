const SOURCE_TYPES = {
  manual_text: "Knowledge article",
  knowledge_document: "Knowledge article",
  shopify_policy: "Shopify policy",
  shopify_page: "Shopify page",
  shopify_product: "Product information",
  saved_reply: "Saved reply",
  zendesk_article: "Help center article",
};

function normalizedPrefix(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export function describeKnowledgeSource(source = {}) {
  const rawTitle = String(source?.title || "").trim();
  const prefixedTitle = rawTitle.match(/^([a-z0-9_-]+)\s*:\s*(.+)$/i);
  const prefix = normalizedPrefix(prefixedTitle?.[1]);
  const kind = normalizedPrefix(source?.kind);
  const title = prefixedTitle && SOURCE_TYPES[prefix]
    ? prefixedTitle[2].trim()
    : rawTitle || "Untitled knowledge";

  return {
    title,
    typeLabel: SOURCE_TYPES[prefix] || SOURCE_TYPES[kind] || "Knowledge source",
  };
}

export function describeKnowledgeContent(content = "") {
  const text = String(content || "").trim();
  const structured = text.match(/^Question:\s*([\s\S]*?)\s*Answer:\s*([\s\S]+)$/i);
  if (!structured) {
    return { question: null, answer: null, body: text, preview: text };
  }

  const question = structured[1].trim();
  const answer = structured[2].trim();
  return {
    question,
    answer,
    body: text,
    preview: answer ? `Answer: ${answer}` : question,
  };
}

export function formatOrderNumber(value) {
  const number = String(value || "").trim().replace(/^#+\s*/, "");
  return number ? `#${number}` : "";
}
