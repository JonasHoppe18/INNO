import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";

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

export async function GET(request) {
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
    if (!scope.workspaceId && !scope.supabaseUserId) {
      return NextResponse.json({ error: "Workspace scope not found." }, { status: 404 });
    }

    const provider = String(new URL(request.url).searchParams.get("provider") || "")
      .trim()
      .toLowerCase();

    let integrationsQuery = serviceClient
      .from("integrations")
      .select("id, provider, config, is_active, created_at, updated_at")
      .order("updated_at", { ascending: false });
    integrationsQuery = applyScope(integrationsQuery, scope);
    if (provider) integrationsQuery = integrationsQuery.eq("provider", provider);

    const [{ data: integrationRows, error: integrationsError }, shopResult] = await Promise.all([
      integrationsQuery,
      provider && provider !== "shopify"
        ? Promise.resolve({ data: null, error: null })
        : (() => {
            let query = serviceClient
              .from("shops")
              .select("id, owner_user_id, shop_domain, platform, installed_at, uninstalled_at")
              .eq("platform", "shopify")
              .is("uninstalled_at", null)
              .order("created_at", { ascending: false })
              .limit(1);
            query = applyScope(query, scope, {
              workspaceColumn: "workspace_id",
              userColumn: "owner_user_id",
            });
            return query.maybeSingle();
          })(),
    ]);

    if (integrationsError) throw integrationsError;
    if (shopResult.error) throw shopResult.error;

    const integrations = Array.isArray(integrationRows) ? integrationRows : [];
    return NextResponse.json({
      integration: integrations[0] || null,
      integrations,
      shop: shopResult.data || null,
      workspace_id: scope.workspaceId,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load integration status." },
      { status: 500 }
    );
  }
}
