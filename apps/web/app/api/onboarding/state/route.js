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

async function getShopId(serviceClient, userId) {
  const { data: workspace } = await serviceClient
    .from("workspaces")
    .select("id")
    .eq("clerk_org_id", userId?.orgId || "")
    .maybeSingle();

  let query = serviceClient
    .from("shops")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1);

  if (workspace?.id) {
    query = query.eq("workspace_id", workspace.id).is("uninstalled_at", null);
  } else {
    query = query.eq("owner_user_id", userId?.supabaseUserId || "");
  }

  const { data } = await query.maybeSingle();
  return data?.id ?? null;
}

export async function GET() {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json(
      { error: "Supabase service configuration is missing." },
      { status: 500 }
    );
  }

  let scope = null;
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const supabaseUserId = scope?.supabaseUserId ?? null;

  const nowIso = new Date().toISOString();
  const emailCountQuery = applyScope(
    serviceClient.from("mail_accounts").select("id", { count: "exact", head: true }),
    scope
  );
  const { count: emailCount } = await emailCountQuery;

  const automationCountQuery = applyScope(
    serviceClient.from("agent_automation").select("user_id", { count: "exact", head: true }),
    scope
  );
  const { count: automationCount } = await automationCountQuery;

  const shopId = await getShopId(serviceClient, { supabaseUserId, orgId: orgId ?? null });

  let firstDraftAt = null;
  if (shopId) {
    const { data: draftRow } = await serviceClient
      .from("drafts")
      .select("created_at")
      .eq("shop_id", shopId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    firstDraftAt = draftRow?.created_at ?? null;
  }

  const { data: onboardingRow } = await serviceClient
    .from("user_onboarding")
    .select("*")
    .eq("user_id", supabaseUserId)
    .maybeSingle();

  const stepEmailConnected = Boolean(onboardingRow?.step_email_connected) || (emailCount ?? 0) > 0;
  const stepShopifyConnected =
    Boolean(onboardingRow?.step_shopify_connected) || Boolean(shopId);
  const stepAiConfigured =
    Boolean(onboardingRow?.step_ai_configured) || (automationCount ?? 0) > 0;
  const firstDraftTimestamp = onboardingRow?.first_draft_at || firstDraftAt;

  const allComplete =
    stepEmailConnected && stepShopifyConnected && stepAiConfigured && Boolean(firstDraftTimestamp);

  await serviceClient
    .from("user_onboarding")
    .upsert(
      {
        user_id: supabaseUserId,
        step_email_connected: stepEmailConnected,
        step_shopify_connected: stepShopifyConnected,
        step_ai_configured: stepAiConfigured,
        first_draft_at: firstDraftTimestamp,
        completed_at: allComplete ? onboardingRow?.completed_at || nowIso : null,
        updated_at: nowIso,
      },
      { onConflict: "user_id" }
    );

  return NextResponse.json({
    steps: {
      email_connected: stepEmailConnected,
      shopify_connected: stepShopifyConnected,
      ai_configured: stepAiConfigured,
      first_draft_created: Boolean(firstDraftTimestamp),
    },
    first_draft_at: firstDraftTimestamp,
    completed: allComplete,
  });
}
