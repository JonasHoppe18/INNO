import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { sendPostmarkEmail } from "@/lib/server/postmark";
import { resolveAuthScope } from "@/lib/server/workspace-auth";
import {
  composeEmailBodyWithSignature,
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
const POSTMARK_FROM_EMAIL = process.env.POSTMARK_FROM_EMAIL || "support@sona-ai.dk";
const POSTMARK_FROM_NAME = process.env.POSTMARK_FROM_NAME || "Sona";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

async function loadLegacySignatureAndEmail(serviceClient, supabaseUserId) {
  if (!supabaseUserId) return { signature: "", email: "" };
  const { data, error } = await serviceClient
    .from("profiles")
    .select("signature, email")
    .eq("user_id", supabaseUserId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return {
    signature: normalizePlainText(data?.signature || ""),
    email: String(data?.email || "").trim().toLowerCase(),
  };
}

async function loadWorkspaceTestEmail(serviceClient, workspaceId) {
  if (!workspaceId) return null;
  const { data, error } = await serviceClient
    .from("workspaces")
    .select("test_email")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const testEmail = String(data?.test_email || "").trim().toLowerCase();
  return testEmail || null;
}

export async function POST(request) {
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
        { error: "Email signature test requires workspace scope." },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const legacy = await loadLegacySignatureAndEmail(serviceClient, scope.supabaseUserId);
    const savedSignatureConfig = await loadEmailSignatureConfig(serviceClient, {
      workspaceId: scope.workspaceId,
      userId: scope.supabaseUserId,
      legacySignature: legacy.signature,
    });
    const hasOverride =
      Object.prototype.hasOwnProperty.call(body || {}, "closing_text") ||
      Object.prototype.hasOwnProperty.call(body || {}, "template_html") ||
      Object.prototype.hasOwnProperty.call(body || {}, "template_text_fallback") ||
      Object.prototype.hasOwnProperty.call(body || {}, "is_active");
    const signatureConfig = hasOverride
      ? {
          closingText: normalizePlainText(
            body?.closing_text ?? savedSignatureConfig?.closingText ?? legacy.signature
          ),
          templateHtml: sanitizeEmailTemplateHtml(
            body?.template_html ?? savedSignatureConfig?.templateHtml ?? ""
          ),
          templateTextFallback: normalizePlainText(
            body?.template_text_fallback ??
              savedSignatureConfig?.templateTextFallback ??
              htmlToPlainText(body?.template_html ?? savedSignatureConfig?.templateHtml ?? "")
          ),
          isActive: body?.is_active !== false,
        }
      : savedSignatureConfig;

    const sampleBody = normalizePlainText(
      body?.sample_body_text ||
        "Hej,\n\nTak for din besked. Her er en test af jeres email-signatur template."
    );
    const composed = composeEmailBodyWithSignature({
      bodyText: sampleBody,
      bodyHtml: "",
      config: signatureConfig,
    });

    const testEmail = await loadWorkspaceTestEmail(serviceClient, scope.workspaceId);
    const recipient = testEmail || legacy.email;
    if (!recipient) {
      return NextResponse.json(
        { error: "No test recipient available. Set workspace test email or profile email first." },
        { status: 400 }
      );
    }

    const fromDisplay = `${POSTMARK_FROM_NAME} <${POSTMARK_FROM_EMAIL}>`;
    const subject = "Signature test";
    await sendPostmarkEmail({
      From: fromDisplay,
      To: recipient,
      Subject: subject,
      TextBody: composed.finalBodyText,
      HtmlBody: composed.finalBodyHtml || undefined,
    });

    return NextResponse.json(
      {
        ok: true,
        sent_to: recipient,
        subject,
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Could not send signature test email." }, { status: 500 });
  }
}
