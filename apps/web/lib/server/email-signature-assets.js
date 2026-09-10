import { randomUUID } from "node:crypto";

export const EMAIL_SIGNATURE_IMAGE_BUCKET = "workspace-email-signature-assets";
export const EMAIL_SIGNATURE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

const IMAGE_TYPES = {
  "image/png": {
    extension: "png",
    signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  "image/jpeg": {
    extension: "jpg",
    signature: [0xff, 0xd8, 0xff],
  },
};

function normalizeContentType(value) {
  return String(value || "").trim().toLowerCase();
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  return new Uint8Array(value || []);
}

function hasSignature(bytes, signature) {
  return signature.every((byte, index) => bytes[index] === byte);
}

export function getEmailSignatureImageType(contentType) {
  return IMAGE_TYPES[normalizeContentType(contentType)] || null;
}

export function validateEmailSignatureImage({ contentType, bytes }) {
  const normalizedType = normalizeContentType(contentType);
  const type = getEmailSignatureImageType(normalizedType);
  if (!type) {
    const error = new Error("Only PNG and JPEG signature logos are supported.");
    error.status = 400;
    throw error;
  }

  const normalizedBytes = toBytes(bytes);
  if (!normalizedBytes.length || normalizedBytes.length > EMAIL_SIGNATURE_IMAGE_MAX_BYTES) {
    const error = new Error("Logo must be 5 MB or smaller.");
    error.status = 400;
    throw error;
  }
  if (!hasSignature(normalizedBytes, type.signature)) {
    const error = new Error("The uploaded logo does not match its image type.");
    error.status = 400;
    throw error;
  }

  return {
    contentType: normalizedType,
    extension: type.extension,
    bytes: normalizedBytes,
  };
}

export function buildEmailSignatureImagePath({ workspaceId, userId, contentType }) {
  const type = getEmailSignatureImageType(contentType);
  if (!type) throw new Error("Only PNG and JPEG signature logos are supported.");
  const workspaceSegment = String(workspaceId || "").trim();
  const userSegment = String(userId || "").trim();
  if (!workspaceSegment || !userSegment) throw new Error("Workspace and user scope are required.");
  return `${workspaceSegment}/${userSegment}/${randomUUID()}.${type.extension}`;
}

export function getEmailSignatureImagePublicBaseUrl(supabaseUrl = "") {
  const configuredUrl =
    String(supabaseUrl || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "")
      .trim()
      .replace(/\/+$/, "");
  let parsedBase;
  try {
    parsedBase = new URL(configuredUrl);
  } catch {
    throw new Error("Supabase URL is invalid.");
  }
  if (parsedBase.protocol !== "https:") {
    throw new Error("Signature image storage must use HTTPS.");
  }
  return `${configuredUrl}/storage/v1/object/public/${EMAIL_SIGNATURE_IMAGE_BUCKET}`;
}

export function buildPublicEmailSignatureImageUrl(supabaseUrl, objectPath) {
  const baseUrl = String(supabaseUrl || "").trim().replace(/\/+$/, "");
  const encodedPath = String(objectPath || "")
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  if (!encodedPath) throw new Error("Signature image path is required.");
  return `${getEmailSignatureImagePublicBaseUrl(baseUrl)}/${encodedPath}`;
}

export async function uploadEmailSignatureImage(
  serviceClient,
  { supabaseUrl, workspaceId, userId, file }
) {
  if (!file || typeof file.arrayBuffer !== "function") {
    const error = new Error("A PNG or JPEG logo file is required.");
    error.status = 400;
    throw error;
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const validated = validateEmailSignatureImage({ contentType: file.type, bytes });
  const objectPath = buildEmailSignatureImagePath({
    workspaceId,
    userId,
    contentType: validated.contentType,
  });
  const { error } = await serviceClient.storage
    .from(EMAIL_SIGNATURE_IMAGE_BUCKET)
    .upload(objectPath, validated.bytes, {
      cacheControl: "31536000",
      contentType: validated.contentType,
      upsert: false,
    });
  if (error) throw new Error(error.message);

  return {
    contentType: validated.contentType,
    url: buildPublicEmailSignatureImageUrl(supabaseUrl, objectPath),
  };
}
