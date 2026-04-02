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

  // Signature — per bruger (fra profiles)
  const { data: profile } = await supabase
    .from("profiles")
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

  // Shop identity fields — fra shops tabellen
  let shopData = null;
  if (scope?.workspaceId) {
    const { data } = await supabase
      .from("shops")
      .select("shop_name, brand_description, support_identity")
      .eq("workspace_id", scope.workspaceId)
      .maybeSingle();
    shopData = data;
  }

  const shopName = shopData?.shop_name ?? "";
  const defaultSupportIdentity = shopName
    ? `Du er en del af ${shopName}'s supportteam. Du ER supporten — henvis aldrig kunden til "en professionel" eller "kontakt support", de har allerede kontaktet dig. Hvis problemet ikke kan løses remote, tilbyd garantiombytning eller retur.`
    : "";

  return NextResponse.json({
    persona: {
      user_id: profile?.user_id ?? scope.supabaseUserId,
      signature: profile?.signature ?? "",
      instructions: workspaceSettings?.persona_instructions ?? "",
      scenario: workspaceSettings?.persona_scenario ?? "",
      shop_name: shopName,
      brand_description: shopData?.brand_description ?? "",
      support_identity: shopData?.support_identity ?? defaultSupportIdentity,
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
  const { signature, instructions, scenario, brand_description, support_identity } = body;

  // Gem signature — per bruger (profiles)
  if (signature !== undefined) {
    await supabase
      .from("profiles")
      .update({ signature })
      .eq("user_id", scope.supabaseUserId);
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

  // Gem shop identity fields — brand_description + support_identity i shops tabellen
  if (scope?.workspaceId && (brand_description !== undefined || support_identity !== undefined)) {
    await supabase
      .from("shops")
      .update({
        ...(brand_description !== undefined && { brand_description }),
        ...(support_identity !== undefined && { support_identity }),
      })
      .eq("workspace_id", scope.workspaceId);
  }

  return NextResponse.json({ ok: true });
}
