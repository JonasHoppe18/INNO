function formatDurationMinutes(minutes) {
  if (minutes == null || Number.isNaN(Number(minutes))) return "-";
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hrs`;
  const days = hours / 24;
  return `${Number.isInteger(days) ? days : days.toFixed(1)} days`;
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function exportAnalyticsToExcel(data, periodLabel) {
  const mod = await import("xlsx");
  const XLSX = mod.default ?? mod;

  const wb = XLSX.utils.book_new();
  const filename = `sona-analytics-${slugify(periodLabel) || "export"}.xlsx`;

  // Sheet 1: Overview
  const summary = data?.summary ?? {};
  const impact = data?.sonaImpact ?? {};
  const estimatedWork = impact.estimatedWorkAssisted ?? {};
  const draftQualityTotal = impact.draftQualityTotal || 0;
  const hasEnoughDraftQuality = (impact.trackedSentDrafts || 0) >= 3;

  const overviewRows = [
    ["Metric", "Value"],
    ["Period", data?.period?.label || periodLabel],
    ["Start", data?.period?.start || ""],
    ["End", data?.period?.end || ""],
    [],
    ["SONA AI"],
    ["Time saved", estimatedWork.label || "Collecting data"],
    [
      "Drafts sent as-is",
      hasEnoughDraftQuality ? impact.sentAsIs ?? 0 : "Collecting data",
    ],
    [
      "Drafts sent as-is (%)",
      hasEnoughDraftQuality && draftQualityTotal > 0
        ? `${Math.round(((impact.sentAsIs || 0) / draftQualityTotal) * 100)}%`
        : "Collecting data",
    ],
    [
      "Avg edit effort",
      hasEnoughDraftQuality && impact.averageEditPct != null
        ? `${impact.averageEditPct}%`
        : "Collecting data",
    ],
    [
      "Automation rate",
      impact.actionApprovalRate != null
        ? `${impact.actionApprovalRate}%`
        : "-",
    ],
    [],
    ["SUPPORT"],
    ["Support requests", summary.supportTickets ?? ""],
    ["Unsolved tickets", summary.unsolvedTickets ?? ""],
    ["Solved tickets", summary.solvedTickets ?? ""],
    ["Median first reply", formatDurationMinutes(summary.medianFirstReplyMinutes)],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(overviewRows),
    "Overview",
  );

  // Sheet 2: Tickets over time
  const volume = data?.volume ?? {};
  const timeRows = [
    ["Date", "Tickets"],
    ...(volume.series ?? []).map((row) => [row.date, row.count]),
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(timeRows),
    "Tickets over time",
  );

  // Sheet 3: Topics
  const topics = data?.topics ?? {};
  const topicsRows = [
    ["REQUEST TYPES"],
    ["Label", "Count", "% of tickets"],
    ...(topics.requestTypes ?? []).map((row) => [
      row.label,
      row.count,
      `${row.pct}%`,
    ]),
    [],
    ["PRODUCTS"],
    ["Label", "Count", "% of tickets"],
    ...(topics.products ?? []).map((row) => [
      row.label,
      row.count,
      `${row.pct}%`,
    ]),
    [],
    ["ISSUE DESCRIPTIONS"],
    ["Label", "Count", "% of tickets"],
    ...(topics.issueDescriptions ?? []).map((row) => [
      row.label,
      row.count,
      `${row.pct}%`,
    ]),
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(topicsRows),
    "Topics",
  );

  // Sheet 4: Support KPIs
  const kpis = data?.supportKpis ?? {};
  const kpisRows = [
    ["FIRST REPLY TIME"],
    ["Bracket", "Count", "%"],
    ...(kpis.firstReplyBrackets ?? []).map((row) => [
      row.label,
      row.count,
      `${row.pct}%`,
    ]),
    [],
    ["RESOLUTION TIME"],
    ["Bracket", "Count", "%"],
    ...(kpis.resolutionBrackets ?? []).map((row) => [
      row.label,
      row.count,
      `${row.pct}%`,
    ]),
    [],
    ["MEDIANS"],
    ["Median first reply", formatDurationMinutes(kpis.medianFirstReplyMinutes)],
    [
      "Median resolution time",
      formatDurationMinutes(kpis.medianResolutionMinutes),
    ],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(kpisRows),
    "Support KPIs",
  );

  // Sheet 5: Ticket list
  const tickets = data?.drilldowns?.defaultTickets ?? [];
  const ticketRows = [
    [
      "Ticket #",
      "Subject",
      "Customer",
      "Status",
      "Request type",
      "Product",
      "Created",
      "Updated",
      "First reply (min)",
      "Sona usage",
    ],
    ...tickets.map((t) => [
      t.ticketNumber || t.id,
      t.subject,
      t.customer,
      t.status,
      t.requestType,
      t.product || "",
      t.createdAt ? String(t.createdAt).slice(0, 10) : "",
      t.updatedAt ? String(t.updatedAt).slice(0, 10) : "",
      t.firstReplyMinutes ?? "",
      t.sonaUsage,
    ]),
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(ticketRows),
    "Ticket list",
  );

  XLSX.writeFile(wb, filename);
}
