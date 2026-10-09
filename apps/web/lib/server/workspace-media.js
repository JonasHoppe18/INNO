import { randomUUID } from "node:crypto";
import { readImageDimensions, validateMediaFile } from "@/lib/media/image-files";
import { BRAND_IMAGE_BUCKET } from "@/lib/settings/brand";
import { buildPublicEmailSignatureImageUrl } from "@/lib/server/email-signature-assets";

export const MEDIA_PAGE_SIZE = 60;
const MEDIA_COLUMNS = "id, public_url, file_name, content_type, size_bytes, width, height, created_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeMediaCursor(row) {
  return `${row.created_at}|${row.id}`;
}

export function decodeMediaCursor(value) {
  const [createdAt, id, extra] = String(value || "").split("|");
  if (extra !== undefined || !UUID.test(id || "") || Number.isNaN(Date.parse(createdAt || ""))) return null;
  return { createdAt, id };
}

// Rows are ordered by (created_at, id) descending, so the next page continues
// after the cursor even when several images share a timestamp.
export function mediaCursorFilter({ createdAt, id }) {
  return `created_at.lt."${createdAt}",and(created_at.eq."${createdAt}",id.lt.${id})`;
}

function toMediaItem(row) {
  return {
    id: row.id,
    url: row.public_url,
    file_name: row.file_name,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    width: row.width ?? null,
    height: row.height ?? null,
    created_at: row.created_at,
  };
}

export async function listWorkspaceMedia(client, workspaceId, { before } = {}) {
  let query = client
    .from("workspace_media")
    .select(MEDIA_COLUMNS)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(MEDIA_PAGE_SIZE + 1);
  const cursor = decodeMediaCursor(before);
  if (cursor) query = query.or(mediaCursorFilter(cursor));
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = Array.isArray(data) ? data : [];
  const items = rows.slice(0, MEDIA_PAGE_SIZE).map(toMediaItem);
  return {
    items,
    next_before: rows.length > MEDIA_PAGE_SIZE ? encodeMediaCursor(rows[MEDIA_PAGE_SIZE - 1]) : null,
  };
}

function cleanFileName(name) {
  const value = String(name || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 200);
  return value || "Image";
}

export async function uploadWorkspaceMedia(client, { supabaseUrl, workspaceId, userId = null, file }) {
  if (!file || typeof file.arrayBuffer !== "function") {
    const error = new Error("Choose an image to upload.");
    error.status = 400;
    throw error;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { contentType, extension } = validateMediaFile({ contentType: file.type, bytes });
  const dimensions = readImageDimensions(bytes, contentType);
  const storagePath = `${workspaceId}/media/${randomUUID()}.${extension}`;
  const bucket = client.storage.from(BRAND_IMAGE_BUCKET);
  const { error: uploadError } = await bucket.upload(storagePath, bytes, {
    cacheControl: "31536000",
    contentType,
    upsert: false,
  });
  if (uploadError) throw new Error(uploadError.message);

  const { data, error } = await client
    .from("workspace_media")
    .insert({
      workspace_id: workspaceId,
      storage_path: storagePath,
      public_url: buildPublicEmailSignatureImageUrl(supabaseUrl, storagePath),
      file_name: cleanFileName(file.name),
      content_type: contentType,
      size_bytes: bytes.length,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      uploaded_by: userId || null,
    })
    .select(MEDIA_COLUMNS)
    .single();
  if (error) {
    await bucket.remove([storagePath]);
    throw new Error(error.message);
  }
  return toMediaItem(data);
}

// Hides the image from the library. The file stays, so sent emails and saved
// designs that use it keep working.
export async function softDeleteWorkspaceMedia(client, workspaceId, id) {
  if (!UUID.test(String(id || ""))) return false;
  const { data, error } = await client
    .from("workspace_media")
    .update({ deleted_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .is("deleted_at", null)
    .select("id");
  if (error) throw new Error(error.message);
  return Array.isArray(data) && data.length > 0;
}

export async function findActiveWorkspaceMediaByUrl(client, workspaceId, url) {
  const value = String(url || "").trim();
  if (!value || !workspaceId) return null;
  const { data, error } = await client
    .from("workspace_media")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("public_url", value)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}
