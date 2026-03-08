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

const CARRIER_PROVIDER = "tracking_carriers";
const AVAILABLE_CARRIERS = ["postnord", "gls", "dao", "bring", "dhl", "ups"];

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function normalizeCarrier(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeCarrierList(value) {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set();
  const normalized = [];
  for (const item of list) {
    const carrier = normalizeCarrier(item);
    if (!carrier || !AVAILABLE_CARRIERS.includes(carrier) || seen.has(carrier)) continue;
    seen.add(carrier);
    normalized.push(carrier);
  }
  return normalized;
}

async function loadCarrierIntegration(serviceClient, scope) {
  let query = serviceClient
    .from("integrations")
    .select("id, config")
    .eq("provider", CARRIER_PROVIDER)
    .order("updated_at", { ascending: false })
    .limit(1);
  query = applyScope(query, scope);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
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
    if (!scope.workspaceId && !scope.supabaseUserId) {
      return NextResponse.json({ error: "Workspace/user scope not found." }, { status: 404 });
    }

    const integration = await loadCarrierIntegration(serviceClient, scope);
    const selectedCarriers = normalizeCarrierList(integration?.config?.selected_carriers);
    return NextResponse.json(
      { available_carriers: AVAILABLE_CARRIERS, selected_carriers: selectedCarriers },
      { status: 200 },
    );
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

  const body = await request.json().catch(() => ({}));

  try {
    const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
    if (!scope.workspaceId && !scope.supabaseUserId) {
      return NextResponse.json({ error: "Workspace/user scope not found." }, { status: 404 });
    }

    const selectedCarriers = normalizeCarrierList(body?.selected_carriers);
    const payload = {
      provider: CARRIER_PROVIDER,
      user_id: scope.supabaseUserId || null,
      workspace_id: scope.workspaceId || null,
      is_active: true,
      config: { selected_carriers: selectedCarriers },
      updated_at: new Date().toISOString(),
    };
    const onConflict = scope.workspaceId ? "workspace_id,provider" : "user_id,provider";

    const { error } = await serviceClient.from("integrations").upsert(payload, { onConflict });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(
      { available_carriers: AVAILABLE_CARRIERS, selected_carriers: selectedCarriers },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

