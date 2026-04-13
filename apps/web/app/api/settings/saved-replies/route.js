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

function formatSavedReply(row) {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    title: asString(row.title),
    content: asString(row.content),
    category: toNullableString(row.category),
    is_active: Boolean(row.is_active),
    sort_order: Number(row.sort_order || 0),
    use_count: Number(row.use_count || 0),
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

    let query = serviceClient
      .from("saved_replies")
      .select(
        "id, workspace_id, title, content, category, is_active, sort_order, use_count, created_at, updated_at"
      )
      .eq("workspace_id", scope.workspaceId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (activeOnly) {
      query = query.eq("is_active", true);
    }

    const { data, error: fetchError } = await query;
    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    const replies = (Array.isArray(data) ? data : []).map(formatSavedReply);
    return NextResponse.json({ replies }, { status: 200 });
  } catch (error) {
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
    };

    const { data, error: insertError } = await serviceClient
      .from("saved_replies")
      .insert(insertPayload)
      .select(
        "id, workspace_id, title, content, category, is_active, sort_order, created_at, updated_at"
      )
      .maybeSingle();

    if (insertError || !data?.id) {
      return NextResponse.json(
        { error: insertError?.message || "Could not create saved reply." },
        { status: 500 }
      );
    }

    return NextResponse.json({ reply: formatSavedReply(data) }, { status: 201 });
  } catch (error) {
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

    const { data: existing, error: existingError } = await serviceClient
      .from("saved_replies")
      .select("id, title, content, category, is_active, sort_order")
      .eq("workspace_id", scope.workspaceId)
      .eq("id", id)
      .maybeSingle();

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

    const { data, error: updateError } = await serviceClient
      .from("saved_replies")
      .update(updatePayload)
      .eq("workspace_id", scope.workspaceId)
      .eq("id", id)
      .select(
        "id, workspace_id, title, content, category, is_active, sort_order, created_at, updated_at"
      )
      .maybeSingle();

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
