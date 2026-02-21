import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import nodemailer from "nodemailer";
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
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function decodeHexToString(hexValue) {
  const hex = hexValue.slice(2);
  if (!hex || hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return Buffer.from(bytes).toString("utf-8");
}

function maybeDecodeBase64String(value) {
  if (!/^[A-Za-z0-9+/=]+$/.test(value)) return null;
  if (value.length % 4 !== 0) return null;
  try {
    return Buffer.from(value, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

function getAesKey() {
  if (!ENCRYPTION_KEY) return null;
  return crypto.createHash("sha256").update(ENCRYPTION_KEY).digest();
}

function decryptToken(value) {
  if (!value || typeof value !== "string") return null;
  if (value === "\\x") return null;
  if (value.startsWith("\\x")) {
    const decoded = decodeHexToString(value);
    if (!decoded) return null;
    return maybeDecodeBase64String(decoded) ?? decoded;
  }
  if (value.includes(":")) {
    const [ivB64, dataB64] = value.split(":");
    const key = getAesKey();
    if (!key || !ivB64 || !dataB64) return null;
    try {
      const iv = Buffer.from(ivB64, "base64");
      const encrypted = Buffer.from(dataB64, "base64");
      const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      return decrypted.toString("utf-8");
    } catch {
      return null;
    }
  }
  return maybeDecodeBase64String(value) ?? value;
}

async function logAgent(serviceClient, status, detail) {
  await serviceClient.from("agent_logs").insert({
    draft_id: null,
    step_name: status === "success" ? "smtp_test_success" : "smtp_test_fail",
    step_detail: JSON.stringify(detail),
    status,
    created_at: new Date().toISOString(),
  });
}

export async function POST(request, { params }) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const mailboxId = params?.id;
  if (!mailboxId) {
    return NextResponse.json({ error: "Mailbox id is required." }, { status: 400 });
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
  if (!scope?.workspaceId && !scope?.supabaseUserId) {
    return NextResponse.json({ error: "No workspace or user scope found." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const recipient = String(body?.recipient || "").trim();

  let accountQuery = serviceClient
    .from("mail_accounts")
    .select(
      "id, user_id, workspace_id, provider, provider_email, smtp_host, smtp_port, smtp_secure, smtp_username_enc, smtp_password_enc"
    )
    .eq("id", mailboxId)
    .maybeSingle();
  accountQuery = applyScope(accountQuery, scope);
  const { data: account, error: accountError } = await accountQuery;
  if (accountError || !account) {
    return NextResponse.json({ error: "Mailbox not found." }, { status: 404 });
  }
  if (account.provider !== "smtp") {
    return NextResponse.json({ error: "SMTP test only supported for smtp mailboxes." }, { status: 400 });
  }

  const smtpUser = decryptToken(account.smtp_username_enc);
  const smtpPass = decryptToken(account.smtp_password_enc);
  if (!account.smtp_host || !account.smtp_port || !smtpUser || !smtpPass) {
    return NextResponse.json({ error: "SMTP not configured yet." }, { status: 400 });
  }

  const to = recipient || account.provider_email;
  const nowIso = new Date().toISOString();

  try {
    const transporter = nodemailer.createTransport({
      host: account.smtp_host,
      port: Number(account.smtp_port),
      secure: Boolean(account.smtp_secure),
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    await transporter.sendMail({
      from: account.provider_email,
      to,
      subject: "Sona SMTP test email",
      text: "SMTP setup verified successfully.",
      html: "<p>SMTP setup verified successfully.</p>",
    });

    let successUpdateQuery = serviceClient
      .from("mail_accounts")
      .update({
        smtp_status: "active",
        smtp_last_error: null,
        updated_at: nowIso,
      })
      .eq("id", mailboxId);
    successUpdateQuery = applyScope(successUpdateQuery, scope);
    await successUpdateQuery;

    await logAgent(serviceClient, "success", {
      mailboxId,
      provider: "smtp",
      recipient: to,
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    const safeError = String(error?.message || "SMTP test failed").slice(0, 280);
    let errorUpdateQuery = serviceClient
      .from("mail_accounts")
      .update({
        smtp_status: "error",
        smtp_last_error: safeError,
        updated_at: nowIso,
      })
      .eq("id", mailboxId);
    errorUpdateQuery = applyScope(errorUpdateQuery, scope);
    await errorUpdateQuery;

    await logAgent(serviceClient, "error", {
      mailboxId,
      provider: "smtp",
      error: safeError,
    });

    return NextResponse.json({ error: safeError }, { status: 400 });
  }
}
