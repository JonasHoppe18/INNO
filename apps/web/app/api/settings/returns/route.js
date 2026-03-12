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

const DEFAULTS = {
  return_window_days: 30,
  return_shipping_mode: "customer_paid",
  return_address: null,
};

const asString = (value) => (typeof value === "string" ? value.trim() : "");
const asInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.trunc(parsed);
  if (normalized <= 0) return fallback;
  return normalized;
};
function mapPolicyShippingMode(value = "") {
  const normalized = asString(value).toLowerCase();
  if (normalized === "customer") return "customer_paid";
  if (normalized === "merchant") return "merchant_label";
  if (normalized === "pre_printed") return "pre_printed";
  return DEFAULTS.return_shipping_mode;
}

function normalizeReturnSettings(row = {}, workspaceId = "") {
  const mode = asString(row?.return_shipping_mode).toLowerCase();
  return {
    workspace_id: workspaceId || row?.workspace_id || null,
    return_window_days: asInt(row?.return_window_days, DEFAULTS.return_window_days),
    return_shipping_mode:
      mode === "customer_paid" || mode === "merchant_label" || mode === "pre_printed"
        ? mode
        : DEFAULTS.return_shipping_mode,
    return_address: asString(row?.return_address) || null,
    created_at: row?.created_at || null,
    updated_at: row?.updated_at || null,
  };
}

async function ensureWorkspaceReturnSettings(serviceClient, workspaceId) {
  const existing = await serviceClient
    .from("workspace_return_settings")
    .select(
      "workspace_id, return_window_days, return_shipping_mode, return_address, created_at, updated_at",
    )
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (existing.data) {
    return normalizeReturnSettings(existing.data, workspaceId);
  }

  const { data: shop } = await serviceClient
    .from("shops")
    .select("policy_summary_json")
    .eq("workspace_id", workspaceId)
    .is("uninstalled_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const summary =
    shop?.policy_summary_json && typeof shop.policy_summary_json === "object"
      ? shop.policy_summary_json
      : {};
  const next = normalizeReturnSettings(
    {
      workspace_id: workspaceId,
      return_window_days: asInt(summary?.return_window_days, DEFAULTS.return_window_days),
      return_shipping_mode: mapPolicyShippingMode(summary?.return_shipping_paid_by),
      return_address: asString(summary?.return_address) || null,
    },
    workspaceId
  );
  const nowIso = new Date().toISOString();
  const inserted = await serviceClient
    .from("workspace_return_settings")
    .insert({
      workspace_id: next.workspace_id,
      return_window_days: next.return_window_days,
      return_shipping_mode: next.return_shipping_mode,
      return_address: next.return_address,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select(
      "workspace_id, return_window_days, return_shipping_mode, return_address, created_at, updated_at",
    )
    .maybeSingle();
  return normalizeReturnSettings(inserted.data || next, workspaceId);
}

export async function GET() {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }
  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Supabase service configuration is missing." }, { status: 500 });
  }
  try {
    const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
    if (!scope?.workspaceId) {
      return NextResponse.json({ error: "Workspace scope not found." }, { status: 404 });
    }
    const settings = await ensureWorkspaceReturnSettings(serviceClient, scope.workspaceId);
    return NextResponse.json({ settings }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }
  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Supabase service configuration is missing." }, { status: 500 });
  }

  let body = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  try {
    const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
    if (!scope?.workspaceId) {
      return NextResponse.json({ error: "Workspace scope not found." }, { status: 404 });
    }
    const existing = await ensureWorkspaceReturnSettings(serviceClient, scope.workspaceId);
    const mode = asString(body?.return_shipping_mode || existing.return_shipping_mode).toLowerCase();
    const next = normalizeReturnSettings(
      {
        ...existing,
        return_window_days: asInt(body?.return_window_days, existing.return_window_days),
        return_shipping_mode:
          mode === "customer_paid" || mode === "merchant_label" || mode === "pre_printed"
            ? mode
            : existing.return_shipping_mode,
        return_address: asString(body?.return_address) || null,
      },
      scope.workspaceId
    );
    const nowIso = new Date().toISOString();
    const { error: updateError } = await serviceClient
      .from("workspace_return_settings")
      .update({
        return_window_days: next.return_window_days,
        return_shipping_mode: next.return_shipping_mode,
        return_address: next.return_address,
        updated_at: nowIso,
      })
      .eq("workspace_id", scope.workspaceId);
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
    const refreshed = await ensureWorkspaceReturnSettings(serviceClient, scope.workspaceId);
    return NextResponse.json({ settings: refreshed }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
