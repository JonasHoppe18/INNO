import sanitizeHtml from "sanitize-html";
import { decodeHTML } from "entities";
import { resolveInlineCidImages, sanitizeEmailHtml } from "./email-html.js";

const isHidden = ({ attribs = {} }) =>
  "hidden" in attribs || attribs["aria-hidden"] === "true" ||
  /(?:display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all)/i.test(attribs.style || "");

export function emailHtmlToText(html = "") {
  const visible = sanitizeHtml(String(html).replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, ""), {
    allowedTags: ["p", "div", "br", "li", "tr", "h1", "h2", "h3", "td"],
    allowedAttributes: { "*": ["style", "hidden", "aria-hidden"] },
    exclusiveFilter: isHidden,
    parseStyleAttributes: false,
  });
  return decodeHTML(visible
    .replace(/<\/?(?:p|div|br|li|tr|h[1-3])\b[^>]*>/gi, "\n")
    .replace(/<\/?td\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, ""))
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

// Old HTML-only messages can have CSS in their persisted text fallback.
export function readableEmailText(text = "", html = "") {
  const raw = String(text || "");
  const polluted = /\{[^{}]*(?:margin|padding|font-size|line-height|display|color)\s*:/i.test(raw);
  return html && (!raw.trim() || polluted) ? emailHtmlToText(html) : raw;
}

const attributes = {
  "*": ["style", "align", "valign", "dir", "lang", "hidden", "aria-hidden"],
  a: ["href", "target", "rel", "title"],
  img: ["src", "alt", "width", "height", "loading", "data-signature-image"],
  table: ["width", "cellpadding", "cellspacing", "border", "role"],
  td: ["width", "height", "colspan", "rowspan"],
  th: ["width", "colspan", "rowspan"],
};
const safeStyles = {
  "*": {
    "text-align": [/^(?:left|right|center|justify)$/],
    "vertical-align": [/^(?:top|middle|bottom|baseline)$/],
    "font-weight": [/^(?:normal|bold|[1-9]00)$/],
    "font-style": [/^(?:normal|italic)$/],
    "text-decoration": [/^(?:none|underline|line-through)$/],
    "color": [/^(?:#[\da-f]{3,8}|[a-z]+|rgba?\([\d\s,.%]+\))$/i],
    "background-color": [/^(?:#[\da-f]{3,8}|[a-z]+|rgba?\([\d\s,.%]+\))$/i],
    "border-radius": [/^[\d.]+(?:px|%)$/],
    "padding": [/^[\d.]+(?:px|em|rem)(?:\s+[\d.]+(?:px|em|rem)){0,3}$/],
    "width": [/^(?:auto|[\d.]+(?:px|%))$/],
    "height": [/^(?:auto|[\d.]+px)$/],
    "max-width": [/^[\d.]+(?:px|%)$/],
    "max-height": [/^(?:none|[\d.]+px)$/],
    "display": [/^(?:none|block|inline|inline-block)$/],
  },
};

export function sanitizeConversationHtml(html, attachments = []) {
  return sanitizeHtml(sanitizeEmailHtml(html, attachments, { preserveInlineStyles: true }), {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, "img"],
    allowedAttributes: attributes,
    allowedStyles: safeStyles,
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https", "data"] },
    allowProtocolRelative: false,
    exclusiveFilter: isHidden,
    transformTags: { a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }) },
  });
}

export function buildEmailDocument(html, attachments = []) {
  if (!String(html || "").trim()) return "";
  const resolved = resolveInlineCidImages(String(html || ""), attachments)
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, "");
  const body = sanitizeHtml(resolved, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, "img", "style"],
    allowedAttributes: { ...attributes, "*": [...attributes["*"], "class", "id"], img: [...attributes.img] },
    allowVulnerableTags: true,
    parseStyleAttributes: false,
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https", "data"] },
    allowProtocolRelative: false,
    transformTags: { a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }) },
  });
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src https: http: data:; font-src 'none'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;background:white;color:#222;font:14px/1.5 Arial,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}</style></head><body>${body}</body></html>`;
}
