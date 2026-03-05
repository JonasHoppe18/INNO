import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";

const SUPABASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function parseInlineStoragePath(value = "") {
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
}

export async function GET(request, { params }) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const attachmentId = String(params?.attachmentId || "").trim();
  if (!attachmentId) {
    return NextResponse.json({ error: "attachmentId is required." }, { status: 400 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Supabase service configuration is missing." }, { status: 500 });
  }

  let scope = null;
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let query = serviceClient
    .from("mail_attachments")
    .select("id, user_id, filename, mime_type, storage_path")
    .eq("id", attachmentId)
    .maybeSingle();
  query = applyScope(query, scope, { workspaceColumn: null, userColumn: "user_id" });
  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data?.id) {
    return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
  }

  const inline = parseInlineStoragePath(data.storage_path || "");
  if (!inline) {
    return NextResponse.json({ error: "Attachment content is unavailable." }, { status: 404 });
  }

  let bytes;
  try {
    bytes = Buffer.from(inline.contentBase64, "base64");
  } catch {
    return NextResponse.json({ error: "Attachment content is invalid." }, { status: 500 });
  }

  const filename = String(data.filename || "attachment").replace(/["\r\n]/g, "_");
  const dispositionParam = String(new URL(request.url).searchParams.get("disposition") || "")
    .trim()
    .toLowerCase();
  const dispositionType = dispositionParam === "inline" ? "inline" : "attachment";
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": String(data.mime_type || inline.mimeType || "application/octet-stream"),
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `${dispositionType}; filename="${filename}"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
