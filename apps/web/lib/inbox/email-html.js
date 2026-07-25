// Sanitization and inline-image handling for rendered email bodies.
//
// Extracted from components/inbox/MessageBubble.jsx so the logic can be unit
// tested without React. Pure functions only — no DOM, no framework imports.

export const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

export const stripIncompleteTrailingTag = (value = "") => {
  const html = String(value || "");
  const lastOpen = html.lastIndexOf("<");
  const lastClose = html.lastIndexOf(">");
  if (lastOpen <= lastClose) return html;
  return html.slice(0, lastOpen);
};

const normalizeCid = (value = "") =>
  String(value || "")
    .trim()
    .replace(/^cid:/i, "")
    .replace(/^<|>$/g, "")
    .toLowerCase();

const normalizeAttachmentFilename = (value = "") =>
  String(value || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .toLowerCase();

const parseInlineStoragePath = (value = "") => {
  const raw = String(value || "");
  if (!raw.startsWith("inline:")) return null;
  const payload = raw.slice("inline:".length);
  const commaIndex = payload.indexOf(",");
  if (commaIndex <= 0) return null;
  const metadata = payload.slice(0, commaIndex);
  const contentBase64 = payload.slice(commaIndex + 1).replace(/\s+/g, "");
  const [mimeType] = metadata.split(";");
  if (!contentBase64) return null;
  return {
    mimeType: String(mimeType || "application/octet-stream").trim() || "application/octet-stream",
    contentBase64,
  };
};

export const getAttachmentInlineSrc = (attachment) => {
  if (!attachment || typeof attachment !== "object") return "";
  const attachmentId = String(attachment?.id || "").trim();
  if (attachmentId) {
    return `/api/attachments/${attachmentId}/download?disposition=inline`;
  }
  const storageInline = parseInlineStoragePath(attachment?.storage_path || "");
  if (storageInline?.contentBase64) {
    return `data:${storageInline.mimeType};base64,${storageInline.contentBase64}`;
  }
  const contentBase64 = String(
    attachment?.content_base64 || attachment?.contentBase64 || ""
  ).replace(/\s+/g, "");
  if (!contentBase64) return "";
  const mimeType = String(
    attachment?.mime_type || attachment?.mimeType || "application/octet-stream"
  ).trim();
  return `data:${mimeType || "application/octet-stream"};base64,${contentBase64}`;
};

const lookupAttachmentInlineUrl = (cidMap, rawSrc = "") => {
  const src = String(rawSrc || "").trim();
  if (!src) return "";
  const withoutCidPrefix = src.replace(/^cid:/i, "");
  const basename = withoutCidPrefix.split("/").pop() || withoutCidPrefix;
  const decodedBasename = (() => {
    try {
      return decodeURIComponent(basename);
    } catch {
      return basename;
    }
  })();

  const candidates = [
    normalizeCid(src),
    normalizeCid(withoutCidPrefix),
    normalizeCid(basename),
    normalizeAttachmentFilename(src),
    normalizeAttachmentFilename(withoutCidPrefix),
    normalizeAttachmentFilename(basename),
    normalizeAttachmentFilename(decodedBasename),
  ].filter(Boolean);

  for (const key of candidates) {
    const mapped = cidMap.get(key);
    if (mapped) return mapped;
  }

  return "";
};

const buildCidAttachmentUrlMap = (attachments = []) => {
  const map = new Map();
  const addCandidate = (candidate, url) => {
    const key = normalizeCid(candidate);
    if (!key || map.has(key)) return;
    map.set(key, url);
    const withoutDomainPart = key.split("@")[0];
    if (withoutDomainPart && !map.has(withoutDomainPart)) {
      map.set(withoutDomainPart, url);
    }
  };

  for (const attachment of attachments || []) {
    const url = getAttachmentInlineSrc(attachment);
    if (!url) continue;
    const candidates = [
      attachment?.provider_attachment_id,
      attachment?.providerAttachmentId,
      attachment?.content_id,
      attachment?.contentId,
      attachment?.filename,
      attachment?.name,
    ];
    for (const candidate of candidates) {
      addCandidate(candidate, url);
      const filename = normalizeAttachmentFilename(candidate);
      if (filename) addCandidate(filename, url);
    }
  }
  return map;
};

const resolveInlineCidImages = (html, attachments = []) => {
  const cidMap = buildCidAttachmentUrlMap(attachments);
  const removeUnresolvedCidImages = (value) =>
    String(value || "").replace(/<img\b[^>]*\bsrc=(['"])cid:[^'"]+\1[^>]*>/gi, "");
  if (!cidMap.size) {
    // Avoid browser cid: fetch errors when we cannot resolve inline references.
    return removeUnresolvedCidImages(html);
  }
  const replaced = String(html || "").replace(
    /<img\b[^>]*\bsrc=(['"])cid:([^'"]+)\1[^>]*>/gi,
    (imgTag, quote, cidValue) => {
      const key = normalizeCid(cidValue);
      const mapped = key ? cidMap.get(key) : "";
      if (!mapped) return "";
      return String(imgTag).replace(
        /\bsrc=(['"])cid:[^'"]+\1/i,
        `src=${quote}${mapped}${quote}`
      );
    }
  );
  return removeUnresolvedCidImages(replaced);
};

export function sanitizeInlineStyle(style = "") {
  const raw = String(style || "").trim();
  if (!raw || /expression\s*\(|javascript:/i.test(raw)) return "";
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

// --- Signature zone -------------------------------------------------------
//
// Everything from the first sign-off or quote marker onwards is treated as the
// "signature zone". Images there are logos, not content: a support agent
// scanning a thread needs them present but never prominent. A forwarded chain
// can carry three or four of them in a single message, and at content size
// they push the actual text out of the viewport.
//
// Position is the only signal. Filename heuristics were considered and
// rejected: Outlook names both logos and pasted screenshots image001.png.

const SIGN_OFF_PATTERNS = [
  /\bmed\s+venlig\s+hilsen/i,
  /\bvenlig\s+hilsen/i,
  /(^|[^a-z0-9æøå])mvh([^a-z0-9æøå]|$)/i,
  /\bde\s+bedste\s+hilsner/i,
  /\bk(æ|ae)rlig\s+hilsen/i,
  /\bkind\s+regards/i,
  /\bbest\s+regards/i,
  /\bwarm\s+regards/i,
  /\bbest\s+wishes/i,
  /\bsincerely/i,
  /\bmany\s+thanks/i,
  /\bmit\s+freundlichen\s+gr(ü|u)(ß|ss)en/i,
  /\bmet\s+vriendelijke\s+groet/i,
  // RFC 3676 signature delimiter: "-- " alone on a line.
  /(^|\n|<br\s*\/?>)\s*--\s*(\n|<br\s*\/?>)/i,
];

const QUOTE_PATTERNS = [
  /<blockquote/i,
  /gmail_quote/i,
  /OutlookMessageHeader/i,
  /-{3,}\s*original\s+message\s*-{3,}/i,
  /-{3,}\s*oprindelig\s+meddelelse\s*-{3,}/i,
  /-{3,}\s*forwarded\s+message\s*-{3,}/i,
  // Outlook/Zendesk forward header: "From: ... Sent: ..." with markup between.
  /\b(from|fra)\s*:[\s\S]{0,400}?\b(sent|sendt|dato|date)\s*:/i,
  /\bon\s+[\s\S]{0,160}?\bwrote\s*:/i,
  /\bden\s+[\s\S]{0,160}?\bskrev\b/i,
];

// Lowest offset at which the signature zone begins, or Infinity if the message
// has no sign-off and no quoted section.
export const findSignatureZoneStart = (html = "") => {
  const str = String(html || "");
  if (!str) return Infinity;
  let earliest = Infinity;
  for (const pattern of [...SIGN_OFF_PATTERNS, ...QUOTE_PATTERNS]) {
    const match = str.match(pattern);
    if (match && typeof match.index === "number" && match.index < earliest) {
      earliest = match.index;
    }
  }
  return earliest;
};

// Signature-zone logos render at a uniform small size. The sender's declared
// width is deliberately dropped: pairing an explicit width with a max-height
// breaks the aspect ratio, and uniformity is the point of this tier.
const SIGNATURE_IMAGE_STYLE =
  "max-height:44px;max-width:200px;width:auto;height:auto;";

// A content image whose width the sender declared keeps that width, and opts
// out of the CSS height cap — clamping height while width stays fixed would
// stretch the image. Images with no declared width carry no inline sizing and
// fall through to the EMAIL_BODY_CLASS cap, where width:auto keeps the ratio.
const buildContentImageStyle = (declaredWidth) =>
  declaredWidth ? `width:${declaredWidth}px;height:auto;max-width:100%;max-height:none;` : "";

const parseDeclaredWidth = (imgTag) => {
  const raw = String(imgTag).match(/\swidth=(['"]?)(\d+)(?:px)?\1?/i)?.[2];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 2000) return 0;
  return parsed;
};

// Rebuilt <img> tags are parked behind placeholders while the generic
// sanitization passes run, then restored at the very end. Without this the
// pass that strips inline styles would also strip the sizing style we just
// computed - the bug that made the earlier width-preservation fix a no-op in
// the thread view while still working in the "View email" modal.
const IMG_PLACEHOLDER_RE = /@@SONA_IMG_(\d+)@@/g;
const imgPlaceholder = (index) => '@@SONA_IMG_' + index + '@@';

export const sanitizeEmailHtml = (value, attachments = [], options = {}) => {
  if (!value) return "";
  const cidMap = buildCidAttachmentUrlMap(attachments);
  const preserveInlineStyles = options?.preserveInlineStyles === true;
  const htmlWithResolvedInlineCids = resolveInlineCidImages(
    // Neutralize any forged placeholder in sender content.
    stripIncompleteTrailingTag(String(value).replace(IMG_PLACEHOLDER_RE, "")),
    attachments
  );
  const signatureZoneStart = findSignatureZoneStart(htmlWithResolvedInlineCids);

  const rebuiltImages = [];
  const sanitizedWithSafeImages = String(htmlWithResolvedInlineCids).replace(
    /<img\b[^>]*>/gi,
    (imgTag, offset) => {
      const quotedSrc = String(imgTag).match(/\bsrc=(['"])(.*?)\1/i)?.[2] || "";
      const unquotedSrc = String(imgTag).match(/\bsrc=([^\s>]+)/i)?.[1] || "";
      const rawSrc = String(quotedSrc || unquotedSrc || "").trim();
      if (!rawSrc) return "";

      const mappedSrc = lookupAttachmentInlineUrl(cidMap, rawSrc);
      const resolvedSrc = mappedSrc || rawSrc;

      const isSafeAttachmentSrc =
        resolvedSrc.startsWith("/api/attachments/") ||
        /\/api\/attachments\/[^/]+\/download/i.test(resolvedSrc) ||
        /^data:image\//i.test(resolvedSrc) ||
        /^https?:\/\//i.test(resolvedSrc);

      if (!isSafeAttachmentSrc) return "";

      const styleMatch = String(imgTag).match(/\sstyle=(['"])([\s\S]*?)\1/i);
      const safeStyle = preserveInlineStyles ? sanitizeInlineStyle(styleMatch?.[2] || "") : "";
      const senderSetWidth = /(?:^|;)\s*width\s*:/i.test(safeStyle);

      const isSignatureImage = offset >= signatureZoneStart;
      const sizeStyle = isSignatureImage
        ? SIGNATURE_IMAGE_STYLE
        : senderSetWidth
        ? ""
        : buildContentImageStyle(parseDeclaredWidth(imgTag));

      // sizeStyle last so it wins over a sender declaration for the same
      // property; for content images we already skipped it when the sender
      // set an explicit width.
      const combinedStyle = [safeStyle, sizeStyle].filter(Boolean).join(" ");
      const styleAttr = combinedStyle ? ` style="${escapeHtml(combinedStyle)}"` : "";
      const dataAttr = isSignatureImage ? ' data-signature-image="true"' : "";
      rebuiltImages.push(
        `<img src="${escapeHtml(resolvedSrc)}" alt="Inline attachment image" loading="lazy"${dataAttr}${styleAttr}>`
      );
      return imgPlaceholder(rebuiltImages.length - 1);
    }
  );

  const sanitized = String(sanitizedWithSafeImages)
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/<link[\s\S]*?>/gi, "")
    .replace(/<\/?font[^>]*>/gi, "")
    .replace(/\sstyle=(['"])([\s\S]*?)\1/gi, (_match, _quote, rawStyle) => {
      if (!preserveInlineStyles) return "";
      const safeStyle = sanitizeInlineStyle(rawStyle);
      return safeStyle ? ` style="${escapeHtml(safeStyle)}"` : "";
    })
    .replace(/\sclass=(['"])[\s\S]*?\1/gi, "")
    .replace(/<\/?(html|head|body|meta|title)[^>]*>/gi, "");

  const tokens = sanitized.split(/(<[^>]+>)/g);
  let insideAnchor = false;
  const linkified = tokens
    .map((token) => {
      if (!token) return token;
      if (token.startsWith("<")) {
        if (/^<a\b/i.test(token)) insideAnchor = true;
        if (/^<\/a>/i.test(token)) insideAnchor = false;
        return token;
      }
      if (insideAnchor) return token;
      return token.replace(
        /https?:\/\/[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s<]*)?/gi,
        (rawUrl) => {
          const match = String(rawUrl).match(/^(.*?)([)\].,!?;:]*)$/);
          const url = match?.[1] || rawUrl;
          const trailing = match?.[2] || "";
          return `<a href="${url}" target="_blank" rel="noreferrer">${url}</a>${trailing}`;
        }
      );
    })
    .join("");

  return stripIncompleteTrailingTag(linkified).replace(
    IMG_PLACEHOLDER_RE,
    (_match, index) => rebuiltImages[Number(index)] ?? ""
  );
};
