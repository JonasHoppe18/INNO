import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope } from "@/lib/server/workspace-auth";
import { DEFAULT_THEME, isValidTheme, normalizeThemePreference } from "@/lib/theme-options";

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
    if (!scope?.supabaseUserId) {
      return NextResponse.json({ theme_preference: DEFAULT_THEME }, { status: 200 });
    }

    const { data, error } = await serviceClient
      .from("profiles")
      .select("theme_preference")
      .eq("user_id", scope.supabaseUserId)
      .maybeSingle();
    if (error) throw new Error(error.message);

    return NextResponse.json(
      {
        theme_preference: normalizeThemePreference(data?.theme_preference, DEFAULT_THEME),
      },
      { status: 200 }
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

  let body = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const candidate = String(body?.theme_preference || "").trim().toLowerCase();
  if (!isValidTheme(candidate)) {
    return NextResponse.json({ error: "theme_preference must be one of: light, dark." }, { status: 400 });
  }

  try {
    const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
    if (!scope?.supabaseUserId) {
      return NextResponse.json({ error: "Supabase user scope not found." }, { status: 404 });
    }

    const nextTheme = normalizeThemePreference(candidate, DEFAULT_THEME);
    const nowIso = new Date().toISOString();
    const { error } = await serviceClient.from("profiles").upsert(
      {
        user_id: scope.supabaseUserId,
        clerk_user_id: clerkUserId,
        theme_preference: nextTheme,
        updated_at: nowIso,
      },
      { onConflict: "user_id" }
    );
    if (error) throw new Error(error.message);

    return NextResponse.json({ theme_preference: nextTheme }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
