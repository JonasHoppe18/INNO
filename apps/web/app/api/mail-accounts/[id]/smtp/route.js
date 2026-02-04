import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

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

async function resolveSupabaseUserId(serviceClient, clerkUserId) {
  const { data, error } = await serviceClient
    .from("profiles")
    .select("user_id")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.user_id ?? null;
}

function getAesKey() {
  if (!ENCRYPTION_KEY) return null;
  return crypto.createHash("sha256").update(ENCRYPTION_KEY).digest();
}

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function encryptToken(value) {
  if (!value) return "\\x";
  if (!ENCRYPTION_KEY) return Buffer.from(value, "utf-8").toString("base64");
  const key = getAesKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf-8"), cipher.final()]);
  return `${bytesToBase64(iv)}:${bytesToBase64(encrypted)}`;
}

export async function POST(request, { params }) {
  const { userId } = await auth();
  if (!userId) {
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

  const body = await request.json().catch(() => ({}));
  const smtpHost = String(body?.smtp_host || "").trim();
  const smtpPort = Number(body?.smtp_port);
  const smtpSecure = Boolean(body?.smtp_secure);
  const smtpUsername = String(body?.smtp_username || "").trim();
  const smtpPassword = String(body?.smtp_password || "").trim();

  if (!smtpHost || !Number.isFinite(smtpPort) || !smtpUsername || !smtpPassword) {
    return NextResponse.json(
      { error: "smtp_host, smtp_port, smtp_username and smtp_password are required." },
      { status: 400 }
    );
  }

  let supabaseUserId = null;
  try {
    supabaseUserId = await resolveSupabaseUserId(serviceClient, userId);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!supabaseUserId) {
    return NextResponse.json({ error: "Supabase user not found." }, { status: 404 });
  }

  const { data: account, error: accountError } = await serviceClient
    .from("mail_accounts")
    .select("id, user_id, provider")
    .eq("id", mailboxId)
    .eq("user_id", supabaseUserId)
    .maybeSingle();
  if (accountError || !account) {
    return NextResponse.json({ error: "Mailbox not found." }, { status: 404 });
  }
  if (account.provider !== "smtp") {
    return NextResponse.json({ error: "SMTP settings only supported for smtp mailboxes." }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const { error: updateError } = await serviceClient
    .from("mail_accounts")
    .update({
      smtp_host: smtpHost,
      smtp_port: smtpPort,
      smtp_secure: smtpSecure,
      smtp_username_enc: encryptToken(smtpUsername),
      smtp_password_enc: encryptToken(smtpPassword),
      smtp_status: "inactive",
      smtp_last_error: null,
      updated_at: nowIso,
    })
    .eq("id", mailboxId)
    .eq("user_id", supabaseUserId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
