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

function parseDataUrlStoragePath(value = "") {
  const raw = String(value || "").trim();
  if (!raw.startsWith("data:")) return null;
  const commaIndex = raw.indexOf(",");
  if (commaIndex <= 5) return null;
  const metadata = raw.slice(5, commaIndex);
  const payload = raw.slice(commaIndex + 1).replace(/\s+/g, "");
  if (!payload) return null;
  const [mimeType = "application/octet-stream"] = metadata.split(";");
  const isBase64 = /;base64/i.test(metadata);
  try {
    const bytes = isBase64
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8");
    return {
      mimeType: String(mimeType || "application/octet-stream").trim() || "application/octet-stream",
      bytes,
    };
  } catch {
    return null;
  }
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

  // Scope via mailbox_id — mail_accounts is workspace-scoped so this is safe.
  let mailboxIds = [];
  try {
    const { data: mailboxRows } = await applyScope(
      serviceClient.from("mail_accounts").select("id"),
      scope
    );
    mailboxIds = (mailboxRows || []).map((r) => r.id).filter(Boolean);
  } catch (_) {}

  let query = serviceClient
    .from("mail_attachments")
    .select("id, user_id, mailbox_id, filename, mime_type, storage_path")
    .eq("id", attachmentId);
  if (mailboxIds.length) query = query.in("mailbox_id", mailboxIds);
  query = query.maybeSingle();
  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data?.id) {
    return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
  }

  const storagePath = String(data.storage_path || "").trim();
  let bytes = null;
  let resolvedMimeType = String(data.mime_type || "").trim();

  const inline = parseInlineStoragePath(storagePath);
  if (inline) {
    try {
      bytes = Buffer.from(inline.contentBase64, "base64");
      if (!resolvedMimeType) resolvedMimeType = inline.mimeType;
    } catch {
      return NextResponse.json({ error: "Attachment content is invalid." }, { status: 500 });
    }
  }

  if (!bytes) {
    const dataUrl = parseDataUrlStoragePath(storagePath);
    if (dataUrl) {
      bytes = dataUrl.bytes;
      if (!resolvedMimeType) resolvedMimeType = dataUrl.mimeType;
    }
  }

  if (!bytes && /^https?:\/\//i.test(storagePath)) {
    const upstream = await fetch(storagePath, { method: "GET" }).catch(() => null);
    if (upstream?.ok) {
      const buffer = await upstream.arrayBuffer().catch(() => null);
      if (buffer) {
        bytes = Buffer.from(buffer);
        if (!resolvedMimeType) {
          resolvedMimeType =
            String(upstream.headers.get("content-type") || "").trim() ||
            "application/octet-stream";
        }
      }
    }
  }

  if (!bytes) {
    return NextResponse.json({ error: "Attachment content is unavailable." }, { status: 404 });
  }

  const filename = String(data.filename || "attachment").replace(/["\r\n]/g, "_");
  const dispositionParam = String(new URL(request.url).searchParams.get("disposition") || "")
    .trim()
    .toLowerCase();
  const dispositionType = dispositionParam === "inline" ? "inline" : "attachment";
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": resolvedMimeType || "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `${dispositionType}; filename="${filename}"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
