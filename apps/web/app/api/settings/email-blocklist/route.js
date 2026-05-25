import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope } from "@/lib/server/workspace-auth";

const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  ""
).replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

const MATCHER_TYPES = new Set(["email", "domain"]);

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function asString(value, fallback = "") {
  const next = typeof value === "string" ? value.trim() : "";
  return next || fallback;
}

function normalizeMatcherType(value) {
  const next = asString(value).toLowerCase();
  return MATCHER_TYPES.has(next) ? next : "";
}

function normalizeEmail(value) {
  const email = asString(value).toLowerCase();
  if (!email) return "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function normalizeDomain(value) {
  const raw = asString(value).toLowerCase().replace(/^@+/, "");
  if (!raw) return "";
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(raw)) return "";
  if (raw.includes("..") || raw.startsWith(".") || raw.endsWith(".")) return "";
  return raw;
}

function normalizeMatcherValue(matcherType, matcherValue) {
  if (matcherType === "email") return normalizeEmail(matcherValue);
  if (matcherType === "domain") return normalizeDomain(matcherValue);
  return "";
}

function normalizeNote(value) {
  return asString(value).slice(0, 300);
}

function formatBlockRow(row) {
  return {
    id: row.id,
    matcher_type: asString(row.matcher_type).toLowerCase(),
    matcher_value: asString(row.matcher_value).toLowerCase(),
    note: asString(row.note),
    is_active: Boolean(row.is_active),
    updated_at: row.updated_at || null,
    created_at: row.created_at || null,
  };
}

function isMissingTableError(error) {
  const message = String(error?.message || "");
  return /relation .*workspace_email_blocklist.* does not exist/i.test(message);
}

async function resolveScope(serviceClient) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), scope: null };
  }
  const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  if (!scope.workspaceId) {
    return {
      error: NextResponse.json({ error: "Workspace scope not found." }, { status: 404 }),
      scope: null,
    };
  }
  return { error: null, scope };
}

export async function GET() {
  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  try {
    const { error, scope } = await resolveScope(serviceClient);
    if (error) return error;

    const { data, error: queryError } = await serviceClient
      .from("workspace_email_blocklist")
      .select("id, matcher_type, matcher_value, note, is_active, created_at, updated_at")
      .eq("workspace_id", scope.workspaceId)
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false });
    if (queryError) throw new Error(queryError.message);

    return NextResponse.json(
      { blocks: (Array.isArray(data) ? data : []).map(formatBlockRow) },
      { status: 200 }
    );
  } catch (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json(
        { error: "Table workspace_email_blocklist is missing. Run the blocklist migration first." },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load blocked senders." },
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
    const { error, scope } = await resolveScope(serviceClient);
    if (error) return error;

    const matcherType = normalizeMatcherType(body?.matcher_type);
    const matcherValue = normalizeMatcherValue(matcherType, body?.matcher_value);
    if (!matcherType || !matcherValue) {
      return NextResponse.json(
        { error: "Valid matcher_type and matcher_value are required." },
        { status: 400 }
      );
    }

    const nowIso = new Date().toISOString();
    const { data: existing, error: existingError } = await serviceClient
      .from("workspace_email_blocklist")
      .select("id")
      .eq("workspace_id", scope.workspaceId)
      .eq("matcher_type", matcherType)
      .eq("matcher_value", matcherValue)
      .maybeSingle();
    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }

    if (existing?.id) {
      const { data, error: updateError } = await serviceClient
        .from("workspace_email_blocklist")
        .update({
          note: normalizeNote(body?.note),
          is_active: typeof body?.is_active === "boolean" ? body.is_active : true,
          updated_at: nowIso,
        })
        .eq("workspace_id", scope.workspaceId)
        .eq("id", existing.id)
        .select("id, matcher_type, matcher_value, note, is_active, created_at, updated_at")
        .maybeSingle();
      if (updateError || !data?.id) {
        return NextResponse.json(
          { error: updateError?.message || "Could not update blocked sender." },
          { status: 500 }
        );
      }
      return NextResponse.json({ block: formatBlockRow(data), upserted: true }, { status: 200 });
    }

    const { data, error: insertError } = await serviceClient
      .from("workspace_email_blocklist")
      .insert({
        workspace_id: scope.workspaceId,
        matcher_type: matcherType,
        matcher_value: matcherValue,
        note: normalizeNote(body?.note),
        is_active: typeof body?.is_active === "boolean" ? body.is_active : true,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select("id, matcher_type, matcher_value, note, is_active, created_at, updated_at")
      .maybeSingle();

    if (insertError || !data?.id) {
      return NextResponse.json(
        { error: insertError?.message || "Could not create blocked sender." },
        { status: 500 }
      );
    }

    return NextResponse.json({ block: formatBlockRow(data), upserted: false }, { status: 201 });
  } catch (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json(
        { error: "Table workspace_email_blocklist is missing. Run the blocklist migration first." },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save blocked sender." },
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

  const blockId = asString(body?.id);
  if (!blockId) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  try {
    const { error, scope } = await resolveScope(serviceClient);
    if (error) return error;

    const { data: existing, error: existingError } = await serviceClient
      .from("workspace_email_blocklist")
      .select("id, matcher_type, matcher_value, note, is_active")
      .eq("workspace_id", scope.workspaceId)
      .eq("id", blockId)
      .maybeSingle();
    if (existingError || !existing?.id) {
      return NextResponse.json(
        { error: existingError?.message || "Blocked sender not found." },
        { status: 404 }
      );
    }

    const nextMatcherType =
      body?.matcher_type !== undefined
        ? normalizeMatcherType(body?.matcher_type)
        : normalizeMatcherType(existing?.matcher_type);
    const nextMatcherValue =
      body?.matcher_value !== undefined
        ? normalizeMatcherValue(nextMatcherType, body?.matcher_value)
        : normalizeMatcherValue(nextMatcherType, existing?.matcher_value);

    if (!nextMatcherType || !nextMatcherValue) {
      return NextResponse.json(
        { error: "Valid matcher_type and matcher_value are required." },
        { status: 400 }
      );
    }

    const { data: conflict, error: conflictError } = await serviceClient
      .from("workspace_email_blocklist")
      .select("id")
      .eq("workspace_id", scope.workspaceId)
      .eq("matcher_type", nextMatcherType)
      .eq("matcher_value", nextMatcherValue)
      .neq("id", blockId)
      .maybeSingle();
    if (conflictError) {
      return NextResponse.json({ error: conflictError.message }, { status: 500 });
    }
    if (conflict?.id) {
      return NextResponse.json(
        { error: "A blocked sender with this matcher already exists." },
        { status: 409 }
      );
    }

    const { data, error: updateError } = await serviceClient
      .from("workspace_email_blocklist")
      .update({
        matcher_type: nextMatcherType,
        matcher_value: nextMatcherValue,
        note: body?.note !== undefined ? normalizeNote(body?.note) : normalizeNote(existing?.note),
        is_active:
          typeof body?.is_active === "boolean" ? body.is_active : Boolean(existing?.is_active),
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", scope.workspaceId)
      .eq("id", blockId)
      .select("id, matcher_type, matcher_value, note, is_active, created_at, updated_at")
      .maybeSingle();

    if (updateError || !data?.id) {
      return NextResponse.json(
        { error: updateError?.message || "Could not update blocked sender." },
        { status: 500 }
      );
    }

    return NextResponse.json({ block: formatBlockRow(data) }, { status: 200 });
  } catch (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json(
        { error: "Table workspace_email_blocklist is missing. Run the blocklist migration first." },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update blocked sender." },
      { status: 500 }
    );
  }
}

export const PATCH = PUT;

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

  const blockId = asString(body?.id) || asString(new URL(request.url).searchParams.get("id"));
  if (!blockId) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  try {
    const { error, scope } = await resolveScope(serviceClient);
    if (error) return error;

    const { data: existing, error: existingError } = await serviceClient
      .from("workspace_email_blocklist")
      .select("id")
      .eq("workspace_id", scope.workspaceId)
      .eq("id", blockId)
      .maybeSingle();
    if (existingError || !existing?.id) {
      return NextResponse.json(
        { error: existingError?.message || "Blocked sender not found." },
        { status: 404 }
      );
    }

    const { error: deleteError } = await serviceClient
      .from("workspace_email_blocklist")
      .delete()
      .eq("workspace_id", scope.workspaceId)
      .eq("id", blockId);
    if (deleteError) {
      return NextResponse.json(
        { error: deleteError.message || "Could not delete blocked sender." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, id: blockId }, { status: 200 });
  } catch (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json(
        { error: "Table workspace_email_blocklist is missing. Run the blocklist migration first." },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete blocked sender." },
      { status: 500 }
    );
  }
}
