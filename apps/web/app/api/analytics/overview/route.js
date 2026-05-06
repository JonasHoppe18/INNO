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

const SOLVED_STATUSES = new Set(["solved", "resolved", "closed"]);

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

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

function dateRangeToWindow(startDate, endDate) {
  const start = String(startDate || "").trim();
  const end = String(endDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return null;
  }

  const currentSinceDate = new Date(`${start}T00:00:00.000Z`);
  const currentUntilDate = new Date(`${end}T00:00:00.000Z`);
  if (
    Number.isNaN(currentSinceDate.getTime()) ||
    Number.isNaN(currentUntilDate.getTime()) ||
    currentUntilDate < currentSinceDate
  ) {
    return null;
  }

  currentUntilDate.setUTCDate(currentUntilDate.getUTCDate() + 1);
  const durationMs = currentUntilDate.getTime() - currentSinceDate.getTime();
  const previousUntilDate = new Date(currentSinceDate);
  const previousSinceDate = new Date(currentSinceDate.getTime() - durationMs);

  return {
    currentSince: currentSinceDate.toISOString(),
    currentUntil: currentUntilDate.toISOString(),
    previousSince: previousSinceDate.toISOString(),
    previousUntil: previousUntilDate.toISOString(),
  };
}

function minutesBetween(start, end) {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
  return Math.round((endMs - startMs) / 60000);
}

function median(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function pct(part, total) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function dateKey(value) {
  return value ? String(value).slice(0, 10) : null;
}

function monthKey(value) {
  return value ? String(value).slice(0, 7) : null;
}

function inc(map, key, amount = 1) {
  if (!key) return;
  map[key] = (map[key] || 0) + amount;
}

function bracketFirstReply(minutes) {
  if (minutes == null) return "No replies";
  if (minutes <= 60) return "0-1 hrs";
  if (minutes <= 360) return "1-6 hrs";
  if (minutes <= 1440) return "6-24 hrs";
  return ">24 hrs";
}

function bracketResolution(minutes) {
  if (minutes == null) return null;
  if (minutes <= 300) return "0-5 hrs";
  if (minutes <= 1440) return "5-24 hrs";
  if (minutes <= 10080) return "1-7 days";
  if (minutes <= 43200) return "7-30 days";
  return ">30 days";
}

function bracketAgentReplies(count) {
  if (count <= 0) return "0";
  if (count === 1) return "1";
  if (count === 2) return "2";
  if (count <= 5) return "3-5";
  return ">5";
}

function orderedBuckets(map, order, total) {
  return order.map((label) => ({
    label,
    count: map[label] || 0,
    pct: pct(map[label] || 0, total),
  }));
}

function normalizeStatus(status) {
  return String(status || "").trim().toLowerCase();
}

function isSolvedThread(thread) {
  return SOLVED_STATUSES.has(normalizeStatus(thread?.status));
}

function applySupportTicketFilter(query) {
  return query.or("classification_key.is.null,classification_key.neq.notification");
}

function asTimestamp(row) {
  return row?.sent_at || row?.received_at || row?.created_at || null;
}

function buildThreadUrl(id) {
  return id ? `/inbox?thread=${encodeURIComponent(id)}` : null;
}

async function fetchTagRows(serviceClient, threadIds) {
  if (!threadIds.length) return [];
  const { data, error } = await serviceClient
    .from("thread_tag_assignments")
    .select("thread_id, workspace_tags(name, color)")
    .in("thread_id", threadIds);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function fetchPeriodMetrics(serviceClient, scope, since, until) {
  let threadsQ = serviceClient
    .from("mail_threads")
    .select(
      "id, ticket_number, subject, customer_email, status, classification_key, created_at, updated_at",
    );
  threadsQ = applySupportTicketFilter(threadsQ);
  if (since) threadsQ = threadsQ.gte("created_at", since);
  threadsQ = threadsQ.lt("created_at", until);
  threadsQ = applyScope(threadsQ, scope);

  let draftsQ = serviceClient
    .from("drafts")
    .select("id, thread_id, status, final_reply_generated_at, edit_classification, edit_delta_pct, created_at");
  if (since) draftsQ = draftsQ.gte("created_at", since);
  draftsQ = draftsQ.lt("created_at", until);
  draftsQ = applyScope(draftsQ, scope);

  let actionsQ = serviceClient.from("thread_actions").select("thread_id, action_type, status, created_at");
  if (since) actionsQ = actionsQ.gte("created_at", since);
  actionsQ = actionsQ.lt("created_at", until);
  actionsQ = applyScope(actionsQ, scope);

  const [threadsResult, draftsResult, actionsResult] = await Promise.all([
    threadsQ,
    draftsQ,
    actionsQ,
  ]);

  if (threadsResult.error) throw new Error(threadsResult.error.message);
  if (draftsResult.error) throw new Error(draftsResult.error.message);
  if (actionsResult.error) throw new Error(actionsResult.error.message);

  const threadRows = Array.isArray(threadsResult.data) ? threadsResult.data : [];
  const threadIds = threadRows.map((r) => r.id).filter(Boolean);
  const threadById = Object.fromEntries(threadRows.map((row) => [row.id, row]));

  let messages = [];
  if (threadIds.length > 0) {
    const { data, error } = await serviceClient
      .from("mail_messages")
      .select("id, thread_id, from_me, sent_at, received_at, created_at")
      .in("thread_id", threadIds)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    messages = data ?? [];
  }

  const tagAssignments = await fetchTagRows(serviceClient, threadIds);
  const tagsByThreadId = {};
  const tagMap = {};
  const colorMap = {};
  for (const row of tagAssignments) {
    const threadId = String(row?.thread_id || "");
    const name = String(row?.workspace_tags?.name || "").trim();
    if (!threadId || !name) continue;
    if (!tagsByThreadId[threadId]) tagsByThreadId[threadId] = [];
    tagsByThreadId[threadId].push({ name, color: row.workspace_tags?.color || null });
    inc(tagMap, name);
    if (row.workspace_tags?.color) colorMap[name] = row.workspace_tags.color;
  }
  const ticketTypes = Object.entries(tagMap)
    .sort(([, a], [, b]) => b - a)
    .map(([tag, count]) => ({ tag, count, color: colorMap[tag] || null }));

  const volumeMap = {};
  const monthMap = {};
  for (const row of threadRows) {
    inc(volumeMap, dateKey(row.created_at));
    inc(monthMap, monthKey(row.created_at));
  }
  const volumeByDay = Object.entries(volumeMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));
  const volumeByMonth = Object.entries(monthMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, count]) => ({ month, count }));

  const messagesByThreadId = {};
  for (const message of messages) {
    const threadId = message.thread_id;
    if (!threadId) continue;
    if (!messagesByThreadId[threadId]) messagesByThreadId[threadId] = [];
    messagesByThreadId[threadId].push(message);
  }

  const firstReplyMinutes = [];
  const resolutionMinutes = [];
  const firstReplyBucketMap = {};
  const resolutionBucketMap = {};
  const agentReplyBucketMap = {};
  const slowFirstReplyTickets = [];
  const slowResolutionTickets = [];
  let repliedTickets = 0;
  let oneTouchTickets = 0;
  let totalAgentReplies = 0;
  let solvedTickets = 0;
  let unsolvedTickets = 0;

  for (const thread of threadRows) {
    const isSolved = isSolvedThread(thread);
    if (isSolved) solvedTickets++;
    else unsolvedTickets++;

    const threadMessages = messagesByThreadId[thread.id] ?? [];
    const inboundMessages = threadMessages
      .filter((row) => row.from_me === false)
      .sort((a, b) => new Date(asTimestamp(a)).getTime() - new Date(asTimestamp(b)).getTime());
    const outboundMessages = threadMessages
      .filter((row) => row.from_me === true)
      .sort((a, b) => new Date(asTimestamp(a)).getTime() - new Date(asTimestamp(b)).getTime());

    totalAgentReplies += outboundMessages.length;
    inc(agentReplyBucketMap, bracketAgentReplies(outboundMessages.length));
    if (isSolved && outboundMessages.length <= 1) oneTouchTickets++;

    const firstInboundAt = asTimestamp(inboundMessages[0]) || thread.created_at;
    const firstReply = outboundMessages.find((row) => {
      const replyAt = new Date(asTimestamp(row)).getTime();
      const inboundAt = new Date(firstInboundAt).getTime();
      return Number.isFinite(replyAt) && Number.isFinite(inboundAt) && replyAt >= inboundAt;
    });
    const replyMinutes = firstReply ? minutesBetween(firstInboundAt, asTimestamp(firstReply)) : null;
    if (replyMinutes != null) {
      firstReplyMinutes.push(replyMinutes);
      repliedTickets++;
      slowFirstReplyTickets.push({
        id: thread.id,
        ticket_number: thread.ticket_number,
        subject: thread.subject,
        customer_email: thread.customer_email,
        status: thread.status,
        value_minutes: replyMinutes,
        created_at: thread.created_at,
        url: buildThreadUrl(thread.id),
      });
    }
    inc(firstReplyBucketMap, bracketFirstReply(replyMinutes));

    if (isSolved) {
      const solvedMinutes = minutesBetween(thread.created_at, thread.updated_at);
      if (solvedMinutes != null) {
        resolutionMinutes.push(solvedMinutes);
        inc(resolutionBucketMap, bracketResolution(solvedMinutes));
        slowResolutionTickets.push({
          id: thread.id,
          ticket_number: thread.ticket_number,
          subject: thread.subject,
          customer_email: thread.customer_email,
          status: thread.status,
          value_minutes: solvedMinutes,
          created_at: thread.created_at,
          url: buildThreadUrl(thread.id),
        });
      }
    }
  }

  slowFirstReplyTickets.sort((a, b) => b.value_minutes - a.value_minutes);
  slowResolutionTickets.sort((a, b) => b.value_minutes - a.value_minutes);

  const drafts = Array.isArray(draftsResult.data) ? draftsResult.data : [];
  const draftsGenerated = drafts.filter((row) => row.final_reply_generated_at).length;
  const qualityData = drafts.filter((row) => row.status === "sent" && row.edit_classification);
  const qualityTotal = qualityData.length;
  let no_edit = 0;
  let minor_edit = 0;
  let major_edit = 0;
  let editDeltaSum = 0;
  let editDeltaCount = 0;
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
    if (cls === "no_edit") {
      no_edit++;
      editDeltaSum += 0;
      editDeltaCount++;
    } else if (cls === "minor_edit") {
      minor_edit++;
    } else if (cls === "major_edit") {
      major_edit++;
    }
    if (cls !== "no_edit" && deltaPct !== null) {
      editDeltaSum += deltaPct;
      editDeltaCount++;
    }

    const rowTags = tagsByThreadId[row.thread_id]?.length
      ? tagsByThreadId[row.thread_id]
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
      no_edit_pct: pct(bucket.no_edit, bucket.total),
      major_edit_pct: pct(bucket.major_edit, bucket.total),
      avg_edited_pct:
        bucket.edit_delta_count > 0 ? Math.round((bucket.edit_delta_sum / bucket.edit_delta_count) * 100) : null,
    }))
    .sort((a, b) => {
      const majorDelta = b.major_edit_pct - a.major_edit_pct;
      if (majorDelta !== 0) return majorDelta;
      return b.total - a.total;
    });

  const actions = Array.isArray(actionsResult.data) ? actionsResult.data : [];
  const actionsByType = {};
  let actionsApplied = 0;
  let actionsPending = 0;
  let actionsDeclined = 0;
  let actionsApproved = 0;
  for (const row of actions) {
    const type = row.action_type || "unknown";
    if (!actionsByType[type]) {
      actionsByType[type] = { type, total: 0, applied: 0, pending: 0, declined: 0, approved: 0 };
    }
    actionsByType[type].total++;
    if (row.status === "applied" || row.status === "approved_test_mode") {
      actionsByType[type].applied++;
      actionsApplied++;
    } else if (row.status === "pending") {
      actionsByType[type].pending++;
      actionsPending++;
    } else if (row.status === "approved") {
      actionsByType[type].approved++;
      actionsApproved++;
    } else if (row.status === "declined" || row.status === "failed") {
      actionsByType[type].declined++;
      actionsDeclined++;
    }
  }
  const actionsByTypeList = Object.values(actionsByType).sort((a, b) => b.total - a.total);

  const taggedThreadCount = new Set(tagAssignments.map((row) => row.thread_id).filter(Boolean)).size;
  const draftedThreadCount = new Set(drafts.map((row) => row.thread_id).filter(Boolean)).size;
  const actionThreadCount = new Set(actions.map((row) => row.thread_id).filter(Boolean)).size;
  const aiTouchedThreadIds = new Set([
    ...drafts.map((row) => row.thread_id).filter(Boolean),
    ...actions.map((row) => row.thread_id).filter(Boolean),
    ...tagAssignments.map((row) => row.thread_id).filter(Boolean),
  ]);

  return {
    tickets_total: threadRows.length,
    support: {
      created_tickets: threadRows.length,
      solved_tickets: solvedTickets,
      unsolved_tickets: unsolvedTickets,
      one_touch_tickets: oneTouchTickets,
      one_touch_pct: pct(oneTouchTickets, solvedTickets),
      reopened_tickets: null,
      reopened_pct: null,
      first_reply_time_median_min: median(firstReplyMinutes),
      first_resolution_time_median_min: null,
      full_resolution_time_median_min: median(resolutionMinutes),
      group_stations_average: null,
      assignee_stations_average: null,
      agent_replies_average:
        threadRows.length > 0 ? Math.round((totalAgentReplies / threadRows.length) * 10) / 10 : null,
      reply_coverage_pct: pct(repliedTickets, threadRows.length),
      first_reply_brackets: orderedBuckets(
        firstReplyBucketMap,
        ["No replies", "0-1 hrs", "1-6 hrs", "6-24 hrs", ">24 hrs"],
        threadRows.length,
      ),
      resolution_brackets: orderedBuckets(
        resolutionBucketMap,
        ["0-5 hrs", "5-24 hrs", "1-7 days", "7-30 days", ">30 days"],
        solvedTickets,
      ),
      agent_reply_brackets: orderedBuckets(
        agentReplyBucketMap,
        ["0", "1", "2", "3-5", ">5"],
        threadRows.length,
      ),
      slow_first_reply_tickets: slowFirstReplyTickets.slice(0, 8),
      slow_resolution_tickets: slowResolutionTickets.slice(0, 8),
    },
    drafts_made: drafts.length,
    drafts_generated: draftsGenerated,
    volume_by_day: volumeByDay,
    volume_by_month: volumeByMonth,
    ticket_types: ticketTypes,
    actions: {
      total: actions.length,
      applied: actionsApplied,
      pending: actionsPending,
      approved: actionsApproved,
      declined: actionsDeclined,
      completion_pct: pct(actionsApplied, actions.length),
      by_type: actionsByTypeList,
    },
    draft_quality: {
      total: qualityTotal,
      no_edit,
      minor_edit,
      major_edit,
      no_edit_pct: pct(no_edit, qualityTotal),
      minor_edit_pct: pct(minor_edit, qualityTotal),
      major_edit_pct: pct(major_edit, qualityTotal),
      avg_edited_pct: editDeltaCount > 0 ? Math.round((editDeltaSum / editDeltaCount) * 100) : null,
      by_tag: qualityByTagList,
    },
    coverage: {
      tickets: threadRows.length,
      tagged_tickets: taggedThreadCount,
      tagged_pct: pct(taggedThreadCount, threadRows.length),
      drafted_tickets: draftedThreadCount,
      drafted_pct: pct(draftedThreadCount, threadRows.length),
      action_tickets: actionThreadCount,
      action_pct: pct(actionThreadCount, threadRows.length),
      ai_touched_tickets: aiTouchedThreadIds.size,
      ai_touched_pct: pct(aiTouchedThreadIds.size, threadRows.length),
      reply_time_tracked_tickets: repliedTickets,
      reply_time_tracked_pct: pct(repliedTickets, threadRows.length),
      edit_tracking_tickets: qualityTotal,
      edit_tracking_pct: pct(qualityTotal, solvedTickets || threadRows.length),
    },
    _debug_counts: {
      messages: messages.length,
      threads_with_messages: Object.keys(messagesByThreadId).length,
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
  const start = searchParams.get("start") || "";
  const end = searchParams.get("end") || "";
  const customWindow = start || end ? dateRangeToWindow(start, end) : null;

  if ((start || end) && !customWindow) {
    return NextResponse.json(
      { error: "Invalid date range. Use start and end as YYYY-MM-DD, with end on or after start." },
      { status: 400 },
    );
  }

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
    const { currentSince, currentUntil, previousSince, previousUntil } =
      customWindow || periodToWindow(period);

    const fetchPrev =
      customWindow || period !== "all"
        ? fetchPeriodMetrics(serviceClient, scope, previousSince, previousUntil)
        : Promise.resolve(null);

    const [current, prev] = await Promise.all([
      fetchPeriodMetrics(serviceClient, scope, currentSince, currentUntil),
      fetchPrev,
    ]);

    const previous = prev
      ? {
          tickets_total: prev.tickets_total,
          solved_tickets: prev.support.solved_tickets,
          unsolved_tickets: prev.support.unsolved_tickets,
          first_reply_time_median_min: prev.support.first_reply_time_median_min,
          full_resolution_time_median_min: prev.support.full_resolution_time_median_min,
          drafts_made: prev.drafts_made,
          actions_applied: prev.actions.applied,
          actions_completion_pct: prev.actions.completion_pct,
          ai_accepted_pct: prev.draft_quality.no_edit_pct,
          major_edit_pct: prev.draft_quality.major_edit_pct,
          ai_touched_pct: prev.coverage.ai_touched_pct,
        }
      : null;

    return NextResponse.json({
      period: customWindow ? "custom" : period,
      start: customWindow ? start : null,
      end: customWindow ? end : null,
      tickets_total: current.tickets_total,
      drafts_total: current.drafts_generated,
      drafts_made: current.drafts_made,
      edited_before_send_pct: current.draft_quality.total > 0
        ? pct(current.draft_quality.minor_edit + current.draft_quality.major_edit, current.draft_quality.total)
        : 0,
      edited_before_send_count: current.draft_quality.minor_edit + current.draft_quality.major_edit,
      tracked_sent_drafts: current.draft_quality.total,
      volume_by_day: current.volume_by_day,
      volume_by_month: current.volume_by_month,
      ticket_types: current.ticket_types,
      support: current.support,
      actions: current.actions,
      draft_quality: current.draft_quality,
      coverage: current.coverage,
      previous,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
