import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope } from "@/lib/server/workspace-auth";
import { normalizeSupportLanguage } from "@/lib/translation/languages";
import { normalizeStaleDays, DEFAULT_STALE_DAYS } from "@/lib/inbox/stale-days";

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

function normalizeAutoCloseMode(value) {
  return value === "auto" ? "auto" : "approve";
}

async function getWorkspaceSettings(serviceClient, workspaceId) {
  let query = await serviceClient
    .from("workspaces")
    .select("id, test_mode, test_email, support_language, auto_close_mode, needs_attention_stale_days")
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
    auto_close_mode: data?.auto_close_mode === "auto" ? "auto" : "approve",
    needs_attention_stale_days: normalizeStaleDays(
      data?.needs_attention_stale_days ?? DEFAULT_STALE_DAYS
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
          auto_close_mode: "approve",
          needs_attention_stale_days: DEFAULT_STALE_DAYS,
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
    const autoCloseMode = normalizeAutoCloseMode(body?.auto_close_mode);
    const needsAttentionStaleDays = normalizeStaleDays(body?.needs_attention_stale_days);

    const { error: updateError } = await serviceClient
      .from("workspaces")
      .update({
        test_mode: testMode,
        test_email: testEmail,
        support_language: supportLanguage,
        auto_close_mode: autoCloseMode,
        needs_attention_stale_days: needsAttentionStaleDays,
        updated_at: nowIso,
      })
      .eq("id", scope.workspaceId);

    if (updateError) {
      const message = String(updateError.message || "");
      if (
        message.includes("updated_at") ||
        message.includes("auto_close_mode") ||
        message.includes("needs_attention_stale_days")
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
