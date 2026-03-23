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

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
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

  let scope;
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!scope?.workspaceId) {
    return NextResponse.json({ error: "Workspace scope not found." }, { status: 404 });
  }

  const { workspaceId, supabaseUserId } = scope;

  // Run all checks in parallel
  const [
    returnSettingsResult,
    shopResult,
    workspaceResult,
    personaResult,
  ] = await Promise.all([
    serviceClient
      .from("workspace_return_settings")
      .select("return_address, return_window_days, updated_at, created_at")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    serviceClient
      .from("shops")
      .select("id")
      .eq("workspace_id", workspaceId)
      .is("uninstalled_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    serviceClient
      .from("workspaces")
      .select("support_language")
      .eq("id", workspaceId)
      .maybeSingle(),
    supabaseUserId
      ? serviceClient
          .from("agent_persona")
          .select("instructions")
          .eq("user_id", supabaseUserId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const returnSettings = returnSettingsResult.data;
  const shopId = shopResult.data?.id || null;
  const supportLanguage = asString(workspaceResult.data?.support_language);
  const personaInstructions = asString(personaResult.data?.instructions);

  // Check knowledge base separately (needs shopId)
  let knowledgeCount = 0;
  if (shopId) {
    const { count } = await serviceClient
      .from("agent_knowledge")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId);
    knowledgeCount = count || 0;
  }

  // Check if return settings are explicitly saved (not just seeded defaults)
  const returnSettingsSaved =
    returnSettings !== null &&
    returnSettings.created_at !== returnSettings.updated_at;
  const returnAddress = asString(returnSettings?.return_address);
  const returnAddressSet = returnAddress.length > 0;
  const returnWindowSet = returnSettingsSaved || (returnSettings?.return_window_days && returnSettings.return_window_days !== 30);

  // Build items
  const items = [
    {
      key: "return_address",
      label: "Returadresse konfigureret",
      done: returnAddressSet,
      points: 2,
      action_url: "/automation",
    },
    {
      key: "return_window",
      label: "Returvindue konfigureret",
      done: Boolean(returnWindowSet),
      points: 1,
      action_url: "/automation",
    },
    {
      key: "knowledge_base",
      label: "Vidensbase har indhold",
      done: knowledgeCount > 0,
      points: 3,
      action_url: "/knowledge",
    },
    {
      key: "persona",
      label: "Assistent-instruktioner sat",
      done: personaInstructions.length > 0,
      points: 2,
      action_url: "/automation",
    },
    {
      key: "support_language",
      label: "Supportsprog valgt",
      done: supportLanguage.length > 0,
      points: 1,
      action_url: "/settings",
    },
    {
      key: "shopify",
      label: "Shopify forbundet",
      done: shopId !== null,
      points: 1,
      action_url: "/integrations",
    },
  ];

  const score = items.reduce((sum, item) => sum + (item.done ? item.points : 0), 0);
  const max = items.reduce((sum, item) => sum + item.points, 0);
  const pct = Math.round((score / max) * 100);
  const level =
    score <= 3 ? "needs_setup" :
    score <= 5 ? "getting_started" :
    score <= 8 ? "good" :
    "ready";

  return NextResponse.json({ score, max, pct, level, items }, { status: 200 });
}
