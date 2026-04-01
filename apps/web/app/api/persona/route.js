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

async function resolvePersona(supabase, scope) {
  // Forsøg workspace-opslag først
  if (scope?.workspaceId) {
    const { data } = await supabase
      .from("agent_persona")
      .select("*")
      .eq("workspace_id", scope.workspaceId)
      .maybeSingle();
    if (data) return data;
  }

  // Fallback til user_id
  if (scope?.supabaseUserId) {
    const { data } = await supabase
      .from("agent_persona")
      .select("*")
      .eq("user_id", scope.supabaseUserId)
      .maybeSingle();
    if (data) return data;
  }

  return null;
}

export async function GET() {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  let scope;
  try {
    scope = await resolveAuthScope(supabase, { clerkUserId, orgId });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  const data = await resolvePersona(supabase, scope);
  return NextResponse.json({ persona: data ?? null });
}

export async function POST(req) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  let scope;
  try {
    scope = await resolveAuthScope(supabase, { clerkUserId, orgId });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const { signature, scenario, instructions } = body;

  const existing = await resolvePersona(supabase, scope);

  if (existing) {
    // Opdater eksisterende — brug workspace_id hvis muligt
    const filter = scope?.workspaceId && existing.workspace_id
      ? { workspace_id: scope.workspaceId }
      : { user_id: existing.user_id };

    const { data, error } = await supabase
      .from("agent_persona")
      .update({
        signature: signature ?? existing.signature,
        scenario: scenario ?? existing.scenario,
        instructions: instructions ?? existing.instructions,
        workspace_id: scope?.workspaceId ?? existing.workspace_id,
        updated_at: new Date().toISOString(),
      })
      .match(filter)
      .select()
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ persona: data });
  }

  // Opret ny persona til workspace
  const { data, error } = await supabase
    .from("agent_persona")
    .insert({
      user_id: scope.supabaseUserId,
      workspace_id: scope?.workspaceId ?? null,
      signature: signature ?? "",
      scenario: scenario ?? "",
      instructions: instructions ?? "",
    })
    .select()
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ persona: data });
}
