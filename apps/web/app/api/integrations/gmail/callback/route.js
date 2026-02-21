import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope } from "@/lib/server/workspace-auth";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI || process.env.GOOGLE_OAUTH_REDIRECT_URI || "";

const SUPABASE_BASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    "").replace(/\/$/, "");
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

function encodeToken(value) {
  return Buffer.from(value, "utf8").toString("base64");
}

function createServiceClient() {
  if (!SUPABASE_BASE_URL || !SUPABASE_SERVICE_KEY) return null;
  return createClient(SUPABASE_BASE_URL, SUPABASE_SERVICE_KEY);
}

export async function GET(request) {
  const { userId: clerkUserId, orgId } = auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    return NextResponse.json(
      { error: "Google OAuth configuration is missing." },
      { status: 500 }
    );
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json(
      { error: "Supabase service configuration is missing." },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "Missing OAuth code." }, { status: 400 });
  }

  const tokenParams = new URLSearchParams();
  tokenParams.set("code", code);
  tokenParams.set("client_id", GOOGLE_CLIENT_ID);
  tokenParams.set("client_secret", GOOGLE_CLIENT_SECRET);
  tokenParams.set("redirect_uri", GOOGLE_REDIRECT_URI);
  tokenParams.set("grant_type", "authorization_code");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenParams.toString(),
  });
  const tokens = await tokenRes.json().catch(() => null);
  if (!tokenRes.ok || !tokens?.access_token) {
    return NextResponse.json({ error: "Missing access token." }, { status: 400 });
  }
  if (!tokens?.refresh_token) {
    return NextResponse.json(
      { error: "Missing refresh token. Reconnect with consent." },
      { status: 400 }
    );
  }

  const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const userInfo = await userInfoRes.json().catch(() => null);
  const email = userInfo?.email;
  if (!email) {
    return NextResponse.json(
      { error: "Could not read authenticated email address." },
      { status: 400 }
    );
  }

  const profileRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const profile = await profileRes.json().catch(() => null);
  const historyId = profile?.historyId || null;
  const expiresIn = Number(tokens?.expires_in ?? 0);
  const tokenExpiresAt = new Date(Date.now() + Math.max(0, expiresIn) * 1000).toISOString();

  let scope = null;
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Supabase user lookup failed.",
        debug: {
          clerkUserId,
          supabaseUrlHost: SUPABASE_BASE_URL ? new URL(SUPABASE_BASE_URL).host : null,
          supabaseProjectRef: SUPABASE_BASE_URL?.split(".")[0]?.replace("https://", ""),
          hadServiceClient: Boolean(serviceClient),
        },
      },
      { status: 500 }
    );
  }
  if (!scope?.supabaseUserId) {
    return NextResponse.json({ error: "Supabase user not found for this Clerk user." }, { status: 404 });
  }

  const { error } = await serviceClient
    .from("mail_accounts")
    .upsert(
      {
        user_id: scope.supabaseUserId,
        workspace_id: scope.workspaceId ?? null,
        provider: "gmail",
        provider_email: email,
        access_token_enc: encodeToken(tokens.access_token),
        refresh_token_enc: encodeToken(tokens.refresh_token),
        token_expires_at: tokenExpiresAt,
        metadata: { historyId },
        status: "pending",
      },
      { onConflict: "user_id,provider" }
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.redirect(new URL("/mailboxes?success=true", request.url));
}
