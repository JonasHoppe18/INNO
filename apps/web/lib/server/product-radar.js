// Product Radar: per-product ticket trends and alert rules. See docs/product-radar.md.
// Windows are rolling 7-day weeks anchored at `now`, independent of any period picker.

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const SUPPORT_CLASSIFICATION_KEY = "support";

export const RADAR_RULES = {
  weeks: 12,
  // Spike: the current week against the mean of the 8 weeks before it.
  spikeBaselineWeeks: 8,
  spikeMinCurrent: 5,
  spikeRatio: 3,
  // Rising: the last 4 weeks against the mean of the 8 weeks before them.
  risingRecentWeeks: 4,
  risingPriorWeeks: 8,
  risingRatio: 2,
  risingMinRecent: 12,
  // A trend must hold this many consecutive weeks. One rising week after a quiet
  // spell is usually a return to normal (backtest: A-Spire, 2026-08-15).
  risingConfirmWeeks: 2,
  recentIssues: 5,
};

// Weeks of history needed so every confirmation week has a full trend window.
function historyWeeks(rules) {
  return rules.weeks + rules.risingConfirmWeeks - 1;
}

const STATUS_ORDER = { spike: 0, rising: 1, steady: 2 };

export function isSupportThread(thread) {
  const classification = String(thread?.classification_key || "").trim().toLowerCase();
  if (classification && classification !== SUPPORT_CLASSIFICATION_KEY) return false;
  const tags = Array.isArray(thread?.tags) ? thread.tags : [];
  if (tags.some((tag) => String(tag).startsWith("inbox:"))) return false;
  return true;
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function trendWindow(weekly, rules) {
  const recent = weekly.slice(-rules.risingRecentWeeks);
  const prior = weekly.slice(-rules.risingRecentWeeks - rules.risingPriorWeeks, -rules.risingRecentWeeks);
  const recentTotal = recent.reduce((sum, value) => sum + value, 0);
  const recentMean = mean(recent);
  const priorMean = mean(prior);
  const rising = recentTotal >= rules.risingMinRecent && recentMean >= rules.risingRatio * Math.max(priorMean, 1);
  return { rising, recentTotal, recentMean, priorMean };
}

// `weekly` is ordered oldest -> newest; the last entry is the current 7 days.
export function classifyProductSignal(weekly, rules = RADAR_RULES) {
  const current = weekly.at(-1) ?? 0;
  const baseline = mean(weekly.slice(-1 - rules.spikeBaselineWeeks, -1));
  const { rising, recentTotal, recentMean, priorMean } = trendWindow(weekly, rules);

  let status = "steady";
  if (current >= rules.spikeMinCurrent && current >= rules.spikeRatio * Math.max(baseline, 1)) {
    status = "spike";
  } else if (rising) {
    let confirmed = true;
    for (let back = 1; back < rules.risingConfirmWeeks; back += 1) {
      if (!trendWindow(weekly.slice(0, -back), rules).rising) confirmed = false;
    }
    if (confirmed) status = "rising";
  }

  return { status, current, baseline, recentTotal, recentMean, priorMean };
}

export function buildProductRadar({ threads = [], productMap = {}, now = new Date(), rules = RADAR_RULES }) {
  const nowMs = new Date(now).getTime();
  const history = historyWeeks(rules);
  const historyStartMs = nowMs - history * WEEK_MS;
  const shownStartMs = nowMs - rules.weeks * WEEK_MS;
  const byProduct = new Map();
  let supportTickets = 0;
  let linkedTickets = 0;

  for (const thread of threads) {
    const createdMs = new Date(thread?.created_at).getTime();
    if (!Number.isFinite(createdMs) || createdMs < historyStartMs || createdMs >= nowMs) continue;
    if (!isSupportThread(thread)) continue;
    const shown = createdMs >= shownStartMs;
    if (shown) supportTickets += 1;
    if (!thread.detected_product_id) continue;
    if (shown) linkedTickets += 1;

    const productId = String(thread.detected_product_id);
    if (!byProduct.has(productId)) byProduct.set(productId, { counts: Array(history).fill(0), threads: [] });
    const entry = byProduct.get(productId);
    const weeksAgo = Math.floor((nowMs - createdMs) / WEEK_MS);
    entry.counts[history - 1 - weeksAgo] += 1;
    if (shown) entry.threads.push({ thread, createdMs });
  }

  const products = [...byProduct.entries()].map(([productId, { counts, threads: productThreads }]) => {
    const signal = classifyProductSignal(counts, rules);
    const weekly = counts.slice(-rules.weeks).map((count, index) => ({
      weekStart: new Date(nowMs - (rules.weeks - index) * WEEK_MS).toISOString().slice(0, 10),
      count,
    }));
    const recentIssues = productThreads
      .filter(({ thread }) => String(thread.issue_summary || "").trim())
      .sort((a, b) => b.createdMs - a.createdMs)
      .slice(0, rules.recentIssues)
      .map(({ thread }) => ({ threadId: thread.id, summary: thread.issue_summary.trim(), createdAt: thread.created_at }));

    return {
      productId,
      name: productMap[productId] || `Product #${productId}`,
      ...signal,
      total: weekly.reduce((sum, week) => sum + week.count, 0),
      weekly,
      recentIssues,
    };
  }).filter((row) => row.total > 0);

  products.sort((a, b) =>
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    || b.current - a.current
    || b.total - a.total
    || a.name.localeCompare(b.name));

  return {
    products,
    alerts: products.filter((row) => row.status !== "steady"),
    coverage: {
      supportTickets,
      linkedTickets,
      pct: supportTickets ? Math.round((linkedTickets / supportTickets) * 100) : 0,
    },
  };
}
