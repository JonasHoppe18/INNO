// Image types that email clients display reliably. SVG and WebP are left out on
// purpose: many clients (notably Outlook) don't render them, and SVG can carry script.
export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export const MEDIA_WARN_BYTES = 1024 * 1024;

const TYPES = {
  "image/png": { extension: "png", matches: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  "image/jpeg": { extension: "jpg", matches: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  "image/gif": {
    extension: "gif",
    matches: (b) => startsWith(b, [0x47, 0x49, 0x46, 0x38]) && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61,
  },
};

function startsWith(bytes, signature) {
  return bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

export function detectImageType(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  return Object.keys(TYPES).find((type) => TYPES[type].matches(data)) || null;
}

export function validateMediaFile({ contentType, bytes }) {
  const type = String(contentType || "").trim().toLowerCase();
  if (!TYPES[type]) throw badRequest("Images must be PNG, JPG or GIF files.");
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (!data.length) throw badRequest("The image file is empty.");
  if (data.length > MEDIA_MAX_BYTES) throw badRequest("Images must be 5 MB or smaller.");
  if (detectImageType(data) !== type) throw badRequest("The file does not match its image type.");
  return { contentType: type, extension: TYPES[type].extension };
}

const readU16BE = (b, i) => (b[i] << 8) | b[i + 1];
const readU32BE = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];

function jpegDimensions(b) {
  let offset = 2;
  while (offset + 9 < b.length) {
    if (b[offset] !== 0xff) return null;
    const marker = b[offset + 1];
    // Frame headers carry the size; skip DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { width: readU16BE(b, offset + 7), height: readU16BE(b, offset + 5) };
    }
    offset += 2 + readU16BE(b, offset + 2);
  }
  return null;
}

export function readImageDimensions(bytes, contentType) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let size = null;
  if (contentType === "image/png" && b.length >= 24) size = { width: readU32BE(b, 16), height: readU32BE(b, 20) };
  if (contentType === "image/gif" && b.length >= 10) size = { width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) };
  if (contentType === "image/jpeg") size = jpegDimensions(b);
  return size && size.width > 0 && size.height > 0 ? size : null;
}
