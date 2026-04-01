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

  // Signature — per bruger
  const { data: userPersona } = await supabase
    .from("agent_persona")
    .select("signature, user_id")
    .eq("user_id", scope.supabaseUserId)
    .maybeSingle();

  // Instructions + scenario — per workspace
  let workspaceSettings = null;
  if (scope?.workspaceId) {
    const { data } = await supabase
      .from("workspace_agent_settings")
      .select("persona_instructions, persona_scenario")
      .eq("workspace_id", scope.workspaceId)
      .maybeSingle();
    workspaceSettings = data;
  }

  return NextResponse.json({
    persona: {
      user_id: userPersona?.user_id ?? scope.supabaseUserId,
      signature: userPersona?.signature ?? "",
      instructions: workspaceSettings?.persona_instructions ?? "",
      scenario: workspaceSettings?.persona_scenario ?? "",
    },
  });
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
  const { signature, instructions, scenario } = body;

  // Gem signature — per bruger
  if (signature !== undefined) {
    await supabase
      .from("agent_persona")
      .upsert(
        { user_id: scope.supabaseUserId, signature },
        { onConflict: "user_id" }
      );
  }

  // Gem instructions + scenario — per workspace
  if (scope?.workspaceId && (instructions !== undefined || scenario !== undefined)) {
    const existing = await supabase
      .from("workspace_agent_settings")
      .select("workspace_id")
      .eq("workspace_id", scope.workspaceId)
      .maybeSingle();

    if (existing.data) {
      await supabase
        .from("workspace_agent_settings")
        .update({
          ...(instructions !== undefined && { persona_instructions: instructions }),
          ...(scenario !== undefined && { persona_scenario: scenario }),
          updated_at: new Date().toISOString(),
        })
        .eq("workspace_id", scope.workspaceId);
    } else {
      await supabase
        .from("workspace_agent_settings")
        .insert({
          workspace_id: scope.workspaceId,
          persona_instructions: instructions ?? "",
          persona_scenario: scenario ?? "",
        });
    }
  }

  return NextResponse.json({ ok: true });
}
