import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope } from "@/lib/server/workspace-auth";

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

function asString(value, fallback = "") {
  const next = typeof value === "string" ? value.trim() : "";
  return next || fallback;
}

function toNullableString(value) {
  const next = asString(value);
  return next || null;
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeSortOrder(value, fallback = 0) {
  if (Number.isFinite(Number(value))) {
    return Number(value);
  }
  return Number(fallback || 0);
}

function escapeHtml(input = "") {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function hasHtmlTag(value = "") {
  return /<[^>]+>/.test(String(value || ""));
}

function sanitizeSavedReplyHtml(value = "") {
  const allowedTags = new Set([
    "b",
    "strong",
    "i",
    "em",
    "u",
    "br",
    "p",
    "div",
    "ul",
    "ol",
    "li",
    "a",
    "img",
  ]);

  const withoutDangerousBlocks = String(value || "").replace(
    /<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\1>/gi,
    ""
  );

  const sanitized = withoutDangerousBlocks.replace(
    /<\/?([a-z0-9-]+)([^>]*)>/gi,
    (match, rawTag, rawAttrs = "") => {
      const tag = String(rawTag || "").toLowerCase();
      const isClosing = /^<\s*\//.test(match);
      if (!allowedTags.has(tag)) return "";
      if (isClosing) return `</${tag}>`;
      if (tag === "br") return "<br>";

      if (tag === "a") {
        const hrefMatch = String(rawAttrs || "").match(
          /\shref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i
        );
        const hrefRaw = hrefMatch?.[2] || hrefMatch?.[3] || hrefMatch?.[4] || "";
        const href = String(hrefRaw || "").trim();
        const safeHref =
          /^https?:\/\//i.test(href) || /^mailto:/i.test(href) ? href : "";
        if (!safeHref) return "<a>";
        return `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noreferrer noopener">`;
      }

      if (tag === "img") {
        const srcMatch = String(rawAttrs || "").match(
          /\ssrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i
        );
        const srcRaw = srcMatch?.[2] || srcMatch?.[3] || srcMatch?.[4] || "";
        const src = String(srcRaw || "").trim();
        const safeSrc = /^cid:[A-Za-z0-9._@-]+$/i.test(src) ? src : "";
        if (!safeSrc) return "";

        const altMatch = String(rawAttrs || "").match(
          /\salt\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i
        );
        const altRaw = altMatch?.[2] || altMatch?.[3] || altMatch?.[4] || "";
        const widthMatch = String(rawAttrs || "").match(
          /\swidth\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i
        );
        const widthRaw = widthMatch?.[2] || widthMatch?.[3] || widthMatch?.[4] || "";
        const heightMatch = String(rawAttrs || "").match(
          /\sheight\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i
        );
        const heightRaw = heightMatch?.[2] || heightMatch?.[3] || heightMatch?.[4] || "";
        const safeWidth = /^\d{1,4}$/.test(String(widthRaw || "").trim())
          ? String(widthRaw || "").trim()
          : "";
        const safeHeight = /^\d{1,4}$/.test(String(heightRaw || "").trim())
          ? String(heightRaw || "").trim()
          : "";
        const altAttr = altRaw ? ` alt="${escapeHtml(altRaw)}"` : "";
        const widthAttr = safeWidth ? ` width="${safeWidth}"` : "";
        const heightAttr = safeHeight ? ` height="${safeHeight}"` : "";
        return `<img src="${escapeHtml(safeSrc)}"${altAttr}${widthAttr}${heightAttr}>`;
      }

      return `<${tag}>`;
    }
  );

  return sanitized
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toStoredContent(value) {
  const raw = asString(value);
  if (!raw) return "";
  if (hasHtmlTag(raw)) {
    return sanitizeSavedReplyHtml(raw);
  }
  return escapeHtml(raw).replace(/\r\n/g, "\n").replace(/\n/g, "<br>");
}

function sanitizeBase64(value = "") {
  return String(value || "").replace(/\s+/g, "").trim();
}

function normalizeSavedReplyImageDeliveryMode(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized === "inline" ? "inline" : "attachment";
}

function normalizeContentId(value, fallback = "") {
  const cleaned = String(value || fallback || "")
    .trim()
    .replace(/^cid:/i, "")
    .replace(/[^A-Za-z0-9._@-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return cleaned || null;
}

function parseSavedReplyImage(value) {
  if (value === null) return null;
  if (!value || typeof value !== "object") return undefined;
  const filename = asString(value?.filename || "saved-reply-image");
  const mimeType = asString(value?.mime_type || value?.mimeType).toLowerCase();
  const contentBase64 = sanitizeBase64(value?.content_base64 || value?.contentBase64);
  const sizeBytes = Number(value?.size_bytes || value?.sizeBytes || 0);
  if (!mimeType || !mimeType.startsWith("image/")) {
    throw new Error("Saved reply image must be an image file.");
  }
  if (!contentBase64) {
    throw new Error("Saved reply image is missing content.");
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new Error("Saved reply image size is invalid.");
  }
  if (sizeBytes > 5 * 1024 * 1024) {
    throw new Error("Saved reply image must be 5 MB or smaller.");
  }
  const deliveryMode = normalizeSavedReplyImageDeliveryMode(
    value?.delivery_mode || value?.deliveryMode
  );
  const contentId =
    normalizeContentId(
      value?.content_id || value?.contentId,
      `saved-reply-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    ) || null;
  return {
    filename,
    mimeType,
    contentBase64,
    sizeBytes,
    delivery_mode: deliveryMode,
    content_id: contentId,
  };
}

function parseSavedReplyImages(value) {
  if (value === undefined) return undefined;
  if (value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error("Saved reply images must be an array.");
  }
  if (value.length > 10) {
    throw new Error("You can upload up to 10 images per saved reply.");
  }
  return value
    .map((item) => parseSavedReplyImage(item))
    .filter(Boolean);
}

function isSavedReplyImageValidationError(error) {
  return /Saved reply image/i.test(String(error?.message || ""));
}

const SAVED_REPLY_BASE_SELECT =
  "id, workspace_id, title, content, category, is_active, sort_order, use_count, created_at, updated_at";
const SAVED_REPLY_IMAGE_SELECT =
  `${SAVED_REPLY_BASE_SELECT}, image_filename, image_mime_type, image_content_base64, image_size_bytes, image_attachments_json`;

function isMissingSavedReplyImageColumnsError(error) {
  return /image_filename|image_mime_type|image_content_base64|image_size_bytes|image_attachments_json/i.test(
    String(error?.message || "")
  );
}

function formatSavedReply(row) {
  const imageBase64 = asString(row?.image_content_base64);
  const imageMimeType = asString(row?.image_mime_type).toLowerCase();
  const imageFilename = asString(row?.image_filename);
  const imageSizeBytes = Number(row?.image_size_bytes || 0);
  const imageAttachments = Array.isArray(row?.image_attachments_json)
    ? row.image_attachments_json
        .map((item) => {
          const filename = asString(item?.filename || "saved-reply-image");
          const mimeType = asString(item?.mime_type || item?.mimeType).toLowerCase();
          const contentBase64 = sanitizeBase64(item?.content_base64 || item?.contentBase64);
          const sizeBytes = Number(item?.size_bytes || item?.sizeBytes || 0);
          if (!mimeType.startsWith("image/") || !contentBase64) return null;
          const deliveryMode = normalizeSavedReplyImageDeliveryMode(
            item?.delivery_mode || item?.deliveryMode
          );
          const contentId = normalizeContentId(
            item?.content_id || item?.contentId,
            filename
          );
          return {
            filename,
            mime_type: mimeType,
            content_base64: contentBase64,
            size_bytes: Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : null,
            delivery_mode: deliveryMode,
            content_id: contentId,
          };
        })
        .filter(Boolean)
    : [];
  const fallbackSingleImage =
    imageBase64 && imageMimeType && imageMimeType.startsWith("image/")
      ? {
          filename: imageFilename || "saved-reply-image",
          mime_type: imageMimeType,
          content_base64: imageBase64,
          size_bytes: Number.isFinite(imageSizeBytes) && imageSizeBytes > 0 ? imageSizeBytes : null,
          delivery_mode: "attachment",
          content_id: null,
        }
      : null;
  const images = imageAttachments.length ? imageAttachments : fallbackSingleImage ? [fallbackSingleImage] : [];
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    title: asString(row.title),
    content: asString(row.content),
    category: toNullableString(row.category),
    is_active: Boolean(row.is_active),
    sort_order: Number(row.sort_order || 0),
    use_count: Number(row.use_count || 0),
    image: images[0] || null,
    images,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

function isMissingTableError(error) {
  return /relation .*saved_replies.* does not exist/i.test(String(error?.message || ""));
}

async function resolveWorkspaceScope(serviceClient) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return { scope: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  if (!scope.workspaceId) {
    return {
      scope: null,
      error: NextResponse.json({ error: "Workspace scope not found." }, { status: 404 }),
    };
  }
  return { scope, error: null };
}

export async function GET(request) {
  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  try {
    const { scope, error } = await resolveWorkspaceScope(serviceClient);
    if (error) return error;

    const activeOnly = parseBoolean(
      request?.nextUrl?.searchParams?.get("active_only"),
      false
    );

    const buildQuery = (select) => {
      let query = serviceClient
        .from("saved_replies")
        .select(select)
        .eq("workspace_id", scope.workspaceId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (activeOnly) {
        query = query.eq("is_active", true);
      }
      return query;
    };

    let { data, error: fetchError } = await buildQuery(SAVED_REPLY_IMAGE_SELECT);
    if (fetchError && isMissingSavedReplyImageColumnsError(fetchError)) {
      const fallback = await buildQuery(SAVED_REPLY_BASE_SELECT);
      data = fallback.data;
      fetchError = fallback.error;
    }
    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    const replies = (Array.isArray(data) ? data : []).map(formatSavedReply);
    return NextResponse.json({ replies }, { status: 200 });
  } catch (error) {
    if (isSavedReplyImageValidationError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid saved reply image." },
        { status: 400 }
      );
    }
    if (isMissingTableError(error)) {
      return NextResponse.json(
        { error: "Table saved_replies is missing. Run the SQL migration first." },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load saved replies." },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  let body = {};
  try {
    body = (await request.json()) || {};
  } catch {
    body = {};
  }

  try {
    const { scope, error } = await resolveWorkspaceScope(serviceClient);
    if (error) return error;

    const title = asString(body?.title);
    const content = toStoredContent(body?.content);
    if (!title) {
      return NextResponse.json({ error: "title is required." }, { status: 400 });
    }
    if (!content) {
      return NextResponse.json({ error: "content is required." }, { status: 400 });
    }

    const parsedImage = parseSavedReplyImage(body?.image);
    const parsedImagesRaw = parseSavedReplyImages(body?.images);
    const parsedImages =
      parsedImagesRaw !== undefined ? parsedImagesRaw : parsedImage ? [parsedImage] : [];
    const firstImage = parsedImages[0] || null;
    const nowIso = new Date().toISOString();
    const insertPayload = {
      workspace_id: scope.workspaceId,
      title,
      content,
      category: toNullableString(body?.category),
      is_active: typeof body?.is_active === "boolean" ? body.is_active : true,
      sort_order: normalizeSortOrder(body?.sort_order, 0),
      created_at: nowIso,
      updated_at: nowIso,
      image_filename: firstImage ? firstImage.filename : null,
      image_mime_type: firstImage ? firstImage.mimeType : null,
      image_content_base64: firstImage ? firstImage.contentBase64 : null,
      image_size_bytes: firstImage ? firstImage.sizeBytes : null,
      image_attachments_json: parsedImages,
    };

    let { data, error: insertError } = await serviceClient
      .from("saved_replies")
      .insert(insertPayload)
      .select(SAVED_REPLY_IMAGE_SELECT)
      .maybeSingle();
    if (insertError && isMissingSavedReplyImageColumnsError(insertError)) {
      const fallbackPayload = {
        ...insertPayload,
      };
      delete fallbackPayload.image_filename;
      delete fallbackPayload.image_mime_type;
      delete fallbackPayload.image_content_base64;
      delete fallbackPayload.image_size_bytes;
      delete fallbackPayload.image_attachments_json;
      const fallback = await serviceClient
        .from("saved_replies")
        .insert(fallbackPayload)
        .select(SAVED_REPLY_BASE_SELECT)
        .maybeSingle();
      data = fallback.data;
      insertError = fallback.error;
    }

    if (insertError || !data?.id) {
      return NextResponse.json(
        { error: insertError?.message || "Could not create saved reply." },
        { status: 500 }
      );
    }

    return NextResponse.json({ reply: formatSavedReply(data) }, { status: 201 });
  } catch (error) {
    if (isSavedReplyImageValidationError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid saved reply image." },
        { status: 400 }
      );
    }
    if (isMissingTableError(error)) {
      return NextResponse.json(
        { error: "Table saved_replies is missing. Run the SQL migration first." },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create saved reply." },
      { status: 500 }
    );
  }
}

export async function PUT(request) {
  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  let body = {};
  try {
    body = (await request.json()) || {};
  } catch {
    body = {};
  }

  const id = asString(body?.id);
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  try {
    const { scope, error } = await resolveWorkspaceScope(serviceClient);
    if (error) return error;

    let { data: existing, error: existingError } = await serviceClient
      .from("saved_replies")
      .select(
        "id, title, content, category, is_active, sort_order, image_filename, image_mime_type, image_content_base64, image_size_bytes"
      )
      .eq("workspace_id", scope.workspaceId)
      .eq("id", id)
      .maybeSingle();
    if (existingError && isMissingSavedReplyImageColumnsError(existingError)) {
      const fallback = await serviceClient
        .from("saved_replies")
        .select("id, title, content, category, is_active, sort_order")
        .eq("workspace_id", scope.workspaceId)
        .eq("id", id)
        .maybeSingle();
      existing = fallback.data;
      existingError = fallback.error;
    }

    if (existingError || !existing?.id) {
      return NextResponse.json(
        { error: existingError?.message || "Saved reply not found." },
        { status: 404 }
      );
    }

    const nextTitle = asString(body?.title, asString(existing.title));
    const nextContent =
      body?.content !== undefined
        ? toStoredContent(body?.content)
        : asString(existing.content);
    if (!nextTitle) {
      return NextResponse.json({ error: "title is required." }, { status: 400 });
    }
    if (!nextContent) {
      return NextResponse.json({ error: "content is required." }, { status: 400 });
    }

    const parsedImage = parseSavedReplyImage(body?.image);
    const parsedImagesRaw = parseSavedReplyImages(body?.images);
    const hasImageUpdate = body?.images !== undefined || body?.image !== undefined;
    const parsedImages =
      parsedImagesRaw !== undefined
        ? parsedImagesRaw
        : body?.image !== undefined
          ? parsedImage
            ? [parsedImage]
            : []
          : undefined;
    const updatePayload = {
      title: nextTitle,
      content: nextContent,
      category:
        body?.category !== undefined
          ? toNullableString(body?.category)
          : toNullableString(existing.category),
      is_active:
        typeof body?.is_active === "boolean" ? body.is_active : Boolean(existing.is_active),
      sort_order:
        body?.sort_order !== undefined
          ? normalizeSortOrder(body?.sort_order, existing.sort_order)
          : normalizeSortOrder(existing.sort_order, 0),
      updated_at: new Date().toISOString(),
    };
    if (hasImageUpdate) {
      const firstImage = parsedImages?.[0] || null;
      updatePayload.image_filename = firstImage ? firstImage.filename : null;
      updatePayload.image_mime_type = firstImage ? firstImage.mimeType : null;
      updatePayload.image_content_base64 = firstImage ? firstImage.contentBase64 : null;
      updatePayload.image_size_bytes = firstImage ? firstImage.sizeBytes : null;
      updatePayload.image_attachments_json = parsedImages || [];
    }

    let { data, error: updateError } = await serviceClient
      .from("saved_replies")
      .update(updatePayload)
      .eq("workspace_id", scope.workspaceId)
      .eq("id", id)
      .select(SAVED_REPLY_IMAGE_SELECT)
      .maybeSingle();
    if (updateError && isMissingSavedReplyImageColumnsError(updateError)) {
      const fallbackPayload = { ...updatePayload };
      delete fallbackPayload.image_filename;
      delete fallbackPayload.image_mime_type;
      delete fallbackPayload.image_content_base64;
      delete fallbackPayload.image_size_bytes;
      delete fallbackPayload.image_attachments_json;
      const fallback = await serviceClient
        .from("saved_replies")
        .update(fallbackPayload)
        .eq("workspace_id", scope.workspaceId)
        .eq("id", id)
        .select(SAVED_REPLY_BASE_SELECT)
        .maybeSingle();
      data = fallback.data;
      updateError = fallback.error;
    }

    if (updateError || !data?.id) {
      return NextResponse.json(
        { error: updateError?.message || "Could not update saved reply." },
        { status: 500 }
      );
    }

    return NextResponse.json({ reply: formatSavedReply(data) }, { status: 200 });
  } catch (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json(
        { error: "Table saved_replies is missing. Run the SQL migration first." },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update saved reply." },
      { status: 500 }
    );
  }
}

export async function PATCH(request) {
  // Lightweight endpoint — just increments use_count for a reply.
  const serviceClient = createServiceClient();
  if (!serviceClient) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });

  let body = {};
  try { body = (await request.json()) || {}; } catch { body = {}; }

  const id = asString(body?.id);
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  try {
    const { scope, error } = await resolveWorkspaceScope(serviceClient);
    if (error) return error;

    await serviceClient.rpc("increment_saved_reply_use_count", {
      reply_id: id,
      workspace_id_param: scope.workspaceId,
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    // Non-critical — don't fail the user's action if tracking fails
    return NextResponse.json({ ok: true }, { status: 200 });
  }
}

export async function DELETE(request) {
  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  let body = {};
  try {
    body = (await request.json()) || {};
  } catch {
    body = {};
  }

  const id = asString(body?.id);
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  try {
    const { scope, error } = await resolveWorkspaceScope(serviceClient);
    if (error) return error;

    const { error: deleteError } = await serviceClient
      .from("saved_replies")
      .delete()
      .eq("workspace_id", scope.workspaceId)
      .eq("id", id);

    if (deleteError) {
      return NextResponse.json(
        { error: deleteError.message || "Could not delete saved reply." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json(
        { error: "Table saved_replies is missing. Run the SQL migration first." },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not delete saved reply." },
      { status: 500 }
    );
  }
}
