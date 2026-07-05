import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

import {
  getCachedTrackingSnapshot,
  isTrackingCacheFresh,
  resolveTrackingWorkspaceId,
  trackingCacheRowToDetail,
  upsertTrackingSnapshot,
} from "@/lib/server/tracking-cache";
import { resolveAuthScope } from "@/lib/server/workspace-auth";

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

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * GET /api/threads/[threadId]/tracking/refresh
 * Query params: trackingNumber, trackingUrl, company, force
 *
 * Uses tracking_snapshots cache when fresh, otherwise calls the `fetch-tracking`
 * Supabase Edge Function to get a live snapshot from the carrier API.
 */
export async function GET(request, { params }) {
  const { userId: clerkUserId, orgId } = await auth();
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
  const force = ["1", "true", "yes"].includes(
    String(searchParams.get("force") || "").trim().toLowerCase()
  );

  if (!trackingNumber) {
    return NextResponse.json({ error: "trackingNumber is required." }, { status: 400 });
  }

  const serviceClient = createServiceClient();
  let cached = { row: null, unavailable: false };

  try {
    const scope = serviceClient
      ? await resolveAuthScope(serviceClient, { clerkUserId, orgId })
      : null;
    const workspaceId = serviceClient
      ? await resolveTrackingWorkspaceId(serviceClient, scope, params?.threadId)
      : null;
    cached = serviceClient && workspaceId
      ? await getCachedTrackingSnapshot(serviceClient, { workspaceId, trackingNumber })
      : { row: null, unavailable: false };

    if (!force && cached.row && isTrackingCacheFresh(cached.row)) {
      return NextResponse.json(
        {
          detail: trackingCacheRowToDetail(cached.row),
          cache: {
            hit: true,
            stale: false,
            unavailable: false,
            last_checked_at: cached.row.last_checked_at || null,
          },
        },
        { status: 200 }
      );
    }

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
      if (cached.row) {
        return NextResponse.json(
          {
            detail: trackingCacheRowToDetail(cached.row),
            cache: {
              hit: true,
              stale: true,
              unavailable: Boolean(cached.unavailable),
              last_checked_at: cached.row.last_checked_at || null,
              live_error: body?.error || `Tracking fetch failed (${response.status})`,
            },
          },
          { status: 200 }
        );
      }
      return NextResponse.json(
        { error: body?.error || `Tracking fetch failed (${response.status})` },
        { status: response.status }
      );
    }

    let cacheMeta = {
      hit: false,
      stale: Boolean(cached.row),
      unavailable: Boolean(cached.unavailable),
      last_checked_at: cached.row?.last_checked_at || null,
    };
    if (serviceClient && workspaceId && body?.detail) {
      const stored = await upsertTrackingSnapshot(serviceClient, {
        workspaceId,
        trackingNumber,
        trackingUrl,
        company,
        direction: searchParams.get("direction") || "unknown",
        detail: body.detail,
      });
      cacheMeta = {
        hit: false,
        stale: Boolean(cached.row),
        unavailable: Boolean(stored.unavailable),
        last_checked_at: stored.row?.last_checked_at || cacheMeta.last_checked_at,
      };
    }

    return NextResponse.json({ ...body, cache: cacheMeta }, { status: 200 });
  } catch (err) {
    if (cached.row) {
      return NextResponse.json(
        {
          detail: trackingCacheRowToDetail(cached.row),
          cache: {
            hit: true,
            stale: true,
            unavailable: Boolean(cached.unavailable),
            last_checked_at: cached.row.last_checked_at || null,
            live_error: err?.message || "Could not reach tracking service.",
          },
        },
        { status: 200 }
      );
    }
    return NextResponse.json(
      { error: err?.message || "Could not reach tracking service." },
      { status: 502 }
    );
  }
}
