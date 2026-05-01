function asString(value) {
  return String(value || "");
}

export function normalizePlainText(value) {
  return asString(value).replace(/\r\n/g, "\n").trim();
}

export function escapeHtml(value = "") {
  return asString(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function sanitizeInlineStyle(style = "") {
  const raw = asString(style).trim();
  if (!raw) return "";
  if (/expression\s*\(|javascript:/i.test(raw)) return "";
  return raw
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      const [name, ...rest] = item.split(":");
      if (!name || !rest.length) return false;
      const key = String(name || "").trim().toLowerCase();
      const value = rest.join(":").trim();
      if (!key || !value) return false;
      if (/url\s*\(\s*javascript:/i.test(value)) return false;
      return true;
    })
    .join("; ");
}

export function sanitizeEmailTemplateHtml(value = "") {
  const allowedTags = new Set([
    "a",
    "img",
    "br",
    "p",
    "div",
    "span",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "ul",
    "ol",
    "li",
    "table",
    "tbody",
    "thead",
    "tr",
    "td",
    "th",
    "hr",
  ]);

  const withoutDangerousBlocks = asString(value).replace(
    /<\s*(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\s*\/\1>/gi,
    ""
  );

  const sanitized = withoutDangerousBlocks.replace(
    /<\/?([a-z0-9-]+)([^>]*)>/gi,
    (match, rawTag, rawAttrs = "") => {
      const tag = asString(rawTag).toLowerCase();
      const isClosing = /^<\s*\//.test(match);
      if (!allowedTags.has(tag)) return "";
      if (isClosing) return `</${tag}>`;
      if (tag === "br") return "<br>";
      if (tag === "hr") return "<hr>";

      if (tag === "a") {
        const hrefMatch = asString(rawAttrs).match(
          /\shref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i
        );
        const hrefRaw = hrefMatch?.[2] || hrefMatch?.[3] || hrefMatch?.[4] || "";
        const href = asString(hrefRaw).trim();
        const safeHref = /^https?:\/\//i.test(href) || /^mailto:/i.test(href) ? href : "";
        const styleMatch = asString(rawAttrs).match(
          /\sstyle\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i
        );
        const styleRaw = styleMatch?.[2] || styleMatch?.[3] || styleMatch?.[4] || "";
        const safeStyle = sanitizeInlineStyle(styleRaw);
        const styleAttr = safeStyle ? ` style="${escapeHtml(safeStyle)}"` : "";
        if (!safeHref) return `<a${styleAttr}>`;
        return `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noreferrer noopener"${styleAttr}>`;
      }

      if (tag === "img") {
        const srcMatch = asString(rawAttrs).match(
          /\ssrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i
        );
        const srcRaw = srcMatch?.[2] || srcMatch?.[3] || srcMatch?.[4] || "";
        const src = asString(srcRaw).trim();
        const safeSrc =
          /^https?:\/\//i.test(src) || /^data:image\//i.test(src) || /^cid:/i.test(src)
            ? src
            : "";
        if (!safeSrc) return "";
        const altMatch = asString(rawAttrs).match(/\salt\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
        const altRaw = altMatch?.[2] || altMatch?.[3] || altMatch?.[4] || "";
        const widthMatch = asString(rawAttrs).match(/\swidth\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
        const widthRaw = widthMatch?.[2] || widthMatch?.[3] || widthMatch?.[4] || "";
        const heightMatch = asString(rawAttrs).match(/\sheight\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
        const heightRaw = heightMatch?.[2] || heightMatch?.[3] || heightMatch?.[4] || "";
        const styleMatch = asString(rawAttrs).match(
          /\sstyle\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i
        );
        const styleRaw = styleMatch?.[2] || styleMatch?.[3] || styleMatch?.[4] || "";
        const safeStyle = sanitizeInlineStyle(styleRaw);
        const safeWidth = /^\d{1,4}$/.test(asString(widthRaw).trim()) ? asString(widthRaw).trim() : "";
        const safeHeight = /^\d{1,4}$/.test(asString(heightRaw).trim()) ? asString(heightRaw).trim() : "";
        const altAttr = altRaw ? ` alt="${escapeHtml(altRaw)}"` : "";
        const widthAttr = safeWidth ? ` width="${safeWidth}"` : "";
        const heightAttr = safeHeight ? ` height="${safeHeight}"` : "";
        const styleAttr = safeStyle ? ` style="${escapeHtml(safeStyle)}"` : "";
        return `<img src="${escapeHtml(safeSrc)}"${altAttr}${widthAttr}${heightAttr}${styleAttr}>`;
      }

      const styleMatch = asString(rawAttrs).match(/\sstyle\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const styleRaw = styleMatch?.[2] || styleMatch?.[3] || styleMatch?.[4] || "";
      const safeStyle = sanitizeInlineStyle(styleRaw);
      const styleAttr = safeStyle ? ` style="${escapeHtml(safeStyle)}"` : "";
      return `<${tag}${styleAttr}>`;
    }
  );

  return sanitized
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function stripHtmlToText(value = "") {
  return asString(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeBasicEntities(value = "") {
  return asString(value)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function htmlToPlainText(value = "") {
  const withLineBreaks = asString(value)
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|tr|table|thead|tbody|ul|ol)\s*>/gi, "\n");
  return decodeBasicEntities(withLineBreaks)
    .replace(/<[^>]*>/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+$/g, "")
    .trim();
}

function stripTrailingSection(text = "", section = "") {
  const normalizedText = normalizePlainText(text);
  const normalizedSection = normalizePlainText(section);
  if (!normalizedText || !normalizedSection) return normalizedText;
  if (!normalizedText.endsWith(normalizedSection)) return normalizedText;
  return normalizedText
    .slice(0, normalizedText.length - normalizedSection.length)
    .replace(/\s+$/g, "")
    .trimEnd();
}

export function stripTrailingComposedFooter(text = "", config = {}) {
  let next = normalizePlainText(text);
  next = stripTrailingSection(next, config?.templateTextFallback);
  next = stripTrailingSection(next, config?.closingText);
  return next;
}

export function plainTextToHtml(text = "") {
  return escapeHtml(normalizePlainText(text)).replace(/\n/g, "<br/>");
}

export function composeEmailBodyWithSignature({ bodyText = "", bodyHtml = "", config = {} }) {
  const inputText = normalizePlainText(bodyText || stripHtmlToText(bodyHtml));
  const coreBodyText = stripTrailingComposedFooter(inputText, config);
  const closingText = normalizePlainText(config?.closingText || "");
  const templateHtml = sanitizeEmailTemplateHtml(config?.templateHtml || "");
  const templateTextFallback = normalizePlainText(
    config?.templateTextFallback || htmlToPlainText(templateHtml)
  );

  const bodyTextWithClosing = [coreBodyText, closingText].filter(Boolean).join("\n\n").trim();
  const textSections = [bodyTextWithClosing, templateTextFallback].filter(Boolean);
  const finalBodyText = textSections.join("\n\n").trim();

  const baseHtml = asString(bodyHtml || "").trim() || plainTextToHtml(coreBodyText);
  const inputAlreadyIncludesClosing =
    Boolean(closingText) && normalizePlainText(inputText).endsWith(closingText);
  const bodyHtmlWithClosing = [
    baseHtml,
    closingText && !inputAlreadyIncludesClosing ? plainTextToHtml(closingText) : "",
  ]
    .filter(Boolean)
    .join("<br/><br/>")
    .trim();
  const finalBodyHtml = [bodyHtmlWithClosing, templateHtml].filter(Boolean).join("<br/><br/>").trim();

  return {
    coreBodyText,
    closingText,
    templateHtml,
    templateTextFallback,
    bodyTextWithClosing,
    bodyHtmlWithClosing,
    finalBodyText,
    finalBodyHtml,
  };
}

export async function loadEmailSignatureConfig(
  serviceClient,
  { workspaceId = null, userId = null, legacySignature = "" } = {}
) {
  const fallback = {
    closingText: normalizePlainText(legacySignature),
    templateHtml: "",
    templateTextFallback: "",
    isActive: false,
  };

  if (!workspaceId || !userId) return fallback;
  try {
    const { data, error } = await serviceClient
      .from("workspace_email_signatures")
      .select("closing_text, template_html, template_text_fallback, is_active")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      if (/workspace_email_signatures/i.test(String(error.message || ""))) {
        return fallback;
      }
      throw error;
    }
    const isActive = data?.is_active !== false;
    if (!isActive) return fallback;
    const templateHtml = sanitizeEmailTemplateHtml(data?.template_html || "");
    const templateTextFallback = normalizePlainText(
      data?.template_text_fallback || htmlToPlainText(templateHtml)
    );
    return {
      closingText: normalizePlainText(legacySignature),
      templateHtml,
      templateTextFallback,
      isActive: true,
    };
  } catch (error) {
    console.warn("[email-signature] signature config lookup failed", error?.message || error);
    return fallback;
  }
}
