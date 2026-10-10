// Shared wording for Product Radar signals (Analytics Products tab and Dashboard card).

export const RADAR_STATUS_LABEL = { spike: "Spike", rising: "Rising", steady: "Steady" };
export const RADAR_STATUS_BADGE = { spike: "warning", rising: "info", steady: "neutral" };

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function usualLabel(value) {
  const rounded = Math.round(Number(value) || 0);
  return rounded < 1 ? "usually none" : `usually ${rounded}`;
}

export function describeRadarSignal(row) {
  if (!row) return "";
  if (row.status === "spike") return `${plural(row.current, "ticket")} in the last 7 days (${usualLabel(row.baseline)})`;
  if (row.status === "rising") return `${plural(row.recentTotal, "ticket")} in the last 4 weeks (${usualLabel(row.priorMean * 4)})`;
  return `${plural(row.current, "ticket")} in the last 7 days`;
}

export function productRadarHref(productId) {
  const params = new URLSearchParams({ report: "products" });
  if (productId) params.set("product", String(productId));
  return `/analytics?${params.toString()}`;
}
