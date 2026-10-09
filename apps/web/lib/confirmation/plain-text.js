const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, code) => (code === "39" ? "'" : String.fromCodePoint(Number(code))))
    .replace(/&([a-z]+|#39);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match);
}

// Plain-text version of a designed email: one paragraph per block, links kept as
// "text (url)", hidden preview text and markup dropped.
export function htmlToPlainText(html) {
  const text = String(html || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(head|style|script|title)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<div\b[^>]*style="[^"]*display:\s*none[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_match, href, label) => {
      const labelText = label.replace(/<[^>]+>/g, "");
      return href && !href.startsWith("#") && decodeEntities(labelText).trim() !== decodeEntities(href)
        ? `${labelText} (${href})`
        : labelText;
    })
    .replace(/<br\s*\/?>/gi, "\u0001")
    .replace(/<\/?(p|div|h[1-6]|tr|table|li|ul|ol|blockquote)\b[^>]*>/gi, "\u0002")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .split("\u0002")
    .map((block) =>
      block
        .split("\u0001")
        .map((line) => line.replace(/\s+/g, " ").trim())
        .join("\n")
        .trim(),
    )
    .filter(Boolean)
    .join("\n\n");
}
