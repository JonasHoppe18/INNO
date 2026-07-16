import convert from "heic-convert";

const HEIC_MIME_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

export const MAX_HEIC_PREVIEW_BYTES = 25 * 1024 * 1024;

export function isHeicAttachment({ filename = "", mimeType = "" } = {}) {
  const normalizedMimeType = String(mimeType || "").trim().toLowerCase();
  if (HEIC_MIME_TYPES.has(normalizedMimeType)) return true;
  return /\.(?:heic|heif)$/i.test(String(filename || "").trim());
}

export function buildHeicPreviewFilename(filename = "attachment.heic") {
  const safeFilename = String(filename || "attachment.heic").trim() || "attachment.heic";
  return /\.(?:heic|heif)$/i.test(safeFilename)
    ? safeFilename.replace(/\.(?:heic|heif)$/i, ".jpg")
    : `${safeFilename}.jpg`;
}

export async function convertHeicToJpeg(bytes, { quality = 0.82 } = {}) {
  const input = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (!input.byteLength) throw new Error("HEIC attachment is empty.");
  if (input.byteLength > MAX_HEIC_PREVIEW_BYTES) {
    throw new Error("HEIC attachment is too large to preview.");
  }

  const output = await convert({
    buffer: input,
    format: "JPEG",
    quality,
  });
  return Buffer.from(output);
}
