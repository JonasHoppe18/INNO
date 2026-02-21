import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { resolveAuthScope } from "@/lib/server/workspace-auth";

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

function generateSlug() {
  return crypto.randomBytes(12).toString("base64url").toLowerCase();
}

export async function POST(request) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      {
        error: "Supabase service configuration is missing.",
        debug: {
          hasUrl: Boolean(SUPABASE_URL),
          hasServiceKey: Boolean(SUPABASE_SERVICE_ROLE_KEY),
        },
      },
      { status: 500 }
    );
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json(
      { error: "Supabase service client could not be created." },
      { status: 500 }
    );
  }

  let body = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const providerEmail = String(body?.provider_email || "").trim();
  if (!providerEmail) {
    return NextResponse.json({ error: "provider_email is required." }, { status: 400 });
  }

  let scope = null;
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!scope?.supabaseUserId) {
    return NextResponse.json({ error: "Supabase user not found." }, { status: 404 });
  }

  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const inboundSlug = generateSlug();
    const now = new Date().toISOString();
    const { data, error } = await serviceClient
      .from("mail_accounts")
      .insert({
        user_id: scope.supabaseUserId,
        workspace_id: scope.workspaceId ?? null,
        provider: "smtp",
        provider_email: providerEmail,
        inbound_slug: inboundSlug,
        status: "inactive",
        access_token_enc: "\\x",
        refresh_token_enc: "\\x",
        created_at: now,
        updated_at: now,
      })
      .select("id, provider_email, inbound_slug")
      .maybeSingle();

    if (!error && data) {
      return NextResponse.json(
        {
          id: data.id,
          provider_email: data.provider_email,
          inbound_slug: data.inbound_slug,
          forwarding_address: `${data.inbound_slug}@inbound.sona-ai.dk`,
        },
        { status: 200 }
      );
    }

    lastError = error;
    if (error && /duplicate|unique/i.test(error.message || "")) {
      continue;
    }
    break;
  }

  return NextResponse.json(
    { error: lastError?.message || "Could not create forwarding mailbox." },
    { status: 500 }
  );
}
