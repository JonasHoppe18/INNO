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
const NOISE_CLASSIFICATIONS = new Set(["notification", "spam", "system", "meta", "shopify"]);

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function startOfUtcMonth(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function toIsoDate(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

function periodToWindow(period) {
  const now = new Date();
  if (period === "this_month") {
    const currentSince = startOfUtcMonth(now);
    const previousUntil = new Date(currentSince);
    const previousSince = new Date(Date.UTC(currentSince.getUTCFullYear(), currentSince.getUTCMonth() - 1, 1));
    return {
      key: "this_month",
      label: "This month",
      currentSince: currentSince.toISOString(),
      currentUntil: now.toISOString(),
      previousSince: previousSince.toISOString(),
      previousUntil: previousUntil.toISOString(),
    };
  }

  if (!period || period === "all") {
    return {
      key: "all",
      label: "All time",
      currentSince: null,
      currentUntil: now.toISOString(),
      previousSince: null,
      previousUntil: null,
    };
  }

  const days = period === "7" ? 7 : 30;
  const currentSince = new Date(now);
  currentSince.setUTCDate(now.getUTCDate() - days);
  const previousUntil = new Date(currentSince);
  const previousSince = new Date(previousUntil);
  previousSince.setUTCDate(previousUntil.getUTCDate() - days);
  return {
    key: String(days),
    label: `Last ${days} days`,
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
    key: "custom",
    label: `${start} - ${end}`,
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

function changePct(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function dateKey(value) {
  return value ? String(value).slice(0, 10) : null;
}

function weekKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - (day - 1));
  return date.toISOString().slice(0, 10);
}

function monthKey(value) {
  return value ? String(value).slice(0, 7) : null;
}

function groupKeyForRange(since, until) {
  if (!since) return "month";
  const durationDays = Math.max(1, Math.ceil((new Date(until).getTime() - new Date(since).getTime()) / 86400000));
  if (durationDays > 120) return "month";
  if (durationDays > 45) return "week";
  return "day";
}

function inc(map, key, amount = 1) {
  if (!key) return;
  map[key] = (map[key] || 0) + amount;
}

function normalizeStatus(status) {
  return String(status || "").trim().toLowerCase();
}

function computeFirstReplyBrackets(minutesArray, totalTickets) {
  const counts = { no_reply: 0, "0_1h": 0, "1_8h": 0, "8_24h": 0, over_24h: 0 };
  for (const m of minutesArray) {
    if (m <= 60) counts["0_1h"]++;
    else if (m <= 480) counts["1_8h"]++;
    else if (m <= 1440) counts["8_24h"]++;
    else counts.over_24h++;
  }
  counts.no_reply = Math.max(0, totalTickets - minutesArray.length);
  const total = Math.max(totalTickets, 1);
  return [
    { key: "no_reply", label: "No reply", count: counts.no_reply, pct: pct(counts.no_reply, total) },
    { key: "0_1h", label: "0–1 hrs", count: counts["0_1h"], pct: pct(counts["0_1h"], total) },
    { key: "1_8h", label: "1–8 hrs", count: counts["1_8h"], pct: pct(counts["1_8h"], total) },
    { key: "8_24h", label: "8–24 hrs", count: counts["8_24h"], pct: pct(counts["8_24h"], total) },
    { key: "over_24h", label: ">24 hrs", count: counts.over_24h, pct: pct(counts.over_24h, total) },
  ];
}

function computeResolutionBrackets(minutesArray) {
  if (!minutesArray.length) return [];
  const counts = { "0_5h": 0, "5_24h": 0, "1_7d": 0, "7_30d": 0, over_30d: 0 };
  for (const m of minutesArray) {
    if (m <= 300) counts["0_5h"]++;
    else if (m <= 1440) counts["5_24h"]++;
    else if (m <= 10080) counts["1_7d"]++;
    else if (m <= 43200) counts["7_30d"]++;
    else counts.over_30d++;
  }
  const total = minutesArray.length;
  return [
    { key: "0_5h", label: "0–5 hrs", count: counts["0_5h"], pct: pct(counts["0_5h"], total) },
    { key: "5_24h", label: "5–24 hrs", count: counts["5_24h"], pct: pct(counts["5_24h"], total) },
    { key: "1_7d", label: "1–7 days", count: counts["1_7d"], pct: pct(counts["1_7d"], total) },
    { key: "7_30d", label: "7–30 days", count: counts["7_30d"], pct: pct(counts["7_30d"], total) },
    { key: "over_30d", label: ">30 days", count: counts.over_30d, pct: pct(counts.over_30d, total) },
  ];
}

function isSolvedThread(thread) {
  return SOLVED_STATUSES.has(normalizeStatus(thread?.status));
}

function isSupportThread(thread) {
  const classification = String(thread?.classification_key || "").trim().toLowerCase();
  if (NOISE_CLASSIFICATIONS.has(classification)) return false;
  const tags = Array.isArray(thread?.tags) ? thread.tags : [];
  if (tags.some((tag) => String(tag).startsWith("inbox:"))) return false;
  return true;
}

function asTimestamp(row) {
  return row?.sent_at || row?.received_at || row?.created_at || null;
}

function buildThreadUrl(id) {
  return id ? `/inbox?thread=${encodeURIComponent(id)}` : null;
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function clampText(value, max = 90) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}...`;
}

function cleanIssueDescription(value) {
  let text = String(value || "").replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  const testSignals = [
    "test message",
    "this is a test",
    "testing",
    "test ticket",
    "ignore this",
    "lorem ipsum",
    "asdf",
    "hello world",
  ];
  if (
    !text ||
    text.length < 8 ||
    testSignals.some((signal) => lower.includes(signal)) ||
    /^test[\s.:_-]*$/i.test(text)
  ) {
    return null;
  }
  const categoryRules = [
    { label: "Returns & exchanges", words: ["return", "exchange", "swap"] },
    { label: "Refund requests", words: ["refund", "money back", "chargeback"] },
    { label: "Delivery & tracking", words: ["delivery", "shipping", "tracking", "shipment", "package", "parcel", "late"] },
    { label: "Address changes", words: ["address", "wrong address", "shipping address"] },
    { label: "Product not working", words: ["not working", "doesn't work", "does not work", "broken", "defect", "faulty", "malfunction"] },
    { label: "Connectivity & setup", words: ["connect", "connection", "disconnect", "pairing", "bluetooth", "dongle", "setup", "firmware"] },
    { label: "Missing or damaged items", words: ["missing", "damaged", "cable", "part missing", "arrived broken"] },
    { label: "Spare parts", words: ["spare", "replacement", "ear pad", "earpad", "cushion", "accessory"] },
    { label: "Warranty & repairs", words: ["warranty", "repair", "rma"] },
    { label: "Order cancellation", words: ["cancel", "cancellation"] },
    { label: "Payment & invoice", words: ["invoice", "payment", "paid", "charge", "receipt"] },
    { label: "Product questions", words: ["question", "compatible", "compatibility", "how do i", "can i"] },
    { label: "Complaint or feedback", words: ["complaint", "disappointed", "unhappy", "feedback"] },
  ];
  const match = categoryRules.find((rule) => rule.words.some((word) => lower.includes(word)));
  if (match) return match.label;

  text = text
    .replace(/^the customer (is )?(requesting|asking|looking for|contacting support about|writing about)\s+/i, "")
    .replace(/^customer (is )?(requesting|asking|looking for|contacting support about|writing about)\s+/i, "")
    .replace(/^the customer wants\s+/i, "")
    .replace(/^customer wants\s+/i, "")
    .replace(/^a customer (is )?(requesting|asking|looking for)\s+/i, "")
    .replace(/^an? (issue|request) (about|regarding|for)\s+/i, "")
    .replace(/^(help with|support for)\s+/i, "");
  text = text.charAt(0).toUpperCase() + text.slice(1);
  return clampText(text, 42);
}

function qualityLabel(cls, hasDraft) {
  if (!hasDraft) return "No draft";
  if (cls === "no_edit") return "Sent as-is";
  if (cls === "minor_edit") return "Minor edits";
  if (cls === "major_edit") return "Major edits";
  return "Draft generated";
}

function actionLabel(type) {
  return String(type || "unknown")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function primaryCategoryForThread(thread, tagsByThreadId = {}) {
  const tag = tagsByThreadId[thread.id]?.[0]?.name;
  if (tag) return tag;
  const issue = cleanIssueDescription(thread.issue_summary || "");
  if (issue) return issue;
  return thread.classification_key || "Uncategorized";
}

function listFromCountMap(map, total, { keyPrefix, colors = {}, fullLabels = {} } = {}) {
  return Object.entries(map)
    .sort(([, a], [, b]) => b - a)
    .map(([label, count]) => ({
      key: `${keyPrefix}:${slugify(label)}`,
      label,
      fullLabel: fullLabels[label] || label,
      count,
      pct: pct(count, total),
      color: colors[label] || null,
    }));
}

async function fetchProductMap(serviceClient, productIds) {
  const ids = Array.from(new Set(productIds.map((id) => String(id || "").trim()).filter(Boolean)));
  if (!ids.length) return {};
  const { data, error } = await serviceClient
    .from("shop_products")
    .select("id, title")
    .in("id", ids);
  if (error) return {};
  return Object.fromEntries((data ?? []).map((row) => [String(row.id), row.title || `Product #${row.id}`]));
}

async function fetchTagRows(serviceClient, threadIds) {
  if (!threadIds.length) return [];
  const { data, error } = await serviceClient
    .from("thread_tag_assignments")
    .select("thread_id, source, assigned_at, workspace_tags(name, color, category)")
    .in("thread_id", threadIds);
  if (error) throw new Error(error.message);
  return data ?? [];
}

function buildTicketRow(thread, context) {
  const tags = context.tagsByThreadId[thread.id] ?? [];
  const drafts = context.draftsByThreadId[thread.id] ?? [];
  const actions = context.actionsByThreadId[thread.id] ?? [];
  const latestQualityDraft = [...drafts]
    .filter((draft) => draft.status === "sent" || draft.edit_classification)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  const anyAppliedAction = actions.some((action) => ["applied", "approved", "approved_test_mode", "completed", "successful", "success"].includes(action.status));
  const productId = thread.detected_product_id ? String(thread.detected_product_id) : null;
  const product = productId ? context.productMap[productId] || `Product #${productId}` : null;

  return {
    id: thread.id,
    ticketNumber: thread.ticket_number || null,
    subject: thread.subject || thread.issue_summary || "No subject",
    customer: thread.customer_email || "Unknown customer",
    status: thread.status || "unknown",
    requestType: tags[0]?.name || thread.classification_key || "Uncategorized",
    tags: tags.map((tag) => tag.name),
    product,
    productId,
    issueSummary: thread.issue_summary || null,
    solutionSummary: thread.solution_summary || null,
    createdAt: thread.created_at,
    updatedAt: thread.updated_at,
    firstReplyMinutes: context.firstReplyByThreadId[thread.id] ?? null,
    resolutionMinutes: context.resolutionByThreadId[thread.id] ?? null,
    resolutionIsProxy: context.resolutionByThreadId[thread.id] != null,
    sonaUsage: anyAppliedAction
      ? "Action approved"
      : qualityLabel(latestQualityDraft?.edit_classification, drafts.length > 0),
    draftQuality: latestQualityDraft?.edit_classification || null,
    hasDraft: drafts.length > 0,
    hasAction: actions.length > 0,
    draftEditPct: Number.isFinite(Number(latestQualityDraft?.edit_delta_pct)) ? Number(latestQualityDraft.edit_delta_pct) : null,
    draftEditDistance: Number.isFinite(Number(latestQualityDraft?.edit_distance)) ? Number(latestQualityDraft.edit_distance) : null,
    url: buildThreadUrl(thread.id),
  };
}

async function fetchPeriodMetrics(serviceClient, scope, since, until) {
  let threadsQ = serviceClient
    .from("mail_threads")
    .select(
      "id, provider_thread_id, ticket_number, subject, customer_email, status, classification_key, tags, issue_summary, solution_summary, detected_product_id, created_at, updated_at",
    )
    .lt("created_at", until);
  if (since) threadsQ = threadsQ.gte("created_at", since);
  threadsQ = applyScope(threadsQ, scope);

  let draftsQ = serviceClient
    .from("drafts")
    .select("id, thread_id, status, final_reply_generated_at, edit_classification, edit_delta_pct, edit_distance, created_at")
    .lt("created_at", until);
  if (since) draftsQ = draftsQ.gte("created_at", since);
  draftsQ = applyScope(draftsQ, scope);

  let actionsQ = serviceClient
    .from("thread_actions")
    .select("thread_id, action_type, status, created_at, decided_at, applied_at, declined_at")
    .lt("created_at", until);
  if (since) actionsQ = actionsQ.gte("created_at", since);
  actionsQ = applyScope(actionsQ, scope);

  const [threadsResult, draftsResult, actionsResult] = await Promise.all([
    threadsQ,
    draftsQ,
    actionsQ,
  ]);

  if (threadsResult.error) throw new Error(threadsResult.error.message);
  if (draftsResult.error) throw new Error(draftsResult.error.message);
  if (actionsResult.error) throw new Error(actionsResult.error.message);

  const allThreadRows = Array.isArray(threadsResult.data) ? threadsResult.data : [];
  const threadRows = allThreadRows.filter(isSupportThread);
  const threadIds = threadRows.map((row) => row.id).filter(Boolean);
  const threadIdByDraftKey = {};
  for (const thread of threadRows) {
    threadIdByDraftKey[String(thread.id)] = thread.id;
    if (thread.provider_thread_id) threadIdByDraftKey[String(thread.provider_thread_id)] = thread.id;
  }

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
  const productMap = await fetchProductMap(
    serviceClient,
    threadRows.map((thread) => thread.detected_product_id),
  );

  const tagsByThreadId = {};
  const tagCounts = {};
  const tagColors = {};
  for (const row of tagAssignments) {
    const threadId = String(row?.thread_id || "");
    const name = String(row?.workspace_tags?.name || "").trim();
    if (!threadId || !name) continue;
    if (!tagsByThreadId[threadId]) tagsByThreadId[threadId] = [];
    tagsByThreadId[threadId].push({
      name,
      color: row.workspace_tags?.color || null,
      category: row.workspace_tags?.category || null,
      source: row.source || null,
    });
    inc(tagCounts, name);
    if (row.workspace_tags?.color) tagColors[name] = row.workspace_tags.color;
  }

  const messagesByThreadId = {};
  for (const message of messages) {
    if (!message.thread_id) continue;
    if (!messagesByThreadId[message.thread_id]) messagesByThreadId[message.thread_id] = [];
    messagesByThreadId[message.thread_id].push(message);
  }

  const drafts = Array.isArray(draftsResult.data) ? draftsResult.data : [];
  const draftsByThreadId = {};
  for (const draft of drafts) {
    const threadId = threadIdByDraftKey[String(draft.thread_id || "")];
    if (!threadId) continue;
    if (!draftsByThreadId[threadId]) draftsByThreadId[threadId] = [];
    draftsByThreadId[threadId].push(draft);
  }

  const actions = Array.isArray(actionsResult.data) ? actionsResult.data : [];
  const actionsByThreadId = {};
  for (const action of actions) {
    if (!action.thread_id || !threadIds.includes(action.thread_id)) continue;
    if (!actionsByThreadId[action.thread_id]) actionsByThreadId[action.thread_id] = [];
    actionsByThreadId[action.thread_id].push(action);
  }

  const grouping = groupKeyForRange(since, until);
  const volumeMap = {};
  const firstReplyByThreadId = {};
  const resolutionByThreadId = {};
  const topicReplyMinutes = {};
  const firstReplyMinutes = [];
  const resolutionMinutes = [];
  let repliedTickets = 0;
  let totalAgentReplies = 0;
  let solvedTickets = 0;
  let oneTouchTickets = 0;

  for (const thread of threadRows) {
    const key = grouping === "month" ? monthKey(thread.created_at) : grouping === "week" ? weekKey(thread.created_at) : dateKey(thread.created_at);
    inc(volumeMap, key);

    if (isSolvedThread(thread)) solvedTickets++;

    const threadMessages = messagesByThreadId[thread.id] ?? [];
    const inboundMessages = threadMessages
      .filter((row) => row.from_me === false)
      .sort((a, b) => new Date(asTimestamp(a)).getTime() - new Date(asTimestamp(b)).getTime());
    const outboundMessages = threadMessages
      .filter((row) => row.from_me === true)
      .sort((a, b) => new Date(asTimestamp(a)).getTime() - new Date(asTimestamp(b)).getTime());
    totalAgentReplies += outboundMessages.length;

    const firstInboundAt = asTimestamp(inboundMessages[0]) || thread.created_at;
    const firstReply = outboundMessages.find((row) => {
      const replyAt = new Date(asTimestamp(row)).getTime();
      const inboundAt = new Date(firstInboundAt).getTime();
      return Number.isFinite(replyAt) && Number.isFinite(inboundAt) && replyAt >= inboundAt;
    });
    const replyMinutes = firstReply ? minutesBetween(firstInboundAt, asTimestamp(firstReply)) : null;
    if (replyMinutes != null) {
      firstReplyByThreadId[thread.id] = replyMinutes;
      firstReplyMinutes.push(replyMinutes);
      repliedTickets++;
      const tags = tagsByThreadId[thread.id]?.length ? tagsByThreadId[thread.id] : [{ name: thread.classification_key || "Uncategorized" }];
      for (const tag of tags) {
        const name = tag.name || "Uncategorized";
        if (!topicReplyMinutes[name]) topicReplyMinutes[name] = [];
        topicReplyMinutes[name].push(replyMinutes);
      }
    }

    if (isSolvedThread(thread)) {
      const proxyResolution = minutesBetween(thread.created_at, thread.updated_at);
      if (proxyResolution != null) {
        resolutionByThreadId[thread.id] = proxyResolution;
        resolutionMinutes.push(proxyResolution);
      }
      if (outboundMessages.length === 1) oneTouchTickets++;
    }
  }

  const volumeSeries = Object.entries(volumeMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  const qualityData = drafts.filter((row) => row.status === "sent" && row.edit_classification);
  const draftsGenerated = drafts.filter((row) => row.final_reply_generated_at).length;
  const draftedThreadIds = new Set(Object.keys(draftsByThreadId));
  const qualityCounts = { no_edit: 0, minor_edit: 0, major_edit: 0, rejected: 0 };
  let editDeltaSum = 0;
  let editDeltaCount = 0;
  let editDistanceSum = 0;
  let editDistanceCount = 0;
  for (const draft of qualityData) {
    if (draft.edit_classification === "no_edit") qualityCounts.no_edit++;
    else if (draft.edit_classification === "minor_edit") qualityCounts.minor_edit++;
    else if (draft.edit_classification === "major_edit") qualityCounts.major_edit++;
    const parsedDeltaPct = Number(draft.edit_delta_pct);
    if (Number.isFinite(parsedDeltaPct)) {
      editDeltaSum += parsedDeltaPct;
      editDeltaCount++;
    }
    const parsedEditDistance = Number(draft.edit_distance);
    if (Number.isFinite(parsedEditDistance)) {
      editDistanceSum += parsedEditDistance;
      editDistanceCount++;
    }
  }
  qualityCounts.rejected = drafts.filter((row) => ["rejected", "declined"].includes(String(row.status || "").toLowerCase())).length;

  const actionsByType = {};
  let actionsApproved = 0;
  let actionsApplied = 0;
  let actionsDeclined = 0;
  let actionsPending = 0;
  for (const action of actions.filter((row) => threadIds.includes(row.thread_id))) {
    const type = action.action_type || "unknown";
    if (!actionsByType[type]) actionsByType[type] = { type, label: actionLabel(type), suggested: 0, approved: 0, applied: 0, pending: 0, declined: 0 };
    actionsByType[type].suggested++;
    if (["applied", "approved_test_mode", "completed", "successful", "success"].includes(action.status)) {
      actionsByType[type].applied++;
      actionsApplied++;
    } else if (action.status === "approved") {
      actionsByType[type].approved++;
      actionsApproved++;
    } else if (action.status === "pending") {
      actionsByType[type].pending++;
      actionsPending++;
    } else if (action.status === "declined") {
      actionsByType[type].declined++;
      actionsDeclined++;
    }
  }
  const topActionTypes = Object.values(actionsByType)
    .map((row) => ({
      ...row,
      handled: row.approved + row.applied,
      approvalRate: pct(row.approved + row.applied, row.suggested),
      key: `action:${slugify(row.type)}`,
    }))
    .sort((a, b) => b.suggested - a.suggested)
    .slice(0, 8);
  const actionTypeRows = Object.values(actionsByType)
    .map((row) => ({
      ...row,
      handled: row.approved + row.applied,
      approvalRate: pct(row.approved + row.applied, row.suggested),
      key: `action:${slugify(row.type)}`,
    }))
    .filter((row) => row.suggested > 0);
  const bestWorkflowTypes = [...actionTypeRows]
    .sort((a, b) => b.approvalRate - a.approvalRate || b.suggested - a.suggested)
    .slice(0, 3);
  const needsReviewWorkflowTypes = [...actionTypeRows]
    .sort((a, b) => a.approvalRate - b.approvalRate || b.suggested - a.suggested)
    .slice(0, 3);
  const workflowCandidateRows = actionTypeRows.map((row) => {
    let readiness = "needs_more_data";
    let readinessLabel = "Needs more data";
    let reason = `${row.suggested} suggested`;
    if (row.suggested >= 5 && row.approvalRate >= 80) {
      readiness = "ready_to_test";
      readinessLabel = "Ready to test";
      reason = `${row.approvalRate}% approval`;
    } else if (row.suggested >= 3 && row.approvalRate < 50) {
      readiness = "keep_human_review";
      readinessLabel = "Keep human review";
      reason = `${row.approvalRate}% approval`;
    }
    return {
      key: row.key,
      label: row.label,
      type: "workflow",
      count: row.suggested,
      suggested: row.suggested,
      handled: row.handled,
      approvalRate: row.approvalRate,
      noMinorEditRate: null,
      majorRejectedRate: null,
      readiness,
      readinessLabel,
      reason,
    };
  });

  const productCounts = {};
  const issueCounts = {};
  const issueFullLabels = {};
  for (const thread of threadRows) {
    if (thread.detected_product_id) {
      const productId = String(thread.detected_product_id);
      inc(productCounts, productMap[productId] || `Product #${productId}`);
    }
    const issue = cleanIssueDescription(thread.issue_summary || "");
    if (issue) {
      inc(issueCounts, issue);
      if (!issueFullLabels[issue]) issueFullLabels[issue] = thread.issue_summary;
    }
  }

  const requestTypes = listFromCountMap(tagCounts, threadRows.length, { keyPrefix: "topic", colors: tagColors }).slice(0, 12);
  const products = listFromCountMap(productCounts, threadRows.length, { keyPrefix: "product" }).slice(0, 12);
  const issueDescriptions = listFromCountMap(issueCounts, threadRows.length, {
    keyPrefix: "issue",
    fullLabels: issueFullLabels,
  }).slice(0, 12);

  const topicPerformance = Object.entries(topicReplyMinutes)
    .map(([topic, values]) => ({
      key: `topic:${slugify(topic)}`,
      topic,
      count: tagCounts[topic] || values.length,
      medianFirstReplyMinutes: median(values),
      pct: pct(tagCounts[topic] || values.length, threadRows.length),
    }))
    .filter((row) => row.count >= 3 && row.medianFirstReplyMinutes != null);
  const fastestTopics = [...topicPerformance]
    .sort((a, b) => a.medianFirstReplyMinutes - b.medianFirstReplyMinutes)
    .slice(0, 5);
  const slowestTopics = [...topicPerformance]
    .sort((a, b) => b.medianFirstReplyMinutes - a.medianFirstReplyMinutes)
    .slice(0, 5);
  const highVolumeSlowResponse = [...topicPerformance]
    .sort((a, b) => (b.count * b.medianFirstReplyMinutes) - (a.count * a.medianFirstReplyMinutes))
    .slice(0, 5);

  const context = {
    tagsByThreadId,
    draftsByThreadId,
    actionsByThreadId,
    productMap,
    firstReplyByThreadId,
    resolutionByThreadId,
  };
  const ticketRows = threadRows.map((thread) => buildTicketRow(thread, context));
  const threadById = Object.fromEntries(threadRows.map((thread) => [thread.id, thread]));

  const categoryDraftStats = {};
  for (const [threadId, threadDrafts] of Object.entries(draftsByThreadId)) {
    const thread = threadById[threadId];
    if (!thread) continue;
    const category = primaryCategoryForThread(thread, tagsByThreadId);
    if (!categoryDraftStats[category]) {
      categoryDraftStats[category] = {
        category,
        sentDrafts: 0,
        assistedTickets: 0,
        noMinor: 0,
        majorOrRejected: 0,
      };
    }
    categoryDraftStats[category].assistedTickets++;
    for (const draft of threadDrafts) {
      const status = String(draft.status || "").toLowerCase();
      const cls = String(draft.edit_classification || "").toLowerCase();
      const isRejected = ["rejected", "declined"].includes(status);
      if (isRejected) {
        categoryDraftStats[category].majorOrRejected++;
        continue;
      }
      if (status !== "sent" || !cls) continue;
      categoryDraftStats[category].sentDrafts++;
      if (cls === "no_edit" || cls === "minor_edit") categoryDraftStats[category].noMinor++;
      if (cls === "major_edit") categoryDraftStats[category].majorOrRejected++;
    }
  }
  const categoryRows = Object.values(categoryDraftStats)
    .filter((row) => row.sentDrafts + row.majorOrRejected >= 3 || row.assistedTickets >= 3)
    .map((row) => ({
      key: `sona-category:${slugify(row.category)}`,
      category: row.category,
      count: row.sentDrafts + row.majorOrRejected,
      assistedTickets: row.assistedTickets,
      noMinorEditRate: pct(row.noMinor, row.sentDrafts),
      needsReviewRate: pct(row.majorOrRejected, row.sentDrafts + row.majorOrRejected),
    }));
  const categoryCandidateRows = categoryRows.map((row) => {
    let readiness = "needs_more_data";
    let readinessLabel = "Needs more data";
    let reason = `${row.assistedTickets} assisted tickets`;
    if (row.count >= 5 && row.noMinorEditRate >= 80 && row.needsReviewRate <= 20) {
      readiness = "ready_to_test";
      readinessLabel = "Ready to test";
      reason = `${row.noMinorEditRate}% no/minor edit`;
    } else if (row.count >= 3 && (row.needsReviewRate >= 35 || row.noMinorEditRate < 60)) {
      readiness = "keep_human_review";
      readinessLabel = "Keep human review";
      reason = `${row.needsReviewRate}% major/rejected`;
    }
    return {
      key: row.key,
      label: row.category,
      type: "category",
      count: row.count,
      assistedTickets: row.assistedTickets,
      approvalRate: null,
      noMinorEditRate: row.noMinorEditRate,
      majorRejectedRate: row.needsReviewRate,
      readiness,
      readinessLabel,
      reason,
    };
  });
  const autopilotCandidateRows = [...categoryCandidateRows, ...workflowCandidateRows];
  const autopilotCandidates = {
    readyToTest: autopilotCandidateRows
      .filter((row) => row.readiness === "ready_to_test")
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
    needsMoreData: autopilotCandidateRows
      .filter((row) => row.readiness === "needs_more_data")
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
    keepHumanReview: autopilotCandidateRows
      .filter((row) => row.readiness === "keep_human_review")
      .sort((a, b) => (b.majorRejectedRate ?? 0) - (a.majorRejectedRate ?? 0) || (a.approvalRate ?? 100) - (b.approvalRate ?? 100) || b.count - a.count)
      .slice(0, 5),
  };
  const bestPerformingCategories = [...categoryRows]
    .filter((row) => row.count >= 3)
    .sort((a, b) => b.noMinorEditRate - a.noMinorEditRate || b.count - a.count)
    .slice(0, 5);
  const needsReviewCategories = [...categoryRows]
    .filter((row) => row.count >= 3)
    .sort((a, b) => b.needsReviewRate - a.needsReviewRate || b.count - a.count)
    .slice(0, 5);
  const mostAssistedTopics = [...categoryRows]
    .sort((a, b) => b.assistedTickets - a.assistedTickets)
    .slice(0, 5);

  const newestTickets = [...ticketRows]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 25);
  const byKey = {
    all: newestTickets,
    support_tickets: newestTickets,
    sona_assisted: ticketRows.filter((row) => row.hasDraft).slice(0, 25),
    "action:all": ticketRows.filter((row) => row.hasAction).slice(0, 25),
    sent_as_is: ticketRows.filter((row) => row.draftQuality === "no_edit").slice(0, 25),
    minor_edits: ticketRows.filter((row) => row.draftQuality === "minor_edit").slice(0, 25),
    no_minor_edits: ticketRows.filter((row) => row.draftQuality === "no_edit" || row.draftQuality === "minor_edit").slice(0, 25),
    major_edits: ticketRows.filter((row) => row.draftQuality === "major_edit").slice(0, 25),
    highest_edit_pct: [...ticketRows]
      .filter((row) => row.draftEditPct != null)
      .sort((a, b) => b.draftEditPct - a.draftEditPct)
      .slice(0, 25),
    rejected_drafts: ticketRows
      .filter((row) => (draftsByThreadId[row.id] || []).some((draft) => ["rejected", "declined"].includes(String(draft.status || "").toLowerCase())))
      .slice(0, 25),
    slow_first_replies: [...ticketRows]
      .filter((row) => row.firstReplyMinutes != null)
      .sort((a, b) => b.firstReplyMinutes - a.firstReplyMinutes)
      .slice(0, 25),
  };
  for (const item of requestTypes) {
    byKey[item.key] = ticketRows.filter((row) => row.tags.some((tag) => slugify(tag) === item.key.replace("topic:", ""))).slice(0, 25);
  }
  for (const item of products) {
    byKey[item.key] = ticketRows.filter((row) => slugify(row.product) === item.key.replace("product:", "")).slice(0, 25);
  }
  for (const item of issueDescriptions) {
    byKey[item.key] = ticketRows.filter((row) => slugify(cleanIssueDescription(row.issueSummary || "")) === item.key.replace("issue:", "")).slice(0, 25);
  }
  for (const item of topActionTypes) {
    byKey[item.key] = ticketRows.filter((row) => (actionsByThreadId[row.id] || []).some((action) => slugify(action.action_type) === item.key.replace("action:", ""))).slice(0, 25);
  }
  for (const item of categoryRows) {
    byKey[item.key] = ticketRows
      .filter((row) => {
        const thread = threadById[row.id];
        return thread && slugify(primaryCategoryForThread(thread, tagsByThreadId)) === item.key.replace("sona-category:", "");
      })
      .slice(0, 25);
  }

  const noMinorEditCount = qualityCounts.no_edit + qualityCounts.minor_edit;
  const actionHandled = actionsApproved + actionsApplied;

  return {
    supportTickets: threadRows.length,
    solvedTickets,
    oneTouchTickets,
    firstReplyMinutes,
    resolutionMinutes,
    medianFirstReplyMinutes: median(firstReplyMinutes),
    medianResolutionMinutes: median(resolutionMinutes),
    responseTimeTrackedTickets: repliedTickets,
    totalAgentReplies,
    drafts,
    draftsGenerated,
    draftedThreadIds,
    qualityData,
    qualityCounts,
    noMinorEditCount,
    editDeltaAvg: editDeltaCount > 0 ? Math.round((editDeltaSum / editDeltaCount) * 100) : null,
    editDistanceAvg: editDistanceCount > 0 ? Math.round(editDistanceSum / editDistanceCount) : null,
    actionsSuggested: actions.filter((row) => threadIds.includes(row.thread_id)).length,
    actionsApproved,
    actionsApplied,
    actionsDeclined,
    actionsPending,
    actionHandled,
    topActionTypes,
    bestWorkflowTypes,
    needsReviewWorkflowTypes,
    autopilotCandidates,
    bestPerformingCategories,
    needsReviewCategories,
    mostAssistedTopics,
    volumeSeries,
    grouping,
    requestTypes,
    products,
    issueDescriptions,
    fastestTopics,
    slowestTopics,
    highVolumeSlowResponse,
    ticketRows,
    byKey,
    coverage: {
      taggedRate: pct(Object.keys(tagsByThreadId).length, threadRows.length),
      draftTrackingRate: pct(qualityData.length, Math.max(draftsGenerated, 1)),
      responseTimeRate: pct(repliedTickets, threadRows.length),
      productDetectionRate: pct(products.reduce((sum, row) => sum + row.count, 0), threadRows.length),
      issueMetadataRate: pct(issueDescriptions.reduce((sum, row) => sum + row.count, 0), threadRows.length),
    },
  };
}

function buildStructuredPayload({ windowInfo, current, previous }) {
  const supportTicketsChangePct = previous ? changePct(current.supportTickets, previous.supportTickets) : null;
  const currentUnsolved = current.supportTickets - current.solvedTickets;
  const previousUnsolved = previous ? previous.supportTickets - previous.solvedTickets : null;
  const unsolvedTicketsChangePct = previousUnsolved != null ? changePct(currentUnsolved, previousUnsolved) : null;
  const medianFirstReplyChangePct = previous
    ? changePct(current.medianFirstReplyMinutes ?? NaN, previous.medianFirstReplyMinutes ?? NaN)
    : null;
  const noMinorEditRate = pct(current.noMinorEditCount, current.qualityData.length);
  const previousNoMinorEditRate = previous ? pct(previous.noMinorEditCount, previous.qualityData.length) : null;
  const actionApprovalRate = pct(current.actionHandled, current.actionsSuggested);
  const draftQualityTotal = current.qualityData.length + current.qualityCounts.rejected;
  const noMinorDraftQualityRate = pct(current.noMinorEditCount, draftQualityTotal);
  const readyCandidateCount = current.autopilotCandidates.readyToTest.length;
  const estimatedWorkMinutes = (current.draftsGenerated * 3) + (current.actionHandled * 5);
  const autopilotReadiness = draftQualityTotal < 3
    ? {
        value: null,
        label: "Collecting data",
        status: "collecting",
        description: "Needs more sent drafts",
      }
    : readyCandidateCount > 0
      ? {
          value: readyCandidateCount,
          label: `${readyCandidateCount} ${readyCandidateCount === 1 ? "candidate" : "candidates"} ready to test`,
          status: "ready",
          description: "Based on draft quality and workflow approval",
        }
      : noMinorDraftQualityRate >= 70 && actionApprovalRate >= 70
        ? {
            value: noMinorDraftQualityRate,
            label: `${noMinorDraftQualityRate}%`,
            status: "ready",
            description: "Drafts needing no or minor edits",
          }
        : {
            value: noMinorDraftQualityRate,
            label: `${noMinorDraftQualityRate}%`,
            status: "needs_review",
            description: "Keep human review for now",
          };

  return {
    period: {
      key: windowInfo.key,
      label: windowInfo.label,
      start: toIsoDate(windowInfo.currentSince),
      end: toIsoDate(windowInfo.currentUntil),
      grouping: current.grouping,
    },
    previousPeriod: windowInfo.previousSince
      ? {
          start: toIsoDate(windowInfo.previousSince),
          end: toIsoDate(windowInfo.previousUntil),
        }
      : null,
    summary: {
      supportTickets: current.supportTickets,
      supportTicketsChangePct,
      unsolvedTickets: currentUnsolved,
      unsolvedTicketsChangePct,
      solvedTickets: current.solvedTickets,
      medianFirstReplyMinutes: current.medianFirstReplyMinutes,
      medianFirstReplyChangePct,
      firstReplyDataQuality:
        current.responseTimeTrackedTickets > 0 ? "available" : "limited",
      sonaAssistedReplies: current.draftsGenerated,
      sonaAssistedTickets: current.draftedThreadIds.size,
      sonaAssistedRate: pct(current.draftedThreadIds.size, current.supportTickets),
      noMinorEditRate: current.qualityData.length > 0 ? noMinorEditRate : null,
      noMinorEditRateChangePct:
        previous && previousNoMinorEditRate != null ? changePct(noMinorEditRate, previousNoMinorEditRate) : null,
      noMinorEditCount: current.noMinorEditCount,
      trackedSentDrafts: current.qualityData.length,
    },
    sonaImpact: {
      aiAssistedTickets: current.draftedThreadIds.size,
      aiAssistedReplies: current.draftsGenerated,
      draftsCreated: current.draftsGenerated,
      draftsGenerated: current.draftsGenerated,
      autopilotReadiness,
      averageEditEffort: {
        value: current.editDeltaAvg,
        averageEditPct: current.editDeltaAvg,
        averageEditDistance: current.editDistanceAvg,
        status: current.editDeltaAvg == null ? "collecting" : "available",
      },
      workflowApproval: {
        actionsSuggested: current.actionsSuggested,
        actionsHandled: current.actionHandled,
        approvalRate: actionApprovalRate,
        status: current.actionsSuggested > 0 ? "available" : "collecting",
      },
      estimatedWorkAssisted: {
        minutes: estimatedWorkMinutes,
        label: estimatedWorkMinutes >= 60
          ? `${Number((estimatedWorkMinutes / 60).toFixed(1))} hrs`
          : `${estimatedWorkMinutes} min`,
        calculationNote: "Estimate: 3 min per draft and 5 min per handled workflow",
      },
      sentAsIs: current.qualityCounts.no_edit,
      minorEdits: current.qualityCounts.minor_edit,
      majorEdits: current.qualityCounts.major_edit,
      rejectedDrafts: current.qualityCounts.rejected,
      rejected: current.qualityCounts.rejected,
      trackedSentDrafts: current.qualityData.length,
      draftQualityTotal,
      draftQualityBreakdown: {
        total: draftQualityTotal,
        sentAsIs: { count: current.qualityCounts.no_edit, pct: pct(current.qualityCounts.no_edit, draftQualityTotal) },
        minorEdits: { count: current.qualityCounts.minor_edit, pct: pct(current.qualityCounts.minor_edit, draftQualityTotal) },
        majorEdits: { count: current.qualityCounts.major_edit, pct: pct(current.qualityCounts.major_edit, draftQualityTotal) },
        rejected: { count: current.qualityCounts.rejected, pct: pct(current.qualityCounts.rejected, draftQualityTotal) },
      },
      sentAsIsRate: pct(current.qualityCounts.no_edit, draftQualityTotal),
      minorEditRate: pct(current.qualityCounts.minor_edit, draftQualityTotal),
      majorEditRate: pct(current.qualityCounts.major_edit, draftQualityTotal),
      rejectedDraftRate: pct(current.qualityCounts.rejected, draftQualityTotal),
      noMinorEditRate: pct(current.noMinorEditCount, draftQualityTotal),
      draftQualityCoverage: pct(draftQualityTotal, Math.max(current.draftsGenerated, 1)),
      averageEditPct: current.editDeltaAvg,
      averageEditDistance: current.editDistanceAvg,
      avgEditedPct: current.editDeltaAvg,
      actionsSuggested: current.actionsSuggested,
      actionsApproved: current.actionsApproved,
      actionsApplied: current.actionsApplied,
      actionsHandled: current.actionHandled,
      actionsPending: current.actionsPending,
      actionsDeclined: current.actionsDeclined,
      actionApprovalRate,
      actionHandledRate: actionApprovalRate,
      topActionTypes: current.topActionTypes,
      topWorkflows: current.topActionTypes,
      bestWorkflowTypes: current.bestWorkflowTypes,
      needsReviewWorkflowTypes: current.needsReviewWorkflowTypes,
      autopilotCandidates: current.autopilotCandidates,
      bestPerformingCategories: current.bestPerformingCategories,
      needsReviewCategories: current.needsReviewCategories,
      mostAssistedTopics: current.mostAssistedTopics,
      performanceInsights: {
        bestCategories: current.bestPerformingCategories,
        needsReviewCategories: current.needsReviewCategories,
        mostAssistedTopics: current.mostAssistedTopics,
      },
    },
    volume: {
      total: current.supportTickets,
      previousTotal: previous?.supportTickets ?? null,
      changePct: supportTicketsChangePct,
      grouping: current.grouping,
      series: current.volumeSeries,
      note: "Excludes notifications, spam and non-support emails when classification data is available.",
    },
    topics: {
      requestTypes: current.requestTypes,
      products: current.products,
      issueDescriptions: current.issueDescriptions,
    },
    strengthsWeakSpots: {
      metric: "median_first_reply",
      resolutionTimeAvailable: false,
      resolutionTimeNote: "Resolution time requires resolved_at tracking before it can be used as a primary metric.",
      fastestTopics: current.fastestTopics,
      slowestTopics: current.slowestTopics,
      highVolumeSlowResponse: current.highVolumeSlowResponse,
    },
    previousSystemComparison: null,
    drilldowns: {
      defaultKey: "all",
      defaultTickets: current.byKey.all,
      byKey: current.byKey,
    },
    coverage: current.coverage,
    supportKpis: {
      createdTickets: current.supportTickets,
      solvedTickets: current.solvedTickets,
      unsolvedTickets: current.supportTickets - current.solvedTickets,
      oneTouchTickets: current.oneTouchTickets,
      oneTouchRate: pct(current.oneTouchTickets, current.solvedTickets),
      reopenedTickets: null,
      reopenedRate: null,
      medianFirstReplyMinutes: current.medianFirstReplyMinutes,
      medianResolutionMinutes: current.medianResolutionMinutes,
      firstReplyBrackets: computeFirstReplyBrackets(current.firstReplyMinutes, current.supportTickets),
      resolutionBrackets: computeResolutionBrackets(current.resolutionMinutes),
    },

    // Legacy fields kept while other internal consumers migrate to the structured payload.
    tickets_total: current.supportTickets,
    drafts_total: current.draftsGenerated,
    drafts_made: current.drafts.length,
    edited_before_send_pct: current.qualityData.length > 0
      ? pct(current.qualityCounts.minor_edit + current.qualityCounts.major_edit, current.qualityData.length)
      : 0,
    edited_before_send_count: current.qualityCounts.minor_edit + current.qualityCounts.major_edit,
    tracked_sent_drafts: current.qualityData.length,
    volume_by_day: current.volumeSeries,
    volume_by_month: current.volumeSeries,
    ticket_types: current.requestTypes.map((row) => ({ tag: row.label, count: row.count, color: row.color })),
    support: {
      created_tickets: current.supportTickets,
      solved_tickets: current.solvedTickets,
      unsolved_tickets: current.supportTickets - current.solvedTickets,
      first_reply_time_median_min: current.medianFirstReplyMinutes,
      full_resolution_time_median_min: null,
      reply_coverage_pct: current.coverage.responseTimeRate,
      slow_first_reply_tickets: current.byKey.slow_first_replies,
      slow_resolution_tickets: [],
    },
    actions: {
      total: current.actionsSuggested,
      applied: current.actionsApplied,
      pending: current.actionsPending,
      approved: current.actionsApproved,
      declined: current.actionsDeclined,
      completion_pct: actionApprovalRate,
      by_type: current.topActionTypes.map((row) => ({
        type: row.type,
        total: row.suggested,
        applied: row.applied,
        pending: row.pending,
        declined: row.declined,
        approved: row.approved,
      })),
    },
    draft_quality: {
      total: current.qualityData.length,
      no_edit: current.qualityCounts.no_edit,
      minor_edit: current.qualityCounts.minor_edit,
      major_edit: current.qualityCounts.major_edit,
      no_edit_pct: pct(current.qualityCounts.no_edit, current.qualityData.length),
      minor_edit_pct: pct(current.qualityCounts.minor_edit, current.qualityData.length),
      major_edit_pct: pct(current.qualityCounts.major_edit, current.qualityData.length),
      avg_edited_pct: current.editDeltaAvg,
      avg_edit_distance: current.editDistanceAvg,
      by_tag: current.bestPerformingCategories.map((row) => ({
        tag: row.category,
        total: row.count,
        major_edit_pct: 100 - row.noMinorEditRate,
        no_minor_edit_pct: row.noMinorEditRate,
      })),
    },
    previous: previous
      ? {
          tickets_total: previous.supportTickets,
          first_reply_time_median_min: previous.medianFirstReplyMinutes,
          drafts_made: previous.drafts.length,
          actions_applied: previous.actionsApplied,
          actions_completion_pct: pct(previous.actionHandled, previous.actionsSuggested),
          ai_accepted_pct: pct(previous.qualityCounts.no_edit, previous.qualityData.length),
        }
      : null,
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
    scope = await resolveAuthScope(serviceClient, { clerkUserId: clerkUserId, orgId });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  if (!scope?.workspaceId && !scope?.supabaseUserId) {
    return NextResponse.json({ error: "Could not resolve user scope." }, { status: 401 });
  }

  try {
    const windowInfo = customWindow || periodToWindow(period);
    const fetchPrevious = windowInfo.previousSince && windowInfo.previousUntil
      ? fetchPeriodMetrics(serviceClient, scope, windowInfo.previousSince, windowInfo.previousUntil)
      : Promise.resolve(null);

    const [current, previous] = await Promise.all([
      fetchPeriodMetrics(serviceClient, scope, windowInfo.currentSince, windowInfo.currentUntil),
      fetchPrevious,
    ]);

    return NextResponse.json(buildStructuredPayload({ windowInfo, current, previous }));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
