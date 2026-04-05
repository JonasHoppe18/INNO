import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  ""
).replace(/\/$/, "");

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

/**
 * GET /api/threads/[threadId]/tracking/refresh
 * Query params: trackingNumber, trackingUrl, company
 *
 * Calls the `fetch-tracking` Supabase Edge Function to get a live snapshot
 * from the carrier API (GLS, PostNord, …). Returns { detail } or { error }.
 */
export async function GET(request, { params }) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Supabase configuration is missing." },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const trackingNumber = (searchParams.get("trackingNumber") || "").trim();
  const trackingUrl = (searchParams.get("trackingUrl") || "").trim();
  const company = (searchParams.get("company") || "").trim();

  if (!trackingNumber) {
    return NextResponse.json({ error: "trackingNumber is required." }, { status: 400 });
  }

  try {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/fetch-tracking`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ trackingNumber, trackingUrl, company }),
      }
    );

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json(
        { error: body?.error || `Tracking fetch failed (${response.status})` },
        { status: response.status }
      );
    }

    return NextResponse.json(body, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: err?.message || "Could not reach tracking service." },
      { status: 502 }
    );
  }
}
