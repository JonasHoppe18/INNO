// Wording for the Dashboard's "This week" cards. Each card returns its value,
// an optional change pill (with whether the change is good) and a detail line.

export function formatMinutes(minutes) {
  if (minutes == null) return "—";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const rest = Math.round(minutes % 60);
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
  }
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function percentChange(value, previous, { lowerIsBetter = false } = {}) {
  if (value == null || previous == null || previous === 0) return null;
  const pct = Math.round(((value - previous) / previous) * 100);
  if (pct === 0) return { label: "0%", good: true };
  return { label: `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`, good: lowerIsBetter ? pct < 0 : pct > 0 };
}

function pointChange(value, previous, unit = "") {
  if (value == null || previous == null) return null;
  const diff = Number((value - previous).toFixed(1));
  if (diff === 0) return { label: `0${unit}`, good: true };
  return { label: `${diff > 0 ? "+" : "−"}${Math.abs(diff)}${unit}`, good: diff > 0 };
}

export function weekCards(stats) {
  if (!stats) return [];
  const { resolved, firstHumanReplyMinutes: reply, csat, sonaDraftedPct: drafted } = stats;
  return [
    {
      key: "resolved",
      label: "Resolved",
      value: String(resolved.value ?? 0),
      change: percentChange(resolved.value, resolved.previous),
      detail: "Tickets closed in the last 7 days",
      series: resolved.series,
    },
    {
      key: "reply",
      label: "First human reply",
      value: formatMinutes(reply.value),
      change: percentChange(reply.value, reply.previous, { lowerIsBetter: true }),
      detail: reply.value == null ? "No replies in the last 7 days" : "Median, confirmations excluded",
      series: reply.series,
      lowerIsBetter: true,
    },
    {
      key: "csat",
      label: "CSAT",
      value: csat.value == null ? "—" : csat.value.toFixed(1),
      change: pointChange(csat.value, csat.previous),
      detail: csat.responses ? `${csat.responses} response${csat.responses === 1 ? "" : "s"}` : "No responses in the last 7 days",
      series: csat.series,
    },
    {
      key: "drafted",
      label: "Sona drafted",
      value: drafted.value == null ? "—" : `${drafted.value}%`,
      change: pointChange(drafted.value, drafted.previous, " pts"),
      detail: drafted.tickets ? `Of ${drafted.tickets} support ticket${drafted.tickets === 1 ? "" : "s"}` : "No support tickets in the last 7 days",
      series: drafted.series,
    },
  ];
}
