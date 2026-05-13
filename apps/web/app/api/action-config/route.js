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

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

const ALLOWED_KEYS = [
  "defect_requires_photo",
  "spare_parts_workflow",
  "exchange_workflow",
];

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
    .maybeSingle();

  const config = data?.action_config ?? {};
  const safe = Object.fromEntries(
    ALLOWED_KEYS.map((k) => [k, config[k] ?? null])
  );

  return NextResponse.json({ action_config: safe });
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

  // Merge with existing config — never overwrite unrelated flags
  const { data: existing } = await supabase
    .from("shops")
    .select("action_config")
    .eq("workspace_id", scope.workspaceId)
    .maybeSingle();

  const merged = { ...(existing?.action_config ?? {}), ...patch };

  const { error } = await supabase
    .from("shops")
    .update({ action_config: merged })
    .eq("workspace_id", scope.workspaceId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const safe = Object.fromEntries(
    ALLOWED_KEYS.map((k) => [k, merged[k] ?? null])
  );

  return NextResponse.json({ ok: true, action_config: safe });
}
