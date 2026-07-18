import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope } from "@/lib/server/workspace-auth";
import {
  normalizeActionModes,
  validateActionModes,
} from "@/lib/action-modes";

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

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

const ALLOWED_KEYS = [
  "defect_requires_photo",
  "spare_parts_workflow",
  "exchange_workflow",
];

function safeActionConfig(config = {}) {
  return {
    ...Object.fromEntries(ALLOWED_KEYS.map((key) => [key, config[key] ?? null])),
    action_modes: normalizeActionModes(config.action_modes),
  };
}

export async function GET() {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  let scope;
  try {
    scope = await resolveAuthScope(supabase, { clerkUserId, orgId });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  if (!scope?.workspaceId) {
    return NextResponse.json({ action_config: {} });
  }

  const { data } = await supabase
    .from("shops")
    .select("action_config")
    .eq("workspace_id", scope.workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const config = data?.action_config ?? {};

  return NextResponse.json({ action_config: safeActionConfig(config) });
}

export async function POST(req) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  let scope;
  try {
    scope = await resolveAuthScope(supabase, { clerkUserId, orgId });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  if (!scope?.workspaceId) {
    return NextResponse.json({ error: "No workspace found" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));

  const patch = {};
  for (const key of ALLOWED_KEYS) {
    if (key in body) patch[key] = body[key];
  }
  if ("action_modes" in body) {
    const validation = validateActionModes(body.action_modes);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    patch.action_modes = validation.value;
  }

  // Merge with existing config — never overwrite unrelated flags
  const { data: existing } = await supabase
    .from("shops")
    .select("action_config")
    .eq("workspace_id", scope.workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const merged = { ...(existing?.action_config ?? {}), ...patch };

  const { error } = await supabase
    .from("shops")
    .update({ action_config: merged })
    .eq("workspace_id", scope.workspaceId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, action_config: safeActionConfig(merged) });
}
