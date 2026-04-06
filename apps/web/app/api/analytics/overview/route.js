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

/**
 * Returns the current and previous period window boundaries.
 * For "all", previous is null (no comparison).
 */
function periodToWindow(period) {
  const now = new Date();
  if (!period || period === "all") {
    return {
      currentSince: null,
      currentUntil: now.toISOString(),
      previousSince: null,
      previousUntil: null,
    };
  }
  const days = parseInt(period, 10);
  const currentSince = new Date(now);
  currentSince.setDate(now.getDate() - days);
  const previousUntil = new Date(currentSince);
  const previousSince = new Date(previousUntil);
  previousSince.setDate(previousUntil.getDate() - days);
  return {
    currentSince: currentSince.toISOString(),
    currentUntil: now.toISOString(),
    previousSince: previousSince.toISOString(),
    previousUntil: previousUntil.toISOString(),
  };
}

/**
 * Fetches all analytics metrics for a given time window.
 * Uses created_at consistently across all tables.
 */
async function fetchPeriodMetrics(serviceClient, scope, since, until) {
  // Build base queries
  let threadsQ = serviceClient.from("mail_threads").select("created_at, tags");
  if (since) threadsQ = threadsQ.gte("created_at", since);
  threadsQ = threadsQ.lt("created_at", until);
  threadsQ = applyScope(threadsQ, scope);

  let draftsMadeQ = serviceClient
    .from("drafts")
    .select("id", { count: "exact", head: true });
  if (since) draftsMadeQ = draftsMadeQ.gte("created_at", since);
  draftsMadeQ = draftsMadeQ.lt("created_at", until);
  draftsMadeQ = applyScope(draftsMadeQ, scope);

  let draftsGeneratedQ = serviceClient
    .from("drafts")
    .select("id", { count: "exact", head: true })
    .not("final_reply_generated_at", "is", null);
  if (since) draftsGeneratedQ = draftsGeneratedQ.gte("created_at", since);
  draftsGeneratedQ = draftsGeneratedQ.lt("created_at", until);
  draftsGeneratedQ = applyScope(draftsGeneratedQ, scope);

  let qualityQ = serviceClient
    .from("drafts")
    .select("edit_classification, edit_delta_pct")
    .eq("status", "sent")
    .not("edit_classification", "is", null);
  if (since) qualityQ = qualityQ.gte("created_at", since);
  qualityQ = qualityQ.lt("created_at", until);
  qualityQ = applyScope(qualityQ, scope);

  let actionsQ = serviceClient.from("thread_actions").select("action_type, status");
  if (since) actionsQ = actionsQ.gte("created_at", since);
  actionsQ = actionsQ.lt("created_at", until);
  actionsQ = applyScope(actionsQ, scope);

  const [threadsResult, draftsMadeResult, draftsGeneratedResult, qualityResult, actionsResult] =
    await Promise.all([threadsQ, draftsMadeQ, draftsGeneratedQ, qualityQ, actionsQ]);

  if (threadsResult.error) throw new Error(threadsResult.error.message);
  if (draftsMadeResult.error) throw new Error(draftsMadeResult.error.message);
  if (draftsGeneratedResult.error) throw new Error(draftsGeneratedResult.error.message);
  if (qualityResult.error) throw new Error(qualityResult.error.message);
  if (actionsResult.error) throw new Error(actionsResult.error.message);

  const threadRows = Array.isArray(threadsResult.data) ? threadsResult.data : [];

  // Volume by day — based on created_at (when tickets were opened)
  const volumeMap = {};
  for (const row of threadRows) {
    const day = row.created_at ? row.created_at.slice(0, 10) : null;
    if (day) volumeMap[day] = (volumeMap[day] || 0) + 1;
  }
  const volumeByDay = Object.entries(volumeMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  // Ticket types from tags
  const tagMap = {};
  for (const row of threadRows) {
    if (Array.isArray(row.tags)) {
      for (const tag of row.tags) {
        if (tag) tagMap[tag] = (tagMap[tag] || 0) + 1;
      }
    }
  }
  const ticketTypes = Object.entries(tagMap)
    .sort(([, a], [, b]) => b - a)
    .map(([tag, count]) => ({ tag, count }));

  // Draft quality
  const qualityData = Array.isArray(qualityResult.data) ? qualityResult.data : [];
  const qualityTotal = qualityData.length;
  let no_edit = 0, minor_edit = 0, major_edit = 0;
  for (const row of qualityData) {
    if (row.edit_classification === "no_edit") no_edit++;
    else if (row.edit_classification === "minor_edit") minor_edit++;
    else if (row.edit_classification === "major_edit") major_edit++;
  }

  // Actions
  const actions = Array.isArray(actionsResult.data) ? actionsResult.data : [];
  const actionsByType = {};
  let actionsApplied = 0, actionsPending = 0, actionsDeclined = 0;
  for (const row of actions) {
    const type = row.action_type || "unknown";
    if (!actionsByType[type]) {
      actionsByType[type] = { type, total: 0, applied: 0, pending: 0, declined: 0 };
    }
    actionsByType[type].total++;
    if (row.status === "applied" || row.status === "approved_test_mode") {
      actionsByType[type].applied++;
      actionsApplied++;
    } else if (row.status === "pending") {
      actionsByType[type].pending++;
      actionsPending++;
    } else if (row.status === "declined" || row.status === "failed") {
      actionsByType[type].declined++;
      actionsDeclined++;
    }
  }
  const actionsByTypeList = Object.values(actionsByType).sort((a, b) => b.total - a.total);

  return {
    tickets_total: threadRows.length,
    drafts_made: draftsMadeResult.count ?? 0,
    drafts_generated: draftsGeneratedResult.count ?? 0,
    volume_by_day: volumeByDay,
    ticket_types: ticketTypes,
    actions: {
      total: actions.length,
      applied: actionsApplied,
      pending: actionsPending,
      declined: actionsDeclined,
      by_type: actionsByTypeList,
    },
    draft_quality: {
      total: qualityTotal,
      no_edit,
      minor_edit,
      major_edit,
      no_edit_pct: qualityTotal > 0 ? Math.round((no_edit / qualityTotal) * 100) : 0,
      minor_edit_pct: qualityTotal > 0 ? Math.round((minor_edit / qualityTotal) * 100) : 0,
      major_edit_pct: qualityTotal > 0 ? Math.round((major_edit / qualityTotal) * 100) : 0,
    },
  };
}

export async function GET(request) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period") || "30";

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Supabase configuration missing." }, { status: 500 });
  }

  let scope;
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  if (!scope?.workspaceId && !scope?.supabaseUserId) {
    return NextResponse.json({ error: "Could not resolve user scope." }, { status: 401 });
  }

  try {
    const { currentSince, currentUntil, previousSince, previousUntil } = periodToWindow(period);

    const fetchPrev = period !== "all"
      ? fetchPeriodMetrics(serviceClient, scope, previousSince, previousUntil)
      : Promise.resolve(null);

    const [current, prev] = await Promise.all([
      fetchPeriodMetrics(serviceClient, scope, currentSince, currentUntil),
      fetchPrev,
    ]);

    const previous = prev
      ? { tickets_total: prev.tickets_total, drafts_made: prev.drafts_made, actions_applied: prev.actions.applied }
      : null;

    return NextResponse.json({
      period,
      tickets_total: current.tickets_total,
      drafts_total: current.drafts_generated,   // used for time-saved calculation
      drafts_made: current.drafts_made,          // new KPI
      time_saved_minutes: current.drafts_generated * 5, // base value; frontend overrides with user setting
      volume_by_day: current.volume_by_day,
      ticket_types: current.ticket_types,
      actions: current.actions,
      draft_quality: current.draft_quality,
      previous,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
