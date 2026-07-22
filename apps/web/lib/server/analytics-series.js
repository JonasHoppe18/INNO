function bucketKey(value, grouping) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (grouping === "month") return date.toISOString().slice(0, 7);
  if (grouping === "week") {
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() - (day - 1));
  }
  return date.toISOString().slice(0, 10);
}

function increment(map, key, field, amount = 1) {
  if (!key) return;
  if (!map[key]) map[key] = { date: key };
  map[key][field] = (map[key][field] || 0) + amount;
}

function sortedRows(map, defaults) {
  return Object.values(map)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((row) => ({ ...defaults, ...row }));
}

export function calculateFirstContactResolution({
  threads = [],
  lifecycleEvents = [],
  agentReplyCountsByThreadId = {},
  observationEnd = new Date().toISOString(),
  observationDays = 7,
}) {
  const observationEndMs = new Date(observationEnd).getTime();
  const observationWindowMs = observationDays * 24 * 60 * 60 * 1000;
  const threadIds = new Set(threads.map((thread) => thread.id).filter(Boolean));
  const firstResolvedAt = new Map();
  const reopenedAt = new Map();

  for (const event of lifecycleEvents) {
    if (!threadIds.has(event.thread_id) || !event.occurred_at) continue;
    const occurredAtMs = new Date(event.occurred_at).getTime();
    if (!Number.isFinite(occurredAtMs)) continue;
    if (event.event_type === "resolved") {
      const existing = firstResolvedAt.get(event.thread_id);
      if (existing == null || occurredAtMs < existing) firstResolvedAt.set(event.thread_id, occurredAtMs);
    } else if (event.event_type === "reopened") {
      if (!reopenedAt.has(event.thread_id)) reopenedAt.set(event.thread_id, []);
      reopenedAt.get(event.thread_id).push(occurredAtMs);
    }
  }

  const eligibleThreadIds = new Set();
  const firstContactResolvedThreadIds = new Set();
  if (!Number.isFinite(observationEndMs) || !Number.isFinite(observationWindowMs) || observationWindowMs < 0) {
    return { observationDays, eligibleTickets: 0, firstContactResolvedTickets: 0, rate: null, eligibleThreadIds, firstContactResolvedThreadIds };
  }

  for (const [threadId, resolvedAtMs] of firstResolvedAt) {
    const observationCutoffMs = resolvedAtMs + observationWindowMs;
    if (observationCutoffMs > observationEndMs) continue;
    eligibleThreadIds.add(threadId);
    const reopenedWithinWindow = (reopenedAt.get(threadId) || []).some(
      (timestamp) => timestamp >= resolvedAtMs && timestamp <= observationCutoffMs,
    );
    if (Number(agentReplyCountsByThreadId[threadId] || 0) === 1 && !reopenedWithinWindow) {
      firstContactResolvedThreadIds.add(threadId);
    }
  }

  return {
    observationDays,
    eligibleTickets: eligibleThreadIds.size,
    firstContactResolvedTickets: firstContactResolvedThreadIds.size,
    rate: eligibleThreadIds.size > 0
      ? Math.round((firstContactResolvedThreadIds.size / eligibleThreadIds.size) * 100)
      : null,
    eligibleThreadIds,
    firstContactResolvedThreadIds,
  };
}

export function buildAnalyticsTrendSeries({
  grouping,
  threads = [],
  lifecycleEvents = [],
  orders = [],
  refunds = [],
  returnCases = [],
  linkedThreadIds = new Set(),
  assistedThreadIds = new Set(),
  isSolvedThread = () => false,
}) {
  const supportMap = {};
  const commerceMap = {};
  const sonaMap = {};
  const resolvedThreadIds = new Set();
  const firstResolvedAt = new Map();

  for (const thread of threads) {
    const key = bucketKey(thread.created_at, grouping);
    increment(supportMap, key, "created");
    increment(sonaMap, key, "supportTickets");
    if (linkedThreadIds.has(thread.id)) increment(commerceMap, key, "linkedTickets");
    if (assistedThreadIds.has(thread.id)) increment(sonaMap, key, "assistedTickets");
  }

  for (const event of lifecycleEvents) {
    if (event.event_type !== "resolved" || !event.thread_id || !event.occurred_at) continue;
    const existing = firstResolvedAt.get(event.thread_id);
    if (!existing || new Date(event.occurred_at).getTime() < new Date(existing).getTime()) firstResolvedAt.set(event.thread_id, event.occurred_at);
  }
  for (const [threadId, occurredAt] of firstResolvedAt) {
    const key = bucketKey(occurredAt, grouping);
    if (!key) continue;
    resolvedThreadIds.add(threadId);
    increment(supportMap, key, "solved");
  }

  let solvedProxyCount = 0;
  for (const thread of threads) {
    if (!isSolvedThread(thread) || resolvedThreadIds.has(thread.id)) continue;
    const key = bucketKey(thread.updated_at, grouping);
    if (!key) continue;
    solvedProxyCount += 1;
    increment(supportMap, key, "solved");
  }

  for (const order of orders) increment(commerceMap, bucketKey(order.order_created_at, grouping), "orders");
  for (const row of returnCases) increment(commerceMap, bucketKey(row.created_at, grouping), "returnCases");
  for (const refund of refunds) increment(commerceMap, bucketKey(refund.refunded_at, grouping), "refunds");

  const supportSeries = sortedRows(supportMap, { created: 0, solved: 0 });
  const commerceSeries = sortedRows(commerceMap, {
    orders: 0,
    linkedTickets: 0,
    ticketsPer100Orders: null,
    returnCases: 0,
    refunds: 0,
  }).map((row) => ({
    ...row,
    ticketsPer100Orders: row.orders > 0
      ? Number(((row.linkedTickets / row.orders) * 100).toFixed(1))
      : null,
  }));
  const sonaSeries = sortedRows(sonaMap, {
    supportTickets: 0,
    assistedTickets: 0,
    assistedRate: null,
  }).map((row) => ({
    ...row,
    assistedRate: row.supportTickets > 0
      ? Math.round((row.assistedTickets / row.supportTickets) * 100)
      : null,
  }));

  return {
    support: {
      series: supportSeries,
      solvedDataQuality: solvedProxyCount > 0 ? "proxy_included" : "measured",
      solvedProxyCount,
    },
    commerce: { series: commerceSeries },
    sona: { series: sonaSeries },
  };
}

export function buildPrioritySignals({
  unsolvedTickets = 0,
  unsolvedTicketsChangePct = null,
  medianFirstReplyChangePct = null,
  highVolumeSlowResponse = [],
  ticketsPer100OrdersChangePct = null,
  refundRateChangePct = null,
  readyCandidates = [],
}) {
  const signals = [];

  if (unsolvedTicketsChangePct > 0) {
    signals.push({
      type: "support",
      severity: "attention",
      title: "Open backlog is growing",
      detail: `${unsolvedTickets} open tickets · +${unsolvedTicketsChangePct}% vs previous period`,
      metricKey: "open_backlog",
      drilldownKey: "unsolved_tickets",
    });
  } else if (medianFirstReplyChangePct > 0) {
    signals.push({
      type: "support",
      severity: "attention",
      title: "First replies are getting slower",
      detail: `Median response time increased ${medianFirstReplyChangePct}% vs previous period`,
      metricKey: "median_first_reply",
      drilldownKey: "slow_first_replies",
    });
  }

  const slowTopic = highVolumeSlowResponse[0];
  if (slowTopic) {
    signals.push({
      type: "friction",
      severity: "watch",
      title: slowTopic.topic,
      detail: `${slowTopic.count} requests · slow median first reply`,
      metricKey: "high_volume_slow_response",
      drilldownKey: slowTopic.key,
    });
  }

  if (ticketsPer100OrdersChangePct > 0) {
    signals.push({
      type: "business",
      severity: "watch",
      title: "More support per order",
      detail: `Tickets per 100 orders increased ${ticketsPer100OrdersChangePct}%`,
      metricKey: "tickets_per_100_orders",
      drilldownKey: "support_tickets",
    });
  } else if (refundRateChangePct > 0) {
    signals.push({
      type: "business",
      severity: "watch",
      title: "Refund rate is increasing",
      detail: `Refund rate increased ${refundRateChangePct}% vs previous period`,
      metricKey: "refund_rate",
      drilldownKey: "refund_requests",
    });
  }

  const candidate = readyCandidates[0];
  if (candidate) {
    signals.push({
      type: "automation",
      severity: "opportunity",
      title: candidate.label,
      detail: candidate.reason || "Ready for a controlled automation test",
      metricKey: "automation_candidate",
      drilldownKey: candidate.key,
    });
  }

  return signals.slice(0, 4);
}
