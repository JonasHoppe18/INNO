import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { resolveAuthScope, resolveScopedShop } from "@/lib/server/workspace-auth";
import { ensureManagedSendingDomain } from "@/lib/server/managed-sending-domain";
import { buildEffectiveSharedFromEmail } from "@/lib/server/sending-identity";

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
  const requestedShopId = String(body?.shop_id || "").trim();
  if (!providerEmail) {
    return NextResponse.json({ error: "provider_email is required." }, { status: 400 });
  }

  let scope = null;
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId }, { requireExplicitWorkspace: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!scope?.supabaseUserId) {
    return NextResponse.json({ error: "Supabase user not found." }, { status: 404 });
  }
  let shop = null;
  try {
    shop = await resolveScopedShop(serviceClient, scope, requestedShopId, {
      fields: "id, shop_name, shop_domain",
      allowSingleScopedFallback: true,
      missingShopMessage: "shop_id is required to bind a forwarding mailbox in a multi-shop workspace.",
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
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
        shop_id: shop.id,
        provider: "smtp",
        provider_email: providerEmail,
        inbound_slug: inboundSlug,
        status: "inactive",
        access_token_enc: "\\x",
        refresh_token_enc: "\\x",
        metadata: {},
        created_at: now,
        updated_at: now,
      })
      .select(
        "id, provider, provider_email, inbound_slug, workspace_id, shop_id, sending_type, domain_status, metadata",
      )
      .maybeSingle();

    if (!error && data) {
      try {
        await ensureManagedSendingDomain({
          serviceClient,
          mailbox: data,
          shop,
          refreshPending: true,
        });
      } catch (provisionError) {
        console.warn(
          "Managed sender provisioning will retry on send:",
          provisionError?.message || provisionError,
        );
      }
      return NextResponse.json(
        {
          id: data.id,
          provider_email: data.provider_email,
          inbound_slug: data.inbound_slug,
          forwarding_address: `${data.inbound_slug}@inbound.sona-ai.dk`,
          shared_from_email: buildEffectiveSharedFromEmail({ mailbox: data, shop }),
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
