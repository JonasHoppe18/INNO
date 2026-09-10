import { createHash, randomBytes } from "node:crypto";
import {
  CSAT_EMAIL_TEMPLATE_VERSION,
  CSAT_SAMPLE_DATA,
  CSAT_VARIABLE_VALUES,
  createDefaultCsatEmailContent,
  getCsatGroup,
  getCsatRatingFields,
  normalizeHexColor,
} from "@/lib/csat/email-template";

const ALLOWED_BLOCK_TYPES = new Set([
  "section",
  "title",
  "paragraph",
  "image",
  "button",
  "divider",
  "spacer",
  "custom",
]);
const ALLOWED_CUSTOM_BLOCK_TYPES = new Set(["csat-rating"]);
const URL_TOKEN_PATTERN = /^{{\s*([a-z0-9_.]+)\s*}}$/i;
const VARIABLE_PATTERN = /{{\s*([a-z0-9_.]+)\s*}}/gi;
const DANGEROUS_MARKUP_PATTERN = /<\/?\s*(script|iframe|object|embed|form|input|textarea|select|button|svg|style|meta|link)\b/i;
const DANGEROUS_RENDERED_MARKUP_PATTERN = /<\/?\s*(script|iframe|object|embed|form|input|textarea|select|button|svg)\b/i;
const DANGEROUS_URL_PATTERN = /(?:javascript|vbscript|data):/i;

export const DEFAULT_THANK_YOU_MESSAGES = {
  negative: {
    heading: "Thank you for your honest feedback",
    body: "We’re sorry your experience did not meet expectations. Your feedback has been shared with our team.",
    button_text: "Contact support",
    button_url: "",
  },
  neutral: {
    heading: "Thank you for your feedback",
    body: "We appreciate you taking a moment to tell us how we did.",
    button_text: "",
    button_url: "",
  },
  positive: {
    heading: "Thank you for the kind words",
    body: "We’re glad we could help. Your feedback means a lot to our team.",
    button_text: "Visit our store",
    button_url: "",
  },
};

export class CsatTemplateValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "CsatTemplateValidationError";
  }
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeText(value, maxLength = 2000) {
  const text = String(value ?? "").slice(0, maxLength);
  if (DANGEROUS_MARKUP_PATTERN.test(text) || DANGEROUS_URL_PATTERN.test(text)) {
    throw new CsatTemplateValidationError("Email content contains unsupported markup or URL content.");
  }
  return text;
}

function safeRichText(value, maxLength = 12000) {
  const html = String(value ?? "").slice(0, maxLength);
  if (DANGEROUS_MARKUP_PATTERN.test(html) || DANGEROUS_URL_PATTERN.test(html)) {
    throw new CsatTemplateValidationError("Rich text contains unsupported markup or URL content.");
  }
  if (/\s+on[a-z]+\s*=/i.test(html)) {
    throw new CsatTemplateValidationError("Rich text event handlers are not allowed.");
  }
  return html;
}

function safeHex(value, fallback = "") {
  return value ? normalizeHexColor(value, fallback) : fallback;
}

function normalizePadding(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    top: clampNumber(source.top, 0, 200, 0),
    right: clampNumber(source.right, 0, 200, 0),
    bottom: clampNumber(source.bottom, 0, 200, 0),
    left: clampNumber(source.left, 0, 200, 0),
  };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function normalizeStyles(styles) {
  const source = styles && typeof styles === "object" ? styles : {};
  return {
    padding: normalizePadding(source.padding),
    ...(source.backgroundColor
      ? { backgroundColor: safeHex(source.backgroundColor, "#ffffff") }
      : {}),
  };
}

function validateVariableTokens(value) {
  const tokens = [];
  String(value ?? "").replace(VARIABLE_PATTERN, (_match, path) => {
    const normalized = String(path || "").toLowerCase();
    if (!CSAT_VARIABLE_VALUES.includes(normalized)) {
      throw new CsatTemplateValidationError(`Unknown email variable: ${normalized}`);
    }
    tokens.push(normalized);
    return _match;
  });
  return tokens;
}

function assertSafeUrlTemplate(value, { allowHash = false } = {}) {
  const candidate = String(value ?? "").trim();
  if (!candidate) return "";
  if (DANGEROUS_URL_PATTERN.test(candidate)) {
    throw new CsatTemplateValidationError("JavaScript and data URLs are not allowed in email links.");
  }
  const matches = [...candidate.matchAll(/{{\s*([a-z0-9_.]+)\s*}}/gi)];
  for (const match of matches) {
    if (!CSAT_VARIABLE_VALUES.includes(String(match[1]).toLowerCase())) {
      throw new CsatTemplateValidationError(`Unknown URL variable: ${match[1]}`);
    }
  }
  const withoutTokens = candidate.replace(/{{\s*[a-z0-9_.]+\s*}}/gi, "sample");
  if (allowHash && withoutTokens.startsWith("#")) return candidate.slice(0, 4000);
  try {
    const url = new URL(withoutTokens);
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) {
      throw new Error("unsupported protocol");
    }
  } catch {
    throw new CsatTemplateValidationError("Links must use a valid http, https, or mailto URL.");
  }
  return candidate.slice(0, 4000);
}

function normalizeBlock(block, depth = 0) {
  if (!block || typeof block !== "object" || depth > 6) {
    throw new CsatTemplateValidationError("Invalid email block.");
  }
  const type = String(block.type || "");
  if (!ALLOWED_BLOCK_TYPES.has(type)) {
    throw new CsatTemplateValidationError(`The ${type || "unknown"} block is not allowed in CSAT emails.`);
  }
  const normalized = {
    id: safeText(block.id || randomBytes(8).toString("hex"), 100),
    type,
    styles: normalizeStyles(block.styles),
  };

  if (type === "section") {
    const columns = ["1", "2", "3", "2-1", "1-2"].includes(String(block.columns))
      ? String(block.columns)
      : "1";
    const children = Array.isArray(block.children) ? block.children : [];
    if (!children.length || children.length > 3) {
      throw new CsatTemplateValidationError("Sections must contain between one and three columns.");
    }
    normalized.columns = columns;
    normalized.stackOnMobile = block.stackOnMobile !== false;
    normalized.children = children.map((column) => {
      if (!Array.isArray(column) || column.length > 30) {
        throw new CsatTemplateValidationError("Email columns contain too many blocks.");
      }
      return column.map((child) => normalizeBlock(child, depth + 1));
    });
    return normalized;
  }

  if (type === "title") {
    normalized.content = safeText(block.content, 1000);
    normalized.level = [1, 2, 3, 4].includes(Number(block.level)) ? Number(block.level) : 2;
    normalized.textAlign = ["left", "center", "right"].includes(block.textAlign) ? block.textAlign : "left";
    if (block.color) normalized.color = safeHex(block.color, "#172033");
    return normalized;
  }

  if (type === "paragraph") {
    const content = safeRichText(block.content, 20000);
    validateVariableTokens(content);
    normalized.content = content;
    if (block.paragraphSpacing !== undefined) normalized.paragraphSpacing = clampNumber(block.paragraphSpacing, 0, 80, 8);
    return normalized;
  }

  if (type === "image") {
    normalized.src = assertSafeUrlTemplate(block.src);
    normalized.alt = safeText(block.alt, 300);
    normalized.width = block.width === "full" ? "full" : clampNumber(block.width, 1, 1200, 600);
    normalized.align = ["left", "center", "right"].includes(block.align) ? block.align : "center";
    if (block.height) normalized.height = clampNumber(block.height, 1, 1200, 0);
    if (block.linkUrl) normalized.linkUrl = assertSafeUrlTemplate(block.linkUrl);
    return normalized;
  }

  if (type === "button") {
    normalized.text = safeText(block.text, 300);
    validateVariableTokens(normalized.text);
    normalized.url = assertSafeUrlTemplate(block.url, { allowHash: true });
    normalized.backgroundColor = safeHex(block.backgroundColor, "#2563eb");
    normalized.textColor = safeHex(block.textColor, "#ffffff");
    normalized.borderRadius = clampNumber(block.borderRadius, 0, 40, 6);
    normalized.fontSize = clampNumber(block.fontSize, 10, 32, 14);
    normalized.align = ["left", "center", "right"].includes(block.align) ? block.align : "center";
    normalized.buttonPadding = normalizePadding(block.buttonPadding || { top: 12, right: 20, bottom: 12, left: 20 });
    return normalized;
  }

  if (type === "divider") {
    normalized.lineStyle = ["solid", "dashed", "dotted"].includes(block.lineStyle) ? block.lineStyle : "solid";
    normalized.color = safeHex(block.color, "#e5e7eb");
    normalized.thickness = clampNumber(block.thickness, 1, 8, 1);
    normalized.width = block.width === "full" ? "full" : clampNumber(block.width, 1, 1200, 600);
    return normalized;
  }

  if (type === "spacer") {
    normalized.height = clampNumber(block.height, 1, 240, 24);
    return normalized;
  }

  const customType = String(block.customType || "");
  if (!ALLOWED_CUSTOM_BLOCK_TYPES.has(customType)) {
    throw new CsatTemplateValidationError("This custom block is not allowed in CSAT emails.");
  }
  const fieldValues = block.fieldValues && typeof block.fieldValues === "object" ? block.fieldValues : {};
  normalized.customType = customType;
  normalized.fieldValues = getCsatRatingFields({
    ...fieldValues,
    question: safeText(fieldValues.question || "How was your experience?", 500),
  });
  return normalized;
}

export function normalizeCsatTemplateContent(content) {
  const source = content && typeof content === "object" ? content : createDefaultCsatEmailContent();
  const blocks = Array.isArray(source.blocks) ? source.blocks : [];
  if (blocks.length > 40) throw new CsatTemplateValidationError("CSAT emails can contain at most 40 sections.");
  const settings = source.settings && typeof source.settings === "object" ? source.settings : {};
  return {
    blocks: blocks.map((block) => normalizeBlock(block)),
    settings: {
      width: clampNumber(settings.width, 320, 800, 600),
      backgroundColor: safeHex(settings.backgroundColor, "#f3f4f6"),
      textColor: safeHex(settings.textColor, "#172033"),
      linkColor: settings.linkColor ? safeHex(settings.linkColor, "#2563eb") : undefined,
      linkUnderline: settings.linkUnderline !== false,
      fontFamily: safeText(settings.fontFamily || "Arial, sans-serif", 120),
      preheaderText: settings.preheaderText ? safeText(settings.preheaderText, 300) : undefined,
      locale: /^[a-z]{2}(?:-[A-Z]{2})?$/.test(String(settings.locale || "en")) ? String(settings.locale) : "en",
    },
  };
}

function getValueAtPath(data, path) {
  return String(path || "")
    .split(".")
    .reduce((value, key) => (value && typeof value === "object" ? value[key] : undefined), data);
}

export function replaceCsatVariables(value, data = CSAT_SAMPLE_DATA) {
  return String(value ?? "").replace(VARIABLE_PATTERN, (_match, path) => {
    const result = getValueAtPath(data, String(path).toLowerCase());
    return escapeHtml(result == null ? "" : result);
  });
}

function decorateContentForRender(content, { data, linkMode, token } = {}) {
  const normalized = normalizeCsatTemplateContent(content);
  const responseUrls = Object.fromEntries(
    [1, 2, 3, 4, 5].map((score) => [
      score,
      linkMode === "live"
        ? buildCsatResponseUrl(token, score)
        : linkMode === "markers"
          ? `[[SONA_CSAT_RATING_URL_${score}]]`
          : `#sona-csat-test-score-${score}`,
    ])
  );

  const decorate = (block) => {
    const next = { ...block };
    if (block.type === "section") {
      next.children = block.children.map((column) => column.map(decorate));
    } else if (block.type === "title") {
      next.content = replaceCsatVariables(block.content, data);
    } else if (block.type === "paragraph") {
      next.content = replaceCsatVariables(block.content, data);
    } else if (block.type === "image") {
      next.src = replaceCsatVariables(block.src, data);
      next.alt = replaceCsatVariables(block.alt, data);
      if (next.linkUrl) next.linkUrl = replaceCsatVariables(next.linkUrl, data);
    } else if (block.type === "button") {
      next.text = replaceCsatVariables(block.text, data);
      next.url = replaceCsatVariables(block.url, data);
    } else if (block.type === "custom" && block.customType === "csat-rating") {
      next.fieldValues = {
        ...getCsatRatingFields(block.fieldValues),
        question: replaceCsatVariables(block.fieldValues.question, data),
        ...Object.fromEntries(
          [1, 2, 3, 4, 5].map((score) => [`ratingUrl${score}`, responseUrls[score]])
        ),
      };
    }
    return next;
  };
  return { ...normalized, blocks: normalized.blocks.map(decorate) };
}

function renderCsatRatingHtml(fieldValues) {
  const fields = getCsatRatingFields(fieldValues);
  const labels = {
    emoji: ["😡", "🙁", "😐", "🙂", "😍"],
    numbers: ["1", "2", "3", "4", "5"],
    stars: ["★", "★", "★", "★", "★"],
  }[fields.ratingStyle];
  const links = labels
    .map((label, index) => {
      const score = index + 1;
      return `<td style="padding:0 4px"><a href="${escapeHtml(fields[`ratingUrl${score}`])}" style="display:inline-block;color:${escapeHtml(fields.ratingColor)};text-decoration:none;font-size:${escapeHtml(fields.size)};line-height:1">${label}</a></td>`;
    })
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="${fields.alignment}" style="text-align:${fields.alignment};font-family:Arial,sans-serif"><p style="margin:0 0 14px;color:${escapeHtml(fields.textColor)};font-size:18px;line-height:1.4;font-weight:600">${escapeHtml(fields.question)}</p><table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${fields.alignment}"><tr>${links}</tr></table></td></tr></table>`;
}

function toPlainText(html) {
  return String(html || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6]|li|table|section)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function assertSafeEmailHtml(html) {
  if (DANGEROUS_RENDERED_MARKUP_PATTERN.test(String(html || ""))) {
    throw new CsatTemplateValidationError("Rendered email contains unsupported markup.");
  }
  if (/\s+on[a-z]+\s*=/i.test(String(html || "")) || DANGEROUS_URL_PATTERN.test(String(html || ""))) {
    throw new CsatTemplateValidationError("Rendered email contains an unsafe attribute or URL.");
  }
  return html;
}

export async function renderCsatEmail({
  content,
  subject = "How was your support experience?",
  data = CSAT_SAMPLE_DATA,
  linkMode = "test",
  token = "",
} = {}) {
  if (linkMode === "live" && !token) {
    throw new CsatTemplateValidationError("A secure CSAT token is required for live rating links.");
  }
  const decorated = decorateContentForRender(content || createDefaultCsatEmailContent(), {
    data,
    linkMode,
    token,
  });
  const { renderToMjml } = await import("@templatical/renderer");
  const mjml = await renderToMjml(decorated, {
    allowHtmlBlocks: false,
    renderCustomBlock: async (block) => {
      if (block.customType !== "csat-rating") return "";
      return renderCsatRatingHtml(block.fieldValues);
    },
  });
  const mjmlModule = await import("mjml");
  const compileMjml = mjmlModule.default || mjmlModule;
  const compiled = await compileMjml(mjml, { validationLevel: "soft" });
  if (compiled.errors?.length) {
    throw new CsatTemplateValidationError(compiled.errors.map((error) => error.message).join(" "));
  }
  const html = assertSafeEmailHtml(compiled.html);
  return {
    subject: replaceCsatVariables(safeText(subject || "How was your support experience?", 300), data),
    mjml,
    html,
    text: toPlainText(html),
    content: decorated,
  };
}

export function normalizeThankYouMessages(value) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(
    ["negative", "neutral", "positive"].map((group) => {
      const current = source[group] && typeof source[group] === "object" ? source[group] : {};
      return [
        group,
        {
          heading: safeText(current.heading || DEFAULT_THANK_YOU_MESSAGES[group].heading, 180),
          body: safeText(current.body || DEFAULT_THANK_YOU_MESSAGES[group].body, 2000),
          button_text: safeText(current.button_text || "", 120),
          button_url: current.button_url ? assertSafeUrlTemplate(current.button_url) : "",
        },
      ];
    })
  );
}

export function hashCsatToken(token) {
  const value = String(token || "").trim();
  return value ? createHash("sha256").update(value).digest("hex") : "";
}

export function createCsatToken() {
  return randomBytes(32).toString("base64url");
}

export function isValidCsatScore(score) {
  return Number.isInteger(Number(score)) && Number(score) >= 1 && Number(score) <= 5;
}

export function buildCsatResponseUrl(token, score, baseUrl = null) {
  if (!token || !isValidCsatScore(score)) return "";
  const origin = String(
    baseUrl || process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "http://localhost:3000"
  ).replace(/\/$/, "");
  const url = new URL(`${origin}/csat/respond/${encodeURIComponent(token)}`);
  url.searchParams.set("score", String(Number(score)));
  return url.toString();
}

export function selectThankYouMessage(messages, score) {
  const group = getCsatGroup(score);
  return group ? normalizeThankYouMessages(messages)[group] : null;
}

export function getCsatTemplateSource(content) {
  return {
    schema_version: CSAT_EMAIL_TEMPLATE_VERSION,
    content: normalizeCsatTemplateContent(content),
  };
}

export { getCsatGroup };
