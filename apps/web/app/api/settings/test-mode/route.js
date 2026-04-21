import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope } from "@/lib/server/workspace-auth";
import { normalizeSupportLanguage } from "@/lib/translation/languages";

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

function normalizeEmail(value) {
  const next = String(value || "").trim().toLowerCase();
  return next || null;
}

function parseTestMode(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  return false;
}

const DEFAULT_CLOSE_SUGGESTION_DELAY_HOURS = 24 * 14;
const MIN_CLOSE_SUGGESTION_DELAY_HOURS = 1;
const MAX_CLOSE_SUGGESTION_DELAY_HOURS = 24 * 30;

function normalizeCloseSuggestionDelayHours(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_CLOSE_SUGGESTION_DELAY_HOURS;
  const rounded = Math.round(parsed);
  return Math.max(
    MIN_CLOSE_SUGGESTION_DELAY_HOURS,
    Math.min(MAX_CLOSE_SUGGESTION_DELAY_HOURS, rounded)
  );
}

async function getWorkspaceSettings(serviceClient, workspaceId) {
  let query = await serviceClient
    .from("workspaces")
    .select("id, test_mode, test_email, support_language, close_suggestion_delay_hours")
    .eq("id", workspaceId)
    .maybeSingle();
  if (query.error?.code === "42703") {
    query = await serviceClient
      .from("workspaces")
      .select("id, test_mode, test_email, support_language")
      .eq("id", workspaceId)
      .maybeSingle();
  }
  if (query.error) throw new Error(query.error.message);
  const data = query.data;
  return {
    test_mode: Boolean(data?.test_mode),
    test_email: normalizeEmail(data?.test_email),
    support_language: normalizeSupportLanguage(data?.support_language || "en"),
    close_suggestion_delay_hours: normalizeCloseSuggestionDelayHours(
      data?.close_suggestion_delay_hours
    ),
  };
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
    if (!scope.workspaceId) {
      return NextResponse.json(
        {
          test_mode: false,
          test_email: null,
          support_language: "en",
          close_suggestion_delay_hours: DEFAULT_CLOSE_SUGGESTION_DELAY_HOURS,
          workspace_found: false,
        },
        { status: 200 }
      );
    }

    const settings = await getWorkspaceSettings(serviceClient, scope.workspaceId);
    return NextResponse.json(
      {
        ...settings,
        workspace_found: true,
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

  try {
    const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
    if (!scope.workspaceId) {
      return NextResponse.json({ error: "Workspace scope not found." }, { status: 404 });
    }

    const nowIso = new Date().toISOString();
    const testMode = parseTestMode(body?.test_mode);
    const testEmail = normalizeEmail(body?.test_email);
    const supportLanguage = normalizeSupportLanguage(body?.support_language || "en");
    const closeSuggestionDelayHours = normalizeCloseSuggestionDelayHours(
      body?.close_suggestion_delay_hours
    );

    const { error: updateError } = await serviceClient
      .from("workspaces")
      .update({
        test_mode: testMode,
        test_email: testEmail,
        support_language: supportLanguage,
        close_suggestion_delay_hours: closeSuggestionDelayHours,
        updated_at: nowIso,
      })
      .eq("id", scope.workspaceId);

    if (updateError) {
      const message = String(updateError.message || "");
      if (
        message.includes("updated_at") ||
        message.includes("close_suggestion_delay_hours")
      ) {
        const fallback = await serviceClient
          .from("workspaces")
          .update({
            test_mode: testMode,
            test_email: testEmail,
            support_language: supportLanguage,
          })
          .eq("id", scope.workspaceId);
        if (fallback.error) {
          return NextResponse.json({ error: fallback.error.message }, { status: 500 });
        }
      } else {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
    }

    const settings = await getWorkspaceSettings(serviceClient, scope.workspaceId);
    return NextResponse.json({ ...settings, workspace_found: true }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
