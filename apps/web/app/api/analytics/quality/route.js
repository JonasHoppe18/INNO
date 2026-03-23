import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";

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

export async function GET() {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Supabase configuration missing." }, { status: 500 });
  }

  let scope;
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!scope?.workspaceId && !scope?.supabaseUserId) {
    return NextResponse.json({ error: "Could not resolve user scope." }, { status: 401 });
  }

  let query = serviceClient
    .from("drafts")
    .select("edit_classification, edit_distance, edit_delta_pct, ticket_category")
    .eq("status", "sent")
    .not("edit_classification", "is", null);

  query = applyScope(query, scope);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = Array.isArray(data) ? data : [];
  const total = rows.length;

  if (total === 0) {
    return NextResponse.json({
      total: 0,
      no_edit: 0,
      minor_edit: 0,
      major_edit: 0,
      no_edit_pct: 0,
      minor_edit_pct: 0,
      major_edit_pct: 0,
      avg_edit_distance: null,
      by_category: {},
    });
  }

  let no_edit = 0;
  let minor_edit = 0;
  let major_edit = 0;
  let distanceSum = 0;
  let distanceCount = 0;
  // delta_pct per bucket for weighted avg
  const deltaBuckets = { minor_edit: { sum: 0, count: 0 }, major_edit: { sum: 0, count: 0 } };
  const byCategory = {};

  for (const row of rows) {
    const cls = row.edit_classification;
    if (cls === "no_edit") no_edit++;
    else if (cls === "minor_edit") minor_edit++;
    else if (cls === "major_edit") major_edit++;

    if (typeof row.edit_distance === "number") {
      distanceSum += row.edit_distance;
      distanceCount++;
    }

    const deltaPct = typeof row.edit_delta_pct === "number" ? row.edit_delta_pct : null;
    if (deltaPct !== null && (cls === "minor_edit" || cls === "major_edit")) {
      deltaBuckets[cls].sum += deltaPct;
      deltaBuckets[cls].count++;
    }

    const cat = row.ticket_category || "Unknown";
    if (!byCategory[cat]) {
      byCategory[cat] = {
        total: 0, no_edit: 0, minor_edit: 0, major_edit: 0,
        delta_pct_sum: 0, delta_pct_count: 0,
      };
    }
    byCategory[cat].total++;
    if (cls === "no_edit") byCategory[cat].no_edit++;
    else if (cls === "minor_edit") byCategory[cat].minor_edit++;
    else if (cls === "major_edit") byCategory[cat].major_edit++;
    if (deltaPct !== null && cls !== "no_edit") {
      byCategory[cat].delta_pct_sum += deltaPct;
      byCategory[cat].delta_pct_count++;
    }
  }

  // Clean up internal accumulators before returning
  const byCategoryOut = Object.fromEntries(
    Object.entries(byCategory).map(([cat, c]) => {
      const avgDelta = c.delta_pct_count > 0
        ? Math.round((c.delta_pct_sum / c.delta_pct_count) * 100)
        : null;
      return [cat, { total: c.total, no_edit: c.no_edit, minor_edit: c.minor_edit, major_edit: c.major_edit, avg_changed_pct: avgDelta }];
    })
  );

  return NextResponse.json({
    total,
    no_edit,
    minor_edit,
    major_edit,
    no_edit_pct: Math.round((no_edit / total) * 100),
    minor_edit_pct: Math.round((minor_edit / total) * 100),
    major_edit_pct: Math.round((major_edit / total) * 100),
    avg_edit_distance: distanceCount > 0 ? Math.round(distanceSum / distanceCount) : null,
    avg_minor_changed_pct: deltaBuckets.minor_edit.count > 0
      ? Math.round((deltaBuckets.minor_edit.sum / deltaBuckets.minor_edit.count) * 100)
      : null,
    avg_major_changed_pct: deltaBuckets.major_edit.count > 0
      ? Math.round((deltaBuckets.major_edit.sum / deltaBuckets.major_edit.count) * 100)
      : null,
    by_category: byCategoryOut,
  });
}
