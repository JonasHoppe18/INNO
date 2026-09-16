import crypto from "crypto";

function toBase64Url(input) {
  return Buffer.from(input, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function chunkBase64(input, lineLength = 76) {
  const value = String(input || "");
  if (!value) return "";
  const chunks = [];
  for (let index = 0; index < value.length; index += lineLength) {
    chunks.push(value.slice(index, index + lineLength));
  }
  return chunks.join("\r\n");
}

function sanitizeBase64(input) {
  const value = String(input || "").replace(/\s+/g, "");
  if (!value || !/^[A-Za-z0-9+/=]+$/.test(value)) {
    throw new Error("Attachment content must be valid base64.");
  }
  return value;
}

function normalizeContentId(value = "", fallback = "") {
  const cleaned = String(value || fallback || "")
    .trim()
    .replace(/^cid:/i, "")
    .replace(/[^A-Za-z0-9._@-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return cleaned || null;
}

export function buildRawEmail({
  from,
  to,
  cc,
  bcc,
  subject,
  bodyText,
  bodyHtml,
  inReplyTo,
  attachments,
}) {
  const safeAttachments = Array.isArray(attachments) ? attachments : [];
  const hasHtml = Boolean(String(bodyHtml || "").trim());
  const inlineAttachments = hasHtml
    ? safeAttachments.filter(
        (attachment) =>
          attachment?.is_inline &&
          normalizeContentId(attachment?.content_id || attachment?.filename),
      )
    : [];
  const regularAttachments = safeAttachments.filter(
    (attachment) => !attachment?.is_inline || !hasHtml,
  );
  const hasAttachments = safeAttachments.length > 0;
  const headers = [];
  headers.push(`From: ${from}`);
  headers.push(`To: ${to.join(", ")}`);
  if (cc?.length) headers.push(`Cc: ${cc.join(", ")}`);
  if (bcc?.length) headers.push(`Bcc: ${bcc.join(", ")}`);
  headers.push(`Subject: ${subject}`);
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
  headers.push("MIME-Version: 1.0");

  const plainBodyBase64 = chunkBase64(
    Buffer.from(String(bodyText || ""), "utf-8").toString("base64"),
  );
  const htmlBodyBase64 = chunkBase64(
    Buffer.from(String(bodyHtml || ""), "utf-8").toString("base64"),
  );

  if (!hasAttachments && !hasHtml) {
    headers.push(`Content-Type: text/plain; charset="UTF-8"`);
    headers.push("Content-Transfer-Encoding: base64");
    return toBase64Url(`${headers.join("\r\n")}\r\n\r\n${plainBodyBase64}`);
  }

  const mixedBoundary = `mix_${crypto.randomBytes(12).toString("hex")}`;
  const altBoundary = `alt_${crypto.randomBytes(12).toString("hex")}`;
  const relatedBoundary = `rel_${crypto.randomBytes(12).toString("hex")}`;
  const lines = [...headers];

  if (hasAttachments) {
    lines.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
    lines.push("");
    lines.push(`--${mixedBoundary}`);
  } else {
    lines.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    lines.push("");
  }

  if (hasHtml && inlineAttachments.length) {
    lines.push(`Content-Type: multipart/related; boundary="${relatedBoundary}"`);
    lines.push("");
    lines.push(`--${relatedBoundary}`);
  }

  lines.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
  lines.push("");
  lines.push(`--${altBoundary}`);
  lines.push(`Content-Type: text/plain; charset="UTF-8"`);
  lines.push("Content-Transfer-Encoding: base64");
  lines.push("");
  lines.push(plainBodyBase64);

  if (hasHtml) {
    lines.push(`--${altBoundary}`);
    lines.push(`Content-Type: text/html; charset="UTF-8"`);
    lines.push("Content-Transfer-Encoding: base64");
    lines.push("");
    lines.push(htmlBodyBase64);
  }

  lines.push(`--${altBoundary}--`);

  if (hasHtml && inlineAttachments.length) {
    inlineAttachments.forEach((attachment, index) => {
      const filename = String(attachment?.filename || "").trim() || `inline-${index + 1}`;
      const mimeType = String(attachment?.mime_type || "").trim() || "application/octet-stream";
      const content = chunkBase64(sanitizeBase64(attachment?.content_base64));
      const contentId = normalizeContentId(
        attachment?.content_id || attachment?.filename,
        `inline-${index + 1}`,
      ) || `inline-${index + 1}`;
      lines.push("");
      lines.push(`--${relatedBoundary}`);
      lines.push(`Content-Type: ${mimeType}; name="${filename}"`);
      lines.push(`Content-Disposition: inline; filename="${filename}"`);
      lines.push(`Content-ID: <${contentId}>`);
      lines.push("Content-Transfer-Encoding: base64");
      lines.push("");
      lines.push(content);
    });
    lines.push(`--${relatedBoundary}--`);
  }

  if (hasAttachments) {
    regularAttachments.forEach((attachment, index) => {
      const filename = String(attachment?.filename || "").trim() || `attachment-${index + 1}`;
      const mimeType = String(attachment?.mime_type || "").trim() || "application/octet-stream";
      const content = chunkBase64(sanitizeBase64(attachment?.content_base64));
      lines.push("");
      lines.push(`--${mixedBoundary}`);
      lines.push(`Content-Type: ${mimeType}; name="${filename}"`);
      lines.push(`Content-Disposition: attachment; filename="${filename}"`);
      lines.push("Content-Transfer-Encoding: base64");
      lines.push("");
      lines.push(content);
    });
    lines.push(`--${mixedBoundary}--`);
  }

  return toBase64Url(lines.join("\r\n"));
}
