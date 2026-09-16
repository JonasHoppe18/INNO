export const MAX_FORWARD_ATTACHMENTS = 10;
export const MAX_FORWARD_ATTACHMENT_SIZE_BYTES = 15 * 1024 * 1024;

type SourceMessage = {
  subject?: string | null;
  body_text?: string | null;
  body_html?: string | null;
  from_name?: string | null;
  from_email?: string | null;
  to_emails?: string[] | null;
  cc_emails?: string[] | null;
  received_at?: string | null;
  sent_at?: string | null;
  created_at?: string | null;
};

type StoredAttachment = {
  filename?: string | null;
  mime_type?: string | null;
  size_bytes?: number | string | null;
  provider_attachment_id?: string | null;
  storage_path?: string | null;
};

export type ForwardAttachment = {
  filename: string;
  mime_type: string;
  size_bytes: number;
  content_base64: string;
  is_inline: boolean;
  content_id: string | null;
};

function asString(value: unknown): string {
  return String(value ?? "");
}

function sanitizeSingleLine(value: unknown, fallback = ""): string {
  const normalized = asString(value)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || fallback;
}

function escapeHtml(value: unknown): string {
  return asString(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlToPlainText(value: unknown): string {
  return asString(value)
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|li|tr|table|thead|tbody|ul|ol)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+$/g, "")
    .trim();
}

export function normalizeContentId(value: unknown): string | null {
  const cleaned = sanitizeSingleLine(value)
    .replace(/^cid:/i, "")
    .replace(/[<>]/g, "")
    .replace(/[^A-Za-z0-9._@-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return cleaned || null;
}

function safeUrl(value: unknown, image = false): string {
  const url = sanitizeSingleLine(value);
  if (!url || /\/api\/attachments\//i.test(url)) return "";
  if (image && /^cid:/i.test(url)) {
    const contentId = normalizeContentId(url.slice(4));
    return contentId ? `cid:${contentId}` : "";
  }
  if (!/^https?:\/\//i.test(url) && !(!image && /^mailto:/i.test(url))) return "";
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return "";
  } catch {
    return "";
  }
  return url;
}

export function sanitizeForwardedHtml(value: unknown): string {
  const allowed = new Set([
    "a", "blockquote", "br", "b", "div", "em", "hr", "i", "li", "ol",
    "p", "span", "strong", "table", "tbody", "td", "th", "thead", "tr", "img",
    "u", "ul",
  ]);
  const withoutDangerous = asString(value).replace(
    /<\s*(script|style|iframe|object|embed|form|input|button)[^>]*>[\s\S]*?<\s*\/\1>/gi,
    "",
  );
  const readAttribute = (attrs: string, name: string) => {
    const match = attrs.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
    return match?.[2] || match?.[3] || match?.[4] || "";
  };
  return withoutDangerous
    .replace(/<\/?([a-z0-9-]+)([^>]*)>/gi, (match, rawTag: string, rawAttrs: string) => {
      const tag = rawTag.toLowerCase();
      const closing = /^<\s*\//.test(match);
      if (!allowed.has(tag)) return "";
      if (closing) return `</${tag}>`;
      if (tag === "br") return "<br>";
      if (tag === "hr") return "<hr>";
      if (tag === "a") {
        const href = safeUrl(readAttribute(rawAttrs, "href"));
        return href
          ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener">`
          : "<a>";
      }
      if (tag === "img") {
        const src = safeUrl(readAttribute(rawAttrs, "src"), true);
        if (!src) return "";
        const alt = sanitizeSingleLine(readAttribute(rawAttrs, "alt"));
        return `<img src="${escapeHtml(src)}"${alt ? ` alt="${escapeHtml(alt)}"` : ""}>`;
      }
      return `<${tag}>`;
    })
    .replace(/\u0000/g, "")
    .trim();
}

function normalizePlainText(value: unknown): string {
  return asString(value).replace(/\r\n/g, "\n").trim();
}

function formatAddress(name: unknown, email: unknown): string {
  const safeName = sanitizeSingleLine(name);
  const safeEmail = sanitizeSingleLine(email).toLowerCase();
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeEmail);
  if (safeName && validEmail) return `${safeName} <${safeEmail}>`;
  return validEmail ? safeEmail : safeName || "Unknown sender";
}

function formatList(value: unknown, fallback = "(unknown)"): string {
  const values = Array.isArray(value)
    ? value.map((item) => sanitizeSingleLine(item)).filter(Boolean)
    : [];
  return values.length ? values.join(", ") : fallback;
}

function formatDate(value: unknown): string {
  const raw = sanitizeSingleLine(value);
  if (!raw) return "(unknown)";
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toUTCString();
}

export function normalizeForwardSubject(subject: unknown, fallback = "Inbound message"): string {
  const safeFallback = sanitizeSingleLine(fallback, "Inbound message");
  const raw = sanitizeSingleLine(subject, safeFallback)
    .replace(/^(?:(?:fwd|fw|forward)\s*:\s*)+/i, "")
    .trim();
  return `Fwd: ${raw || safeFallback}`.slice(0, 250);
}

export function isAuthorizedForwardSource(
  source: { id?: string; thread_id?: string; mailbox_id?: string; user_id?: string },
  thread: { id?: string; workspace_id?: string | null },
  mailbox: { id?: string; user_id?: string; workspace_id?: string | null },
): boolean {
  return Boolean(
    source?.id &&
      source.thread_id === thread.id &&
      source.mailbox_id === mailbox.id &&
      source.user_id === mailbox.user_id &&
      (!thread.workspace_id || mailbox.workspace_id === thread.workspace_id),
  );
}

export function buildForwardedBodies(source: SourceMessage): { textBody: string; htmlBody: string } {
  const sourceFrom = formatAddress(source.from_name, source.from_email);
  const sourceDate = formatDate(source.received_at || source.sent_at || source.created_at);
  const sourceSubject = sanitizeSingleLine(source.subject, "(no subject)");
  const sourceTo = formatList(source.to_emails);
  const sourceCc = formatList(source.cc_emails, "");
  const sourceText = normalizePlainText(source.body_text || htmlToPlainText(source.body_html)) || "(empty body)";
  const sourceHtml = sanitizeForwardedHtml(source.body_html || "");
  const renderedSourceHtml = sourceHtml || escapeHtml(sourceText).replace(/\n/g, "<br/>");
  const textHeaders = [
    `From: ${sourceFrom}`,
    `Date: ${sourceDate}`,
    `Subject: ${sourceSubject}`,
    `To: ${sourceTo}`,
    ...(sourceCc ? [`Cc: ${sourceCc}`] : []),
  ];
  const textBody = ["---------- Forwarded message ---------", ...textHeaders, "", sourceText].join("\n");
  const htmlHeaders = [
    `<strong>From:</strong> ${escapeHtml(sourceFrom)}`,
    `<strong>Date:</strong> ${escapeHtml(sourceDate)}`,
    `<strong>Subject:</strong> ${escapeHtml(sourceSubject)}`,
    `<strong>To:</strong> ${escapeHtml(sourceTo)}`,
    ...(sourceCc ? [`<strong>Cc:</strong> ${escapeHtml(sourceCc)}`] : []),
  ].join("<br/>");
  const htmlBody = `<div data-inno-forwarded-message="true"><p><strong>---------- Forwarded message ---------</strong></p><p>${htmlHeaders}</p><hr/><div>${renderedSourceHtml}</div></div>`;
  return { textBody, htmlBody };
}

function normalizeStoredBase64(value: unknown): { contentBase64: string; byteLength: number } {
  let normalized = asString(value).replace(/\s+/g, "").trim();
  if (!normalized) throw new Error("Forwarded attachment content is missing.");
  normalized = normalized.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = normalized.length % 4;
  if (remainder) normalized = normalized.padEnd(normalized.length + (4 - remainder), "=");
  if (!/^[A-Za-z0-9+/=]+$/.test(normalized)) throw new Error("Forwarded attachment content is invalid.");
  let byteLength = 0;
  try {
    byteLength = atob(normalized).length;
  } catch {
    throw new Error("Forwarded attachment content is invalid.");
  }
  return { contentBase64: normalized, byteLength };
}

function extractStoredBase64(storagePath: unknown): string {
  const raw = asString(storagePath).trim();
  const inline = raw.match(/^inline:[^;]+;base64,([\s\S]*)$/i);
  if (inline) return inline[1];
  const data = raw.match(/^data:[^;]+;base64,([\s\S]*)$/i);
  if (data) return data[1];
  throw new Error("Forwarded attachment content is unavailable.");
}

function sanitizeFilename(value: unknown, index: number): string {
  const safe = asString(value)
    .replace(/[\u0000-\u001f\u007f"\\/]+/g, "_")
    .trim()
    .slice(0, 255);
  return safe || `attachment-${index + 1}`;
}

function normalizeMimeType(value: unknown): string {
  const mimeType = sanitizeSingleLine(value).toLowerCase();
  if (!mimeType) return "application/octet-stream";
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(mimeType)) {
    throw new Error("Forwarded attachment MIME type is invalid.");
  }
  return mimeType;
}

function isInline(row: StoredAttachment, sourceHtml: unknown): boolean {
  const contentId = normalizeContentId(row.provider_attachment_id);
  if (!contentId) return false;
  const escaped = contentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`cid:\\s*<?${escaped}>?`, "i").test(asString(sourceHtml));
}

export function materializeForwardAttachment(
  row: StoredAttachment,
  index: number,
  sourceHtml = "",
): ForwardAttachment {
  const { contentBase64, byteLength } = normalizeStoredBase64(extractStoredBase64(row.storage_path));
  const declaredSize = Number(row.size_bytes || 0);
  if (declaredSize > MAX_FORWARD_ATTACHMENT_SIZE_BYTES || byteLength > MAX_FORWARD_ATTACHMENT_SIZE_BYTES) {
    throw new Error(`Forwarded attachment "${sanitizeFilename(row.filename, index)}" exceeds the 15 MB limit.`);
  }
  return {
    filename: sanitizeFilename(row.filename, index),
    mime_type: normalizeMimeType(row.mime_type),
    size_bytes: declaredSize > 0 ? declaredSize : byteLength,
    content_base64: contentBase64,
    is_inline: isInline(row, sourceHtml),
    content_id: normalizeContentId(row.provider_attachment_id),
  };
}

export function extractForwardedCidReferences(sourceHtml: unknown): string[] {
  return Array.from(asString(sourceHtml).matchAll(/\bsrc\s*=\s*["']cid:([^"']+)["']/gi))
    .map((match) => normalizeContentId(match[1]))
    .filter((value): value is string => Boolean(value));
}

export function buildPostmarkAttachments(attachments: ForwardAttachment[]) {
  return attachments.map((attachment, index) => ({
    Name: sanitizeFilename(attachment.filename, index),
    Content: normalizeStoredBase64(attachment.content_base64).contentBase64,
    ContentType: normalizeMimeType(attachment.mime_type),
    ...(attachment.is_inline && attachment.content_id
      ? { ContentID: normalizeContentId(attachment.content_id) || undefined }
      : {}),
  }));
}
