import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope } from "@/lib/server/workspace-auth";
import {
  htmlToPlainText,
  loadEmailSignatureConfig,
  normalizePlainText,
  sanitizeEmailTemplateHtml,
} from "@/lib/server/email-signature";

const SUPABASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

async function loadLegacySignature(serviceClient, supabaseUserId) {
  if (!supabaseUserId) return "";
  const { data, error } = await serviceClient
    .from("profiles")
    .select("signature")
    .eq("user_id", supabaseUserId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return normalizePlainText(data?.signature || "");
}

function isMissingTableError(error) {
  return /workspace_email_signatures|relation .*workspace_email_signatures.*does not exist/i.test(
    String(error?.message || "")
  );
}

function isAdminLikeRole(role) {
  const normalized = String(role || "").toLowerCase();
  return normalized.includes("admin") || normalized.includes("owner");
}

async function resolveTargetUserId(serviceClient, scope, clerkUserId, requestedUserId) {
  const fallback = scope?.supabaseUserId || null;
  const candidate = String(requestedUserId || "").trim();
  if (!candidate || !UUID_REGEX.test(candidate) || candidate === fallback) {
    return fallback;
  }
  if (!scope?.workspaceId || !clerkUserId) {
    const error = new Error("Workspace scope is required.");
    error.status = 400;
    throw error;
  }

  const { data: requesterMembership, error: requesterMembershipError } = await serviceClient
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", scope.workspaceId)
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();
  if (requesterMembershipError) {
    throw new Error(requesterMembershipError.message);
  }
  if (!isAdminLikeRole(requesterMembership?.role)) {
    const error = new Error("Only admins can edit another member signature template.");
    error.status = 403;
    throw error;
  }

  const { data: targetProfile, error: targetProfileError } = await serviceClient
    .from("profiles")
    .select("user_id, clerk_user_id")
    .eq("user_id", candidate)
    .maybeSingle();
  if (targetProfileError) {
    throw new Error(targetProfileError.message);
  }
  if (!targetProfile?.user_id || !targetProfile?.clerk_user_id) {
    const error = new Error("Target member not found.");
    error.status = 404;
    throw error;
  }

  const { data: targetMembership, error: targetMembershipError } = await serviceClient
    .from("workspace_members")
    .select("clerk_user_id")
    .eq("workspace_id", scope.workspaceId)
    .eq("clerk_user_id", targetProfile.clerk_user_id)
    .maybeSingle();
  if (targetMembershipError) {
    throw new Error(targetMembershipError.message);
  }
  if (!targetMembership?.clerk_user_id) {
    const error = new Error("Target member is not part of this workspace.");
    error.status = 404;
    throw error;
  }

  return targetProfile.user_id;
}

export async function GET(request) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Supabase service configuration is missing." }, { status: 500 });
  }

  try {
    const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
    if (!scope?.workspaceId || !scope?.supabaseUserId) {
      return NextResponse.json(
        { error: "Email signatures require workspace scope." },
        { status: 400 }
      );
    }

    const requestedUserId = String(request.nextUrl.searchParams.get("user_id") || "").trim();
    const targetUserId = await resolveTargetUserId(
      serviceClient,
      scope,
      clerkUserId,
      requestedUserId
    );
    const legacySignature = await loadLegacySignature(serviceClient, targetUserId);
    const config = await loadEmailSignatureConfig(serviceClient, {
      workspaceId: scope.workspaceId,
      userId: targetUserId,
      legacySignature,
    });

    return NextResponse.json(
      {
        signature: {
          user_id: targetUserId,
          closing_text: config.closingText || "",
          template_html: config.templateHtml || "",
          template_text_fallback: config.templateTextFallback || "",
          is_active: config.isActive !== false,
          legacy_signature: legacySignature || "",
        },
      },
      { status: 200 }
    );
  } catch (error) {
    const status = Number(error?.status) || 500;
    return NextResponse.json(
      { error: error?.message || "Could not load email signature settings." },
      { status }
    );
  }
}

export async function PUT(request) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Supabase service configuration is missing." }, { status: 500 });
  }

  try {
    const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
    if (!scope?.workspaceId || !scope?.supabaseUserId) {
      return NextResponse.json(
        { error: "Email signatures require workspace scope." },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const targetUserId = await resolveTargetUserId(
      serviceClient,
      scope,
      clerkUserId,
      body?.user_id
    );

    const legacySignature = await loadLegacySignature(serviceClient, targetUserId);
    const closingText = normalizePlainText(body?.closing_text || "");
    const sanitizedTemplateHtml = sanitizeEmailTemplateHtml(body?.template_html || "");
    const templateTextFallbackRaw = normalizePlainText(body?.template_text_fallback || "");
    const templateTextFallback = templateTextFallbackRaw || htmlToPlainText(sanitizedTemplateHtml);
    const isActive = body?.is_active !== false;

    const payload = {
      workspace_id: scope.workspaceId,
      user_id: targetUserId,
      closing_text: closingText || null,
      template_html: sanitizedTemplateHtml || "",
      template_text_fallback: templateTextFallback || "",
      is_active: Boolean(isActive),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await serviceClient
      .from("workspace_email_signatures")
      .upsert(payload, {
        onConflict: "workspace_id,user_id",
      })
      .select("closing_text, template_html, template_text_fallback, is_active")
      .maybeSingle();

    if (error) {
      if (isMissingTableError(error)) {
        return NextResponse.json(
          { error: "Table workspace_email_signatures is missing. Run the SQL migration first." },
          { status: 400 }
        );
      }
      throw new Error(error.message);
    }

    return NextResponse.json(
      {
        signature: {
          user_id: targetUserId,
          closing_text: normalizePlainText(data?.closing_text || ""),
          template_html: sanitizeEmailTemplateHtml(data?.template_html || ""),
          template_text_fallback: normalizePlainText(data?.template_text_fallback || ""),
          is_active: data?.is_active !== false,
          legacy_signature: legacySignature || "",
        },
      },
      { status: 200 }
    );
  } catch (error) {
    const status = Number(error?.status) || 500;
    return NextResponse.json(
      { error: error?.message || "Could not save email signature settings." },
      { status }
    );
  }
}
