// "This week" on the Dashboard: four numbers with an 8-week series each.
// Weeks are rolling 7-day windows ending now, like the product radar.

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
export const WEEK_COUNT = 8;

function weekIndex(ms, nowMs) {
  if (!Number.isFinite(ms) || ms >= nowMs) return null;
  const weeksAgo = Math.floor((nowMs - ms) / WEEK_MS);
  return weeksAgo < WEEK_COUNT ? WEEK_COUNT - 1 - weeksAgo : null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function timeOf(message) {
  return Date.parse(message?.received_at || message?.sent_at || message?.created_at || "");
}

function metric(series) {
  return { value: series.at(-1), previous: series.at(-2) ?? null, series };
}

// threads: support threads created in the last 8 weeks.
// messages: their messages. autoReplyMessageIds: confirmation emails to ignore.
export function buildWeekStats({ threads = [], messages = [], autoReplyMessageIds = [], lifecycleEvents = [], feedback = [], now = new Date() }) {
  const nowMs = new Date(now).getTime();
  const autoReplies = new Set(autoReplyMessageIds.filter(Boolean));
  const empty = () => Array.from({ length: WEEK_COUNT }, () => []);

  // Resolved: one per thread per week, so reopen-and-close does not double count.
  const resolvedSeen = new Set();
  const resolved = Array(WEEK_COUNT).fill(0);
  for (const event of lifecycleEvents) {
    const type = String(event?.event_type || event?.to_status || "").toLowerCase();
    if (type !== "resolved") continue;
    const index = weekIndex(Date.parse(event.occurred_at), nowMs);
    const key = `${event.thread_id}:${index}`;
    if (index == null || resolvedSeen.has(key)) continue;
    resolvedSeen.add(key);
    resolved[index] += 1;
  }

  const byThread = new Map();
  for (const message of messages) {
    if (message?.is_draft) continue;
    if (!byThread.has(message.thread_id)) byThread.set(message.thread_id, []);
    byThread.get(message.thread_id).push(message);
  }

  // First human reply: from the first customer message to the first reply by a
  // person, bucketed by the week the customer wrote. Confirmations don't count.
  const replyMinutes = empty();
  const drafted = Array(WEEK_COUNT).fill(0);
  const supportCount = Array(WEEK_COUNT).fill(0);
  for (const thread of threads) {
    const createdIndex = weekIndex(Date.parse(thread.created_at), nowMs);
    const list = (byThread.get(thread.id) || []).filter((message) => Number.isFinite(timeOf(message)));
    if (createdIndex != null) {
      supportCount[createdIndex] += 1;
      if (list.some((message) => !message.from_me && message.ai_draft_text)) drafted[createdIndex] += 1;
    }
    const inbound = list.filter((message) => !message.from_me).sort((a, b) => timeOf(a) - timeOf(b))[0];
    if (!inbound) continue;
    const inboundAt = timeOf(inbound);
    const reply = list
      .filter((message) => message.from_me && !(message.provider_message_id && autoReplies.has(message.provider_message_id)))
      .map(timeOf)
      .filter((at) => at >= inboundAt)
      .sort((a, b) => a - b)[0];
    const index = weekIndex(inboundAt, nowMs);
    if (reply != null && index != null) replyMinutes[index].push(Math.round((reply - inboundAt) / 60000));
  }

  const scores = empty();
  for (const row of feedback) {
    const score = Number(row?.score);
    const index = weekIndex(Date.parse(row?.submitted_at), nowMs);
    if (Number.isFinite(score) && index != null) scores[index].push(score);
  }

  return {
    resolved: metric(resolved),
    firstHumanReplyMinutes: metric(replyMinutes.map(median)),
    csat: {
      ...metric(scores.map((week) => (week.length ? Number((week.reduce((a, b) => a + b, 0) / week.length).toFixed(1)) : null))),
      responses: scores.at(-1).length,
    },
    sonaDraftedPct: {
      ...metric(drafted.map((count, index) => (supportCount[index] ? Math.round((count / supportCount[index]) * 100) : null))),
      tickets: supportCount.at(-1),
    },
  };
}
