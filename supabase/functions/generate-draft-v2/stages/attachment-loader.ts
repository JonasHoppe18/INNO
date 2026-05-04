// supabase/functions/generate-draft-v2/stages/attachment-loader.ts
import { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export interface InlineImageAttachment {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
}

function parseInlineStoragePath(
  storagePath: unknown,
): { mimeType: string; contentBase64: string } | null {
  if (typeof storagePath !== "string") return null;
  const path = storagePath.trim();
  if (path.startsWith("inline:")) {
    const rest = path.slice("inline:".length);
    const semiIdx = rest.indexOf(";base64,");
    if (semiIdx === -1) return null;
    return {
      mimeType: rest.slice(0, semiIdx),
      contentBase64: rest.slice(semiIdx + ";base64,".length),
    };
  }
  if (path.startsWith("data:")) {
    const semiIdx = path.indexOf(";base64,");
    if (semiIdx === -1) return null;
    return {
      mimeType: path.slice("data:".length, semiIdx),
      contentBase64: path.slice(semiIdx + ";base64,".length),
    };
  }
  return null;
}

const MAX_IMAGES = 3;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;

export async function loadImageAttachments(
  supabase: SupabaseClient,
  messageId: string,
): Promise<InlineImageAttachment[]> {
  if (!messageId) return [];

  const { data: rows, error } = await supabase
    .from("mail_attachments")
    .select("filename, mime_type, size_bytes, storage_path")
    .eq("message_id", messageId)
    .order("created_at", { ascending: true })
    .limit(8);

  if (error || !Array.isArray(rows) || !rows.length) return [];

  const accepted: InlineImageAttachment[] = [];
  let totalBytes = 0;

  for (const row of rows) {
    if (accepted.length >= MAX_IMAGES) break;
    const mimeType = String(row?.mime_type || "").toLowerCase();
    if (!mimeType.startsWith("image/")) continue;
    const parsed = parseInlineStoragePath(row?.storage_path);
    if (!parsed) continue;
    const bytes = Math.floor((parsed.contentBase64.length * 3) / 4);
    if (bytes <= 0) continue;
    if (totalBytes + bytes > MAX_TOTAL_BYTES) break;
    totalBytes += bytes;
    accepted.push({
      filename: String(row?.filename || "image").trim() || "image",
      mimeType: parsed.mimeType,
      sizeBytes: Number.isFinite(Number(row?.size_bytes))
        ? Number(row?.size_bytes)
        : bytes,
      dataUrl: `data:${parsed.mimeType};base64,${parsed.contentBase64}`,
    });
  }

  return accepted;
}
