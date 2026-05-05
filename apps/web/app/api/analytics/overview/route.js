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
  let threadsQ = serviceClient.from("mail_threads").select("id, created_at");
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
    .select("thread_id, edit_classification, edit_delta_pct")
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
  const threadIds = threadRows.map((r) => r.id).filter(Boolean);

  // Volume by day — based on created_at (when tickets were opened)
  const volumeMap = {};
  for (const row of threadRows) {
    const day = row.created_at ? row.created_at.slice(0, 10) : null;
    if (day) volumeMap[day] = (volumeMap[day] || 0) + 1;
  }
  const volumeByDay = Object.entries(volumeMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  // Ticket types fra workspace_tags via thread_tag_assignments
  let ticketTypes = [];
  if (threadIds.length > 0) {
    const { data: tagAssignments } = await serviceClient
      .from("thread_tag_assignments")
      .select("thread_id, workspace_tags(name, color)")
      .in("thread_id", threadIds);

    const tagMap = {};
    const colorMap = {};
    for (const row of tagAssignments ?? []) {
      const name = row.workspace_tags?.name;
      const color = row.workspace_tags?.color;
      if (name) {
        tagMap[name] = (tagMap[name] || 0) + 1;
        colorMap[name] = color;
      }
    }
    ticketTypes = Object.entries(tagMap)
      .sort(([, a], [, b]) => b - a)
      .map(([tag, count]) => ({ tag, count, color: colorMap[tag] || null }));
  }

  // Draft quality
  const qualityData = Array.isArray(qualityResult.data) ? qualityResult.data : [];
  const qualityTotal = qualityData.length;
  let no_edit = 0, minor_edit = 0, major_edit = 0;
  let editDeltaSum = 0;
  let editDeltaCount = 0;
  const qualityThreadIds = Array.from(
    new Set(
      qualityData
        .map((row) => String(row?.thread_id || "").trim())
        .filter(Boolean),
    ),
  );
  const tagRowsByThreadId = {};
  if (qualityThreadIds.length > 0) {
    const { data: qualityTagRows } = await serviceClient
      .from("thread_tag_assignments")
      .select("thread_id, workspace_tags(name, color)")
      .in("thread_id", qualityThreadIds);
    for (const row of qualityTagRows ?? []) {
      const threadId = String(row?.thread_id || "").trim();
      const tagName = String(row?.workspace_tags?.name || "").trim();
      if (!threadId || !tagName) continue;
      if (!tagRowsByThreadId[threadId]) tagRowsByThreadId[threadId] = [];
      tagRowsByThreadId[threadId].push({
        name: tagName,
        color: row.workspace_tags?.color || null,
      });
    }
  }
  const qualityByTag = {};
  const ensureTagQuality = (tag) => {
    const name = String(tag?.name || "Unknown").trim() || "Unknown";
    if (!qualityByTag[name]) {
      qualityByTag[name] = {
        tag: name,
        color: tag?.color || null,
        total: 0,
        no_edit: 0,
        minor_edit: 0,
        major_edit: 0,
        edit_delta_sum: 0,
        edit_delta_count: 0,
      };
    }
    if (!qualityByTag[name].color && tag?.color) qualityByTag[name].color = tag.color;
    return qualityByTag[name];
  };
  for (const row of qualityData) {
    const cls = row.edit_classification;
    const parsedDeltaPct = Number(row.edit_delta_pct);
    const deltaPct = Number.isFinite(parsedDeltaPct) ? parsedDeltaPct : null;
    if (row.edit_classification === "no_edit") {
      no_edit++;
      editDeltaSum += 0;
      editDeltaCount++;
    } else if (row.edit_classification === "minor_edit") {
      minor_edit++;
    } else if (row.edit_classification === "major_edit") {
      major_edit++;
    }

    if (row.edit_classification !== "no_edit") {
      if (Number.isFinite(deltaPct)) {
        editDeltaSum += deltaPct;
        editDeltaCount++;
      }
    }

    const threadId = String(row?.thread_id || "").trim();
    const rowTags = tagRowsByThreadId[threadId]?.length
      ? tagRowsByThreadId[threadId]
      : [{ name: "Unknown", color: null }];
    for (const tag of rowTags) {
      const bucket = ensureTagQuality(tag);
      bucket.total++;
      if (cls === "no_edit") {
        bucket.no_edit++;
        bucket.edit_delta_sum += 0;
        bucket.edit_delta_count++;
      } else if (cls === "minor_edit") {
        bucket.minor_edit++;
      } else if (cls === "major_edit") {
        bucket.major_edit++;
      }
      if (cls !== "no_edit" && deltaPct !== null) {
        bucket.edit_delta_sum += deltaPct;
        bucket.edit_delta_count++;
      }
    }
  }
  const qualityByTagList = Object.values(qualityByTag)
    .map((bucket) => ({
      tag: bucket.tag,
      color: bucket.color,
      total: bucket.total,
      no_edit: bucket.no_edit,
      minor_edit: bucket.minor_edit,
      major_edit: bucket.major_edit,
      no_edit_pct: bucket.total > 0 ? Math.round((bucket.no_edit / bucket.total) * 100) : 0,
      avg_edited_pct: bucket.edit_delta_count > 0
        ? Math.round((bucket.edit_delta_sum / bucket.edit_delta_count) * 100)
        : null,
    }))
    .sort((a, b) => {
      const editedDelta = (b.avg_edited_pct ?? -1) - (a.avg_edited_pct ?? -1);
      if (editedDelta !== 0) return editedDelta;
      return b.total - a.total;
    });

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
      avg_edited_pct: editDeltaCount > 0 ? Math.round((editDeltaSum / editDeltaCount) * 100) : null,
      by_tag: qualityByTagList,
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
      drafts_total: current.drafts_generated,
      drafts_made: current.drafts_made,
      edited_before_send_pct: current.draft_quality.total > 0
        ? Math.round(
          ((current.draft_quality.minor_edit + current.draft_quality.major_edit) /
            current.draft_quality.total) * 100,
        )
        : 0,
      edited_before_send_count: current.draft_quality.minor_edit + current.draft_quality.major_edit,
      tracked_sent_drafts: current.draft_quality.total,
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
