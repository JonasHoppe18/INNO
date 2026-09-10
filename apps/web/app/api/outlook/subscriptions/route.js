
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  buildClientState,
  createInboxSubscription,
  renewSubscription,
  getMicrosoftAccessToken,
} from "@/lib/outlook";

const SUPABASE_BASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    ""
  ).replace(/\/$/, "");
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  "";

const WEBHOOK_HOST =
  process.env.OUTLOOK_WEBHOOK_HOST ||
  process.env.MICROSOFT_WEBHOOK_HOST ||
  process.env.NEXT_PUBLIC_OUTLOOK_WEBHOOK_HOST ||
  "";

async function persistIntegration({ token, payload }) {
  if (!token || !SUPABASE_BASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false, error: "Supabase config missing" };
  }
  const response = await fetch(`${SUPABASE_BASE_URL}/rest/v1/integrations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
      Prefer: "resolution=merge-duplicates,return=representation",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

async function resolveSupabaseUserId(token, clerkUserId) {
  if (!token || !clerkUserId || !SUPABASE_BASE_URL || !SUPABASE_ANON_KEY) {
    return null;
  }

  const params = new URLSearchParams({
    select: "user_id",
    clerk_user_id: `eq.${clerkUserId}`,
    limit: "1",
  });
  const response = await fetch(
    `${SUPABASE_BASE_URL}/rest/v1/profiles?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
      },
    }
  );
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows[0]?.user_id ?? null : null;
}

export async function POST(request) {
  const { userId, getToken } = auth();
  if (!userId) {
    return NextResponse.json(
      { error: "You must be signed in to create monitoring." },
      { status: 401 }
    );
  }

  if (!WEBHOOK_HOST) {
    return NextResponse.json(
      {
        error:
          "OUTLOOK_WEBHOOK_HOST is missing. Set it to your public base URL (e.g. https://api.sona.ai).",
      },
      { status: 500 }
    );
  }

  const notificationUrl = new URL("/api/outlook/webhook", WEBHOOK_HOST).toString();
  const accessToken = await getMicrosoftAccessToken(userId);
  if (!accessToken) {
    return NextResponse.json(
      {
        error:
          "Could not fetch Microsoft access token from Clerk. Check that Microsoft login is enabled and scopes are approved.",
      },
      { status: 401 }
    );
  }

  let subscription;
  try {
    const clientState = buildClientState(userId);
    subscription = await createInboxSubscription({
      accessToken,
      notificationUrl,
      clientState,
    });
  } catch (error) {
    console.error("Create subscription failed:", error);
    return NextResponse.json(
      { error: error?.message || "Could not create subscription." },
      { status: 500 }
    );
  }

  // Forsøg at gemme subscription metadata i Supabase (valgfrit men praktisk for UI/fornyelse).
  let saved = false;
  let supabaseError = null;
  try {
    const supabaseToken = await getToken();
    const supabaseUserId = await resolveSupabaseUserId(supabaseToken, userId);
    if (supabaseToken && supabaseUserId) {
      const payload = {
        user_id: supabaseUserId,
        provider: "outlook",
        is_active: true,
        config: {
          subscription_id: subscription?.id,
          resource: subscription?.resource,
          expires_at: subscription?.expirationDateTime,
          notification_url: notificationUrl,
          client_state: subscription?.clientState,
        },
        updated_at: new Date().toISOString(),
      };
      const result = await persistIntegration({
        token: supabaseToken,
        payload,
      });
      saved = result.ok;
      if (!result.ok) {
        supabaseError =
          result?.data?.message ||
          result?.data?.error ||
          `Supabase status ${result?.status}`;
      }
    }
  } catch (error) {
    supabaseError = error?.message;
    console.warn("Saving Outlook subscription in Supabase failed:", error);
  }

  return NextResponse.json(
    {
      subscription,
      savedToSupabase: saved,
      supabaseError,
    },
    { status: 200 }
  );
}

export async function PATCH(request) {
  const { userId } = auth();
  if (!userId) {
    return NextResponse.json(
      { error: "You must be signed in to renew monitoring." },
      { status: 401 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const subscriptionId = body?.subscriptionId || body?.id;
  if (!subscriptionId) {
    return NextResponse.json(
      { error: "subscriptionId is missing in the body." },
      { status: 400 }
    );
  }

  const accessToken = await getMicrosoftAccessToken(userId);
  if (!accessToken) {
    return NextResponse.json(
      { error: "Could not fetch Microsoft token." },
      { status: 401 }
    );
  }

  try {
    const updated = await renewSubscription({ accessToken, subscriptionId });
    return NextResponse.json({ subscription: updated }, { status: 200 });
  } catch (error) {
    console.error("Renew subscription failed:", error);
    return NextResponse.json(
      { error: error?.message || "Could not renew subscription." },
      { status: 500 }
    );
  }
}
