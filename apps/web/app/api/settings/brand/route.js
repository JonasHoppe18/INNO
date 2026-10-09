import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createStatelessServiceClient } from "@/lib/server/stateless-service-client";
import { resolveSupabaseServerConfig } from "@/lib/server/supabase-server-config";
import { resolveAuthScope } from "@/lib/server/workspace-auth";
import { isWorkspaceBrandLogoUrl, normalizeAccentColor } from "@/lib/settings/brand";

const EMPTY_BRAND = { logo_url: null, accent_color: null };

function brandPayload(row) {
  return {
    logo_url: row?.brand_logo_url || null,
    accent_color: row?.brand_accent_color || null,
    workspace_found: true,
  };
}

async function resolveContext() {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return { response: NextResponse.json({ error: "You must be signed in." }, { status: 401 }) };
  }
  const config = resolveSupabaseServerConfig();
  const serviceClient = createStatelessServiceClient(config.url, config.serviceKey);
  if (!serviceClient) {
    return {
      response: NextResponse.json({ error: "Supabase service configuration is missing." }, { status: 500 }),
    };
  }
  const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  return { serviceClient, scope, supabaseUrl: config.url };
}

async function loadBrand(serviceClient, workspaceId) {
  const { data, error } = await serviceClient
    .from("workspaces")
    .select("brand_logo_url, brand_accent_color")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return brandPayload(data);
}

export async function GET() {
  try {
    const context = await resolveContext();
    if (context.response) return context.response;
    const { serviceClient, scope } = context;
    if (!scope?.workspaceId) {
      return NextResponse.json({ ...EMPTY_BRAND, workspace_found: false }, { status: 200 });
    }
    return NextResponse.json(await loadBrand(serviceClient, scope.workspaceId), { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const context = await resolveContext();
    if (context.response) return context.response;
    const { serviceClient, scope, supabaseUrl } = context;
    if (!scope?.workspaceId) {
      return NextResponse.json({ error: "Workspace scope not found." }, { status: 404 });
    }
    const body = await request.json().catch(() => null);

    let accentColor;
    try {
      accentColor = normalizeAccentColor(body?.accent_color);
    } catch (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const logoUrl = String(body?.logo_url || "").trim() || null;
    if (logoUrl && !isWorkspaceBrandLogoUrl(logoUrl, { supabaseUrl, workspaceId: scope.workspaceId })) {
      return NextResponse.json({ error: "Upload the logo again before saving." }, { status: 400 });
    }

    const { error } = await serviceClient
      .from("workspaces")
      .update({ brand_logo_url: logoUrl, brand_accent_color: accentColor })
      .eq("id", scope.workspaceId);
    if (error) throw new Error(error.message);

    return NextResponse.json(
      { logo_url: logoUrl, accent_color: accentColor, workspace_found: true },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
