import { escapeHtml, htmlToPlainText, normalizePlainText } from "./email-signature";
import { applyScope } from "./workspace-auth";

export const MAX_FORWARD_ATTACHMENTS = 10;
export const MAX_FORWARD_ATTACHMENT_SIZE_BYTES = 15 * 1024 * 1024;

const ALLOWED_TAGS = new Set([
  "a",
  "blockquote",
  "br",
  "b",
  "div",
  "em",
  "hr",
  "i",
  "img",
  "li",
  "ol",
  "p",
  "span",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);

function asString(value) {
  return String(value ?? "");
}

function sanitizeSingleLine(value, fallback = "") {
  const normalized = asString(value)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || fallback;
}

function normalizeEmail(value) {
  const normalized = sanitizeSingleLine(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : "";
}

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => sanitizeSingleLine(item))
    .filter(Boolean);
}

function formatAddress(name, email, fallback = "Unknown sender") {
  const safeName = sanitizeSingleLine(name);
  const safeEmail = normalizeEmail(email);
  if (safeName && safeEmail) return `${safeName} <${safeEmail}>`;
  return safeEmail || safeName || fallback;
}

function formatAddressList(value, fallback = "(unknown)") {
  const addresses = normalizeList(value);
  return addresses.length ? addresses.join(", ") : fallback;
}

function sanitizeInlineStyle(value) {
  const raw = sanitizeSingleLine(value);
  if (!raw || /expression\s*\(|javascript:|url\s*\(\s*data:/i.test(raw)) {
    return "";
  }
  return raw
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      const [name, ...rest] = item.split(":");
      return Boolean(name && rest.length && /^[a-z-]+$/i.test(name.trim()));
    })
    .join("; ");
}

function readAttribute(rawAttrs, name) {
  const match = asString(rawAttrs).match(
    new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
  );
  return match?.[2] || match?.[3] || match?.[4] || "";
}

function safeForwardUrl(value, { image = false } = {}) {
  const url = sanitizeSingleLine(value);
  if (!url || /\/api\/attachments\//i.test(url)) return "";
  if (image && /^cid:/i.test(url)) {
    const contentId = normalizeContentId(url.slice(4));
    return contentId ? `cid:${contentId}` : "";
  }
  if (/^https?:\/\//i.test(url) || (!image && /^mailto:/i.test(url))) {
    try {
      const parsed = new URL(url);
      if (parsed.username || parsed.password) return "";
    } catch {
      return "";
    }
    return url;
  }
  return "";
}

export function normalizeContentId(value) {
  const cleaned = sanitizeSingleLine(value)
    .replace(/^cid:/i, "")
    .replace(/[<>]/g, "")
    .replace(/[^A-Za-z0-9._@-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return cleaned || null;
}

export function sanitizeForwardedHtml(value = "") {
  const withoutDangerousBlocks = asString(value).replace(
    /<\s*(script|style|iframe|object|embed|form|input|button)[^>]*>[\s\S]*?<\s*\/\1>/gi,
    "",
  );

  return withoutDangerousBlocks
    .replace(/<\/?([a-z0-9-]+)([^>]*)>/gi, (match, rawTag, rawAttrs = "") => {
      const tag = asString(rawTag).toLowerCase();
      const closing = /^<\s*\//.test(match);
      if (!ALLOWED_TAGS.has(tag)) return "";
      if (closing) return `</${tag}>`;
      if (tag === "br") return "<br>";
      if (tag === "hr") return "<hr>";

      const style = sanitizeInlineStyle(readAttribute(rawAttrs, "style"));
      const styleAttr = style ? ` style="${escapeHtml(style)}"` : "";

      if (tag === "a") {
        const href = safeForwardUrl(readAttribute(rawAttrs, "href"));
        return href
          ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener"${styleAttr}>`
          : `<a${styleAttr}>`;
      }

      if (tag === "img") {
        const src = safeForwardUrl(readAttribute(rawAttrs, "src"), { image: true });
        if (!src) return "";
        const alt = sanitizeSingleLine(readAttribute(rawAttrs, "alt"));
        const width = /^\d{1,4}$/.test(readAttribute(rawAttrs, "width"))
          ? readAttribute(rawAttrs, "width")
          : "";
        const height = /^\d{1,4}$/.test(readAttribute(rawAttrs, "height"))
          ? readAttribute(rawAttrs, "height")
          : "";
        return [
          `<img src="${escapeHtml(src)}"`,
          alt ? ` alt="${escapeHtml(alt)}"` : "",
          width ? ` width="${width}"` : "",
          height ? ` height="${height}"` : "",
          styleAttr,
          ">",
        ].join("");
      }

      return `<${tag}${styleAttr}>`;
    })
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .trim();
}

export function normalizeForwardSubject(subject, fallback = "Inbound message") {
  const safeFallback = sanitizeSingleLine(fallback, "Inbound message");
  const raw = sanitizeSingleLine(subject, safeFallback)
    .replace(/^(?:(?:fwd|fw|forward)\s*:\s*)+/i, "")
    .trim();
  return `Fwd: ${raw || safeFallback}`.slice(0, 250);
}

export function isAuthorizedForwardSource({ source = {}, thread = {}, mailbox = {} } = {}) {
  return Boolean(
    source?.id &&
      source.thread_id === thread.id &&
      source.mailbox_id === mailbox.id &&
      source.user_id === mailbox.user_id &&
      (!thread.workspace_id || mailbox.workspace_id === thread.workspace_id),
  );
}

export async function loadAuthorizedForwardSource(
  serviceClient,
  scope,
  thread,
  mailbox,
  sourceMessageId,
) {
  const requestedSourceId = String(sourceMessageId || "").trim();
  let sourceQuery = serviceClient
    .from("mail_messages")
    .select(
      "id, user_id, mailbox_id, thread_id, subject, body_text, body_html, from_name, from_email, to_emails, cc_emails, received_at, sent_at, created_at, from_me",
    )
    .eq("user_id", mailbox.user_id)
    .eq("mailbox_id", mailbox.id)
    .eq("thread_id", thread.id)
    .eq("from_me", false)
    .order("received_at", { ascending: false, nullsLast: true })
    .order("created_at", { ascending: false })
    .limit(1);
  if (requestedSourceId) sourceQuery = sourceQuery.eq("id", requestedSourceId);
  sourceQuery = applyScope(sourceQuery, scope);
  const { data: sourceRows, error: sourceError } = await sourceQuery;
  if (sourceError) throw new Error(sourceError.message);
  const source = Array.isArray(sourceRows) ? sourceRows[0] : null;
  if (!source || !isAuthorizedForwardSource({ source, thread, mailbox })) {
    throw new Error("The original inbound message could not be found in this thread.");
  }

  let attachmentQuery = serviceClient
    .from("mail_attachments")
    .select(
      "id, user_id, mailbox_id, message_id, provider, provider_attachment_id, filename, mime_type, size_bytes, storage_path, created_at",
    )
    .eq("user_id", mailbox.user_id)
    .eq("mailbox_id", mailbox.id)
    .eq("message_id", source.id)
    .order("created_at", { ascending: true });
  attachmentQuery = applyScope(attachmentQuery, scope, {
    workspaceColumn: null,
    userColumn: "user_id",
  });
  const { data: attachmentRows, error: attachmentError } = await attachmentQuery;
  if (attachmentError) throw new Error(attachmentError.message);

  const rows = Array.isArray(attachmentRows) ? attachmentRows : [];
  if (rows.length > MAX_FORWARD_ATTACHMENTS) {
    throw new Error(
      `This email has ${rows.length} attachments; forwarding is limited to ${MAX_FORWARD_ATTACHMENTS}.`,
    );
  }
  const attachments = rows.map((row, index) =>
    materializeForwardAttachment(row, index, { sourceHtml: source.body_html || "" }),
  );
  const sourceCids = new Set(extractForwardedCidReferences(source.body_html || ""));
  const availableCids = new Set(
    attachments
      .filter((attachment) => attachment.is_inline)
      .map((attachment) => attachment.content_id)
      .filter(Boolean),
  );
  const missingCids = Array.from(sourceCids).filter((contentId) => !availableCids.has(contentId));
  if (missingCids.length) {
    throw new Error(
      `Forwarding cannot include inline image data that is no longer available (${missingCids.join(", ")}).`,
    );
  }

  return { source, attachments };
}

export function formatForwardDate(value) {
  const raw = sanitizeSingleLine(value);
  if (!raw) return "(unknown)";
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toUTCString();
}

export function buildForwardedBodies({ agentBodyText = "", agentBodyHtml = "", source = {} } = {}) {
  const sourceFrom = formatAddress(source.from_name, source.from_email);
  const sourceDate = formatForwardDate(source.received_at || source.sent_at || source.created_at);
  const sourceSubject = sanitizeSingleLine(source.subject, "(no subject)");
  const sourceTo = formatAddressList(source.to_emails);
  const sourceCc = formatAddressList(source.cc_emails, "");
  const sourceText = normalizePlainText(
    source.body_text || htmlToPlainText(source.body_html || ""),
  ) || "(empty body)";
  const sourceHtml = sanitizeForwardedHtml(source.body_html || "");
  const renderedSourceHtml = sourceHtml || escapeHtml(sourceText).replace(/\n/g, "<br/>");
  const agentText = normalizePlainText(agentBodyText);
  const agentHtml = sanitizeForwardedHtml(agentBodyHtml || "") ||
    (agentText ? escapeHtml(agentText).replace(/\n/g, "<br/>") : "");

  const textHeaders = [
    `From: ${sourceFrom}`,
    `Date: ${sourceDate}`,
    `Subject: ${sourceSubject}`,
    `To: ${sourceTo}`,
    ...(sourceCc ? [`Cc: ${sourceCc}`] : []),
  ];
  const textBody = [
    ...(agentText ? [agentText, ""] : []),
    "---------- Forwarded message ---------",
    ...textHeaders,
    "",
    sourceText,
  ].join("\n");

  const htmlHeaders = [
    `<strong>From:</strong> ${escapeHtml(sourceFrom)}`,
    `<strong>Date:</strong> ${escapeHtml(sourceDate)}`,
    `<strong>Subject:</strong> ${escapeHtml(sourceSubject)}`,
    `<strong>To:</strong> ${escapeHtml(sourceTo)}`,
    ...(sourceCc ? [`<strong>Cc:</strong> ${escapeHtml(sourceCc)}`] : []),
  ].join("<br/>");
  const htmlBody = [
    agentHtml ? `<div>${agentHtml}</div>` : "",
    `<div data-inno-forwarded-message="true"><p><strong>---------- Forwarded message ---------</strong></p>`,
    `<p>${htmlHeaders}</p><hr/><div>${renderedSourceHtml}</div></div>`,
  ].filter(Boolean).join("<br/><br/>");

  return { textBody, htmlBody };
}

function normalizeStoredBase64(value) {
  let normalized = asString(value).replace(/\s+/g, "").trim();
  if (!normalized) throw new Error("Forwarded attachment content is missing.");
  normalized = normalized.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = normalized.length % 4;
  if (remainder) normalized = normalized.padEnd(normalized.length + (4 - remainder), "=");
  if (!/^[A-Za-z0-9+/=]+$/.test(normalized)) {
    throw new Error("Forwarded attachment content is invalid.");
  }
  let byteLength = 0;
  try {
    byteLength = atob(normalized).length;
  } catch {
    throw new Error("Forwarded attachment content is invalid.");
  }
  return { contentBase64: normalized, byteLength };
}

function extractStoredBase64(storagePath) {
  const raw = asString(storagePath).trim();
  if (!raw) throw new Error("Forwarded attachment content is unavailable.");
  const inlineMatch = raw.match(/^inline:[^;]+;base64,([\s\S]*)$/i);
  if (inlineMatch) return inlineMatch[1];
  const dataMatch = raw.match(/^data:[^;]+;base64,([\s\S]*)$/i);
  if (dataMatch) return dataMatch[1];
  throw new Error("Forwarded attachment content is unavailable.");
}

export function sanitizeForwardAttachmentFilename(filename, index = 0) {
  const safe = asString(filename)
    .replace(/[\u0000-\u001f\u007f"\\/]+/g, "_")
    .trim()
    .slice(0, 255);
  return safe || `attachment-${index + 1}`;
}

function normalizeMimeType(value) {
  const mimeType = sanitizeSingleLine(value).toLowerCase();
  if (!mimeType) return "application/octet-stream";
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(mimeType)) {
    throw new Error("Forwarded attachment MIME type is invalid.");
  }
  return mimeType;
}

function isInlineAttachment(row, sourceHtml) {
  const contentId = normalizeContentId(row?.provider_attachment_id);
  if (!contentId) return false;
  const escaped = contentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`cid:\\s*<?${escaped}>?`, "i").test(asString(sourceHtml));
}

export function materializeForwardAttachment(row, index = 0, { sourceHtml = "" } = {}) {
  const rawContent = extractStoredBase64(row?.storage_path);
  const { contentBase64, byteLength } = normalizeStoredBase64(rawContent);
  const declaredSize = Number(row?.size_bytes || 0);
  if (declaredSize > MAX_FORWARD_ATTACHMENT_SIZE_BYTES || byteLength > MAX_FORWARD_ATTACHMENT_SIZE_BYTES) {
    throw new Error(
      `Forwarded attachment "${sanitizeForwardAttachmentFilename(row?.filename, index)}" exceeds the 15 MB limit.`,
    );
  }
  const contentId = normalizeContentId(row?.provider_attachment_id);
  return {
    filename: sanitizeForwardAttachmentFilename(row?.filename, index),
    mime_type: normalizeMimeType(row?.mime_type),
    size_bytes: declaredSize > 0 ? declaredSize : byteLength,
    content_base64: contentBase64,
    is_inline: isInlineAttachment(row, sourceHtml),
    content_id: contentId,
  };
}

export function extractForwardedCidReferences(sourceHtml = "") {
  return Array.from(asString(sourceHtml).matchAll(/\bsrc\s*=\s*["']cid:([^"']+)["']/gi))
    .map((match) => normalizeContentId(match?.[1]))
    .filter(Boolean);
}

export function buildPostmarkAttachments(attachments = []) {
  return (Array.isArray(attachments) ? attachments : []).map((attachment, index) => ({
    Name: sanitizeForwardAttachmentFilename(attachment?.filename, index),
    Content: normalizeStoredBase64(attachment?.content_base64).contentBase64,
    ContentType: normalizeMimeType(attachment?.mime_type),
    ...(attachment?.is_inline && normalizeContentId(attachment?.content_id)
      ? { ContentID: normalizeContentId(attachment.content_id) }
      : {}),
  }));
}

export function buildOutlookAttachment(attachment, index = 0) {
  return {
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: sanitizeForwardAttachmentFilename(attachment?.filename, index),
    contentType: normalizeMimeType(attachment?.mime_type),
    contentBytes: normalizeStoredBase64(attachment?.content_base64).contentBase64,
    isInline: attachment?.is_inline === true,
    ...(attachment?.is_inline && normalizeContentId(attachment?.content_id)
      ? { contentId: normalizeContentId(attachment.content_id) }
      : {}),
  };
}
