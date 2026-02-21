import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope } from "@/lib/server/workspace-auth";

const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || "";
const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET || "";
const MICROSOFT_REDIRECT_URI =
  process.env.MICROSOFT_REDIRECT_URI ||
  process.env.OUTLOOK_REDIRECT_URI ||
  "";
const MICROSOFT_TENANT_ID = process.env.MICROSOFT_TENANT_ID || "common";

const SUPABASE_BASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    "").replace(/\/$/, "");
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

function createServiceClient() {
  if (!SUPABASE_BASE_URL || !SUPABASE_SERVICE_KEY) return null;
  return createClient(SUPABASE_BASE_URL, SUPABASE_SERVICE_KEY);
}

function encodeToken(value) {
  return Buffer.from(value, "utf8").toString("base64");
}

export async function GET(request) {
  const { userId: clerkUserId, orgId } = auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  if (!MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET || !MICROSOFT_REDIRECT_URI) {
    return NextResponse.json(
      { error: "Microsoft OAuth configuration is missing." },
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
  tokenParams.set("client_id", MICROSOFT_CLIENT_ID);
  tokenParams.set("client_secret", MICROSOFT_CLIENT_SECRET);
  tokenParams.set("redirect_uri", MICROSOFT_REDIRECT_URI);
  tokenParams.set("grant_type", "authorization_code");
  tokenParams.set("code", code);

  const tokenRes = await fetch(
    `https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenParams.toString(),
    }
  );

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

  const meRes = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const me = await meRes.json().catch(() => null);
  const email = me?.mail || me?.userPrincipalName || null;
  if (!email) {
    return NextResponse.json(
      { error: "Could not read authenticated email address." },
      { status: 400 }
    );
  }

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

  const expiresIn = Number(tokens?.expires_in ?? 0);
  const tokenExpiresAt = new Date(Date.now() + Math.max(0, expiresIn) * 1000).toISOString();

  const { error } = await serviceClient
    .from("mail_accounts")
    .upsert(
      {
        user_id: scope.supabaseUserId,
        workspace_id: scope.workspaceId ?? null,
        provider: "outlook",
        provider_email: email,
        access_token_enc: encodeToken(tokens.access_token),
        refresh_token_enc: encodeToken(tokens.refresh_token),
        token_expires_at: tokenExpiresAt,
        status: "pending",
      },
      { onConflict: "user_id,provider" }
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.redirect(new URL("/mailboxes?success=true", request.url));
}
