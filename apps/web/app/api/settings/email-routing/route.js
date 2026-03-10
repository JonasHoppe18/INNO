import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope } from "@/lib/server/workspace-auth";

const SUPABASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "").replace(
    /\/$/,
    ""
  );
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

const RESERVED_CATEGORY_KEYS = new Set(["support"]);

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function asString(value, fallback = "") {
  const next = typeof value === "string" ? value.trim() : "";
  return next || fallback;
}

function normalizeMode(value) {
  return asString(value).toLowerCase() === "auto_forward" ? "auto_forward" : "manual_approval";
}

function normalizeEmail(value) {
  const email = asString(value).toLowerCase();
  if (!email) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function isMissingTableError(error) {
  return /relation .*workspace_email_routes.* does not exist/i.test(String(error?.message || ""));
}

function toCategoryKey(value) {
  const base = asString(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, "")
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return base;
}

function normalizeCategoryKeyInput(value) {
  const key = toCategoryKey(value);
  if (!key || RESERVED_CATEGORY_KEYS.has(key)) return "";
  return key;
}

function readCategoryKey(value) {
  return asString(value).toLowerCase();
}

function formatRouteRow(row) {
  return {
    id: row.id,
    category_key: asString(row.category_key),
    label: asString(row.label),
    forward_to_email: asString(row.forward_to_email) || null,
    mode: normalizeMode(row.mode),
    is_active: Boolean(row.is_active),
    is_default: Boolean(row.is_default),
    sort_order: Number(row.sort_order || 0),
  };
}

async function listRoutes(serviceClient, workspaceId) {
  const { data, error } = await serviceClient
    .from("workspace_email_routes")
    .select(
      "id, workspace_id, category_key, label, forward_to_email, mode, is_active, is_default, sort_order, created_at, updated_at"
    )
    .eq("workspace_id", workspaceId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : [])
    .map((row) => ({ ...row, category_key: readCategoryKey(row?.category_key) }))
    .filter((row) => Boolean(row.category_key) && !RESERVED_CATEGORY_KEYS.has(row.category_key));
}

async function resolveAvailableCategoryKey(serviceClient, workspaceId, label, requestedKey = "") {
  const routes = await listRoutes(serviceClient, workspaceId);
  const usedKeys = new Set(routes.map((row) => asString(row.category_key)).filter(Boolean));
  const rawBase = normalizeCategoryKeyInput(requestedKey) || normalizeCategoryKeyInput(label);
  const base = rawBase || "category";
  if (!usedKeys.has(base)) return base;

  for (let i = 2; i < 500; i += 1) {
    const candidate = `${base}_${i}`.slice(0, 64);
    if (!usedKeys.has(candidate) && !RESERVED_CATEGORY_KEYS.has(candidate)) return candidate;
  }
  throw new Error("Could not generate a unique category key.");
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
    const rows = await listRoutes(serviceClient, scope.workspaceId);
    return NextResponse.json({ routes: rows.map(formatRouteRow) }, { status: 200 });
  } catch (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json(
        {
          error:
            "Table workspace_email_routes is missing. Run the SQL migration for inbound routing first.",
        },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load routes." },
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

    const label = asString(body?.label);
    if (!label) {
      return NextResponse.json({ error: "label is required." }, { status: 400 });
    }

    const categoryKey = await resolveAvailableCategoryKey(
      serviceClient,
      scope.workspaceId,
      label,
      asString(body?.category_key)
    );
    if (!categoryKey || RESERVED_CATEGORY_KEYS.has(categoryKey)) {
      return NextResponse.json({ error: "Invalid category key." }, { status: 400 });
    }

    const rows = await listRoutes(serviceClient, scope.workspaceId);
    const sortOrder =
      Number.isFinite(Number(body?.sort_order))
        ? Number(body.sort_order)
        : rows.reduce((max, row) => Math.max(max, Number(row?.sort_order || 0)), 0) + 10;

    const nowIso = new Date().toISOString();
    const insertPayload = {
      workspace_id: scope.workspaceId,
      category_key: categoryKey,
      label,
      forward_to_email: normalizeEmail(body?.forward_to_email),
      mode: normalizeMode(body?.mode),
      is_active: typeof body?.is_active === "boolean" ? body.is_active : false,
      is_default: false,
      sort_order: sortOrder,
      created_at: nowIso,
      updated_at: nowIso,
    };

    const { data, error: insertError } = await serviceClient
      .from("workspace_email_routes")
      .insert(insertPayload)
      .select(
        "id, category_key, label, forward_to_email, mode, is_active, is_default, sort_order"
      )
      .maybeSingle();

    if (insertError || !data?.id) {
      return NextResponse.json(
        { error: insertError?.message || "Could not create category." },
        { status: 500 }
      );
    }

    return NextResponse.json({ route: formatRouteRow(data) }, { status: 201 });
  } catch (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json(
        {
          error:
            "Table workspace_email_routes is missing. Run the SQL migration for inbound routing first.",
        },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create category." },
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

  const routeId = asString(body?.id);
  if (!routeId) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  try {
    const { error, scope } = await resolveScope(serviceClient);
    if (error) return error;

    const { data: existing, error: existingError } = await serviceClient
      .from("workspace_email_routes")
      .select("id, workspace_id, category_key, label, is_default, sort_order, is_active")
      .eq("workspace_id", scope.workspaceId)
      .eq("id", routeId)
      .maybeSingle();
    if (existingError || !existing?.id) {
      return NextResponse.json(
        { error: existingError?.message || "Route not found." },
        { status: 404 }
      );
    }

    const label = asString(body?.label, asString(existing.label));
    if (!label) {
      return NextResponse.json({ error: "label is required." }, { status: 400 });
    }

    const categoryKey = asString(existing.category_key).toLowerCase();
    if (!categoryKey || RESERVED_CATEGORY_KEYS.has(categoryKey)) {
      return NextResponse.json({ error: "Invalid category key." }, { status: 400 });
    }

    const updatePayload = {
      label,
      is_active: typeof body?.is_active === "boolean" ? body.is_active : Boolean(existing.is_active),
      mode: normalizeMode(body?.mode),
      forward_to_email: normalizeEmail(body?.forward_to_email),
      sort_order: Number.isFinite(Number(body?.sort_order))
        ? Number(body.sort_order)
        : Number(existing.sort_order || 0),
      updated_at: new Date().toISOString(),
    };

    const { data, error: updateError } = await serviceClient
      .from("workspace_email_routes")
      .update(updatePayload)
      .eq("workspace_id", scope.workspaceId)
      .eq("id", routeId)
      .select(
        "id, category_key, label, forward_to_email, mode, is_active, is_default, sort_order"
      )
      .maybeSingle();

    if (updateError || !data?.id) {
      return NextResponse.json(
        { error: updateError?.message || "Could not update route." },
        { status: 500 }
      );
    }

    return NextResponse.json({ route: formatRouteRow(data) }, { status: 200 });
  } catch (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json(
        {
          error:
            "Table workspace_email_routes is missing. Run the SQL migration for inbound routing first.",
        },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save route." },
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
  const routeId = asString(body?.id) || asString(new URL(request.url).searchParams.get("id"));
  if (!routeId) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  try {
    const { error, scope } = await resolveScope(serviceClient);
    if (error) return error;

    const { data: existing, error: existingError } = await serviceClient
      .from("workspace_email_routes")
      .select("id, category_key")
      .eq("workspace_id", scope.workspaceId)
      .eq("id", routeId)
      .maybeSingle();

    if (existingError || !existing?.id) {
      return NextResponse.json(
        { error: existingError?.message || "Route not found." },
        { status: 404 }
      );
    }

    if (RESERVED_CATEGORY_KEYS.has(asString(existing.category_key).toLowerCase())) {
      return NextResponse.json({ error: "support cannot be deleted." }, { status: 400 });
    }

    const { error: deleteError } = await serviceClient
      .from("workspace_email_routes")
      .delete()
      .eq("workspace_id", scope.workspaceId)
      .eq("id", routeId);
    if (deleteError) {
      return NextResponse.json(
        { error: deleteError.message || "Could not delete route." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, id: routeId }, { status: 200 });
  } catch (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json(
        {
          error:
            "Table workspace_email_routes is missing. Run the SQL migration for inbound routing first.",
        },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete route." },
      { status: 500 }
    );
  }
}
