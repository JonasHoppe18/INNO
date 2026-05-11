"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Database,
  Download,
  FileBarChart,
  Gauge,
  Inbox,
  ListFilter,
  PackageSearch,
  Sparkles,
  Table2,
  TrendingUp,
  Zap,
} from "lucide-react";

import { TicketVolumeChart } from "@/components/analytics/TicketVolumeChart";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const PERIOD_OPTIONS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "this_month", label: "This month" },
];

const SUMMARY_META = {
  support_tickets: {
    icon: Inbox,
    label: "Support requests",
    description: "Real customer support volume",
  },
  first_reply: {
    icon: Gauge,
    label: "First reply time",
    description: "Median customer wait",
  },
  sona_assisted: {
    icon: Sparkles,
    label: "Sona-assisted tickets",
    description: "Tickets Sona helped with",
  },
  no_minor_edits: {
    icon: CheckCircle2,
    label: "Average edit",
    description: "How much Sona drafts change",
  },
};

const sectionMotionStyle = (index) => ({ animationDelay: `${index * 45}ms` });

function formatNumber(value) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return new Intl.NumberFormat("en-US").format(value);
}

function formatPercent(value) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return `${Math.round(value)}%`;
}

function formatRate(part, total) {
  if (!total || total <= 0) return "Collecting data";
  return formatPercent((part / total) * 100);
}

function formatDuration(minutes) {
  if (minutes == null || Number.isNaN(Number(minutes))) return "-";
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hrs`;
  const days = hours / 24;
  return `${Number.isInteger(days) ? days : days.toFixed(1)} days`;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDateLabel(value, fallback) {
  if (!value) return fallback;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatChange(value, { inverse = false } = {}) {
  if (value == null || Number.isNaN(Number(value))) {
    return { label: "No previous data", tone: "muted", Icon: null };
  }
  if (value === 0) return { label: "No change", tone: "muted", Icon: null };
  const improved = inverse ? value < 0 : value > 0;
  const Icon = value > 0 ? ArrowUpRight : ArrowDownRight;
  return {
    label: `${value > 0 ? "+" : ""}${value}% vs previous`,
    tone: improved ? "good" : "watch",
    Icon,
  };
}

function getPeriodButtonLabel(period, range) {
  if (range.start && range.end) {
    return `${formatDateLabel(range.start, "Start")} - ${formatDateLabel(range.end, "End")}`;
  }
  return PERIOD_OPTIONS.find((option) => option.value === period)?.label ?? "Date range";
}

function EmptyAnalyticsState({ icon: Icon = ListFilter, title, children, action }) {
  return (
    <div className="flex min-h-[100px] flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed p-5 text-center">
      <Icon className="size-4 text-muted-foreground/40" />
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      {children ? <p className="max-w-sm text-xs leading-5 text-muted-foreground/70">{children}</p> : null}
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}

function LoadingCard({ className = "h-40" }) {
  return <Skeleton className={className} />;
}

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "sona-impact", label: "Sona Impact" },
  { id: "topics", label: "Topics" },
  { id: "tickets", label: "Tickets" },
];

function AnalyticsHeader({ period, range, onPreset, onRangeChange, activeTab, onTabChange }) {
  const startRef = useRef(null);
  const endRef = useRef(null);

  const openPicker = (input) => {
    if (typeof input?.showPicker === "function") input.showPicker();
    else input?.focus();
  };

  return (
    <div className="border-b bg-background px-4 md:px-6">
      <div className="flex flex-col gap-4 pt-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Support performance and Sona value.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex h-9 items-center gap-2 rounded-lg border bg-background px-3 text-sm font-medium shadow-sm transition-colors hover:bg-muted"
              >
                <CalendarDays className="size-4 text-muted-foreground" />
                {getPeriodButtonLabel(period, range)}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 rounded-lg p-3">
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
                  {PERIOD_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => onPreset(option.value)}
                      className={`h-8 rounded-md text-xs font-medium transition-colors ${
                        !range.start && !range.end && period === option.value
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
                  <div className="grid gap-1">
                    <span className="text-xs font-medium text-muted-foreground">From</span>
                    <button
                      type="button"
                      onClick={() => openPicker(startRef.current)}
                      className="relative inline-flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-background px-2 text-left text-sm font-medium hover:bg-muted"
                    >
                      <span className={range.start ? "text-foreground" : "text-muted-foreground"}>
                        {formatDateLabel(range.start, "Start date")}
                      </span>
                      <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
                      <input
                        ref={startRef}
                        aria-label="Start date"
                        type="date"
                        value={range.start}
                        onChange={(event) => onRangeChange({ ...range, start: event.target.value })}
                        className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
                        tabIndex={-1}
                      />
                    </button>
                  </div>
                  <span className="pb-2 text-xs text-muted-foreground">to</span>
                  <div className="grid gap-1">
                    <span className="text-xs font-medium text-muted-foreground">To</span>
                    <button
                      type="button"
                      onClick={() => openPicker(endRef.current)}
                      className="relative inline-flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-background px-2 text-left text-sm font-medium hover:bg-muted"
                    >
                      <span className={range.end ? "text-foreground" : "text-muted-foreground"}>
                        {formatDateLabel(range.end, "End date")}
                      </span>
                      <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
                      <input
                        ref={endRef}
                        aria-label="End date"
                        type="date"
                        value={range.end}
                        min={range.start || undefined}
                        onChange={(event) => onRangeChange({ ...range, end: event.target.value })}
                        className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
                        tabIndex={-1}
                      />
                    </button>
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>
          <button
            type="button"
            disabled
            title="CSV export is prepared for a later release."
            className="inline-flex h-9 items-center gap-2 rounded-lg border bg-muted/40 px-3 text-sm font-medium text-muted-foreground"
          >
            <Download className="size-4" />
            Export CSV
          </button>
        </div>
      </div>
      <div className="flex">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "-mb-px border-b-2 border-[#6366f1] text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function MetricCard({ id, label, value, description, change, icon: Icon, loading, onClick, selected }) {
  const toneClass =
    change?.tone === "good"
      ? "text-teal-700"
      : change?.tone === "watch"
        ? "text-amber-700"
        : "text-muted-foreground";
  const ChangeIcon = change?.Icon;

  return (
    <button
      type="button"
      onClick={() => onClick?.(id, label)}
      className={`analytics-pressable group rounded-2xl border bg-background/95 p-5 text-left shadow-sm hover:border-foreground/20 hover:shadow-md ${
        selected ? "border-foreground/30 bg-background ring-1 ring-foreground/10" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Icon className="size-3.5 shrink-0 text-muted-foreground/50" />
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
        </div>
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-60" />
      </div>
      {loading ? (
        <Skeleton className="mt-5 h-9 w-28" />
      ) : (
        <p className="mt-5 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      )}
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      {change ? (
        <div className={`mt-4 inline-flex items-center gap-1 text-xs font-medium ${toneClass}`}>
          {ChangeIcon ? <ChangeIcon className="size-3" /> : null}
          {change.label}
        </div>
      ) : null}
    </button>
  );
}

function PeriodSummaryCards({ data, loading, drilldownKey, onDrilldown }) {
  const summary = data?.summary ?? {};
  const hasEnoughDraftQuality = (summary.trackedSentDrafts || 0) >= 3;
  const cards = [
    {
      id: "support_tickets",
      ...SUMMARY_META.support_tickets,
      value: formatNumber(summary.supportTickets),
      change: formatChange(summary.supportTicketsChangePct),
    },
    {
      id: "slow_first_replies",
      ...SUMMARY_META.first_reply,
      value: summary.firstReplyDataQuality === "limited" ? "Limited" : formatDuration(summary.medianFirstReplyMinutes),
      change: formatChange(summary.medianFirstReplyChangePct, { inverse: true }),
    },
    {
      id: "sona_assisted",
      ...SUMMARY_META.sona_assisted,
      value: formatNumber(summary.sonaAssistedTickets),
      description: `${formatPercent(summary.sonaAssistedRate)} of support tickets`,
      change: { label: `${formatNumber(summary.sonaAssistedReplies)} reply drafts created`, tone: "muted" },
    },
    {
      id: "highest_edit_pct",
      ...SUMMARY_META.no_minor_edits,
      value: hasEnoughDraftQuality && data?.sonaImpact?.averageEditPct != null ? formatPercent(data.sonaImpact.averageEditPct) : "Collecting data",
      description: hasEnoughDraftQuality
        ? `${formatNumber(summary.trackedSentDrafts)} sent drafts tracked`
        : "Needs more sent Sona drafts",
      change: hasEnoughDraftQuality ? { label: "Lower is better", tone: "muted" } : { label: "More sent drafts needed", tone: "muted" },
    },
  ];

  return (
    <section className="analytics-section space-y-4" style={sectionMotionStyle(0)}>
      <SectionHeading title="This period at a glance" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <MetricCard
            key={card.id}
            {...card}
            loading={loading}
            selected={drilldownKey === card.id}
            onClick={onDrilldown}
          />
        ))}
      </div>
    </section>
  );
}

function SectionHeading({ title, subtitle, action }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm leading-5 text-muted-foreground">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

function DraftQualityStack({ impact, onDrilldown, activeKey }) {
  const total = impact?.draftQualityTotal || ((impact?.trackedSentDrafts || 0) + (impact?.rejectedDrafts ?? impact?.rejected ?? 0));
  const rows = [
    { key: "sent_as_is", label: "Sent as-is", value: impact?.sentAsIs || 0, className: "bg-[#9B99FE]" },
    { key: "minor_edits", label: "Minor edits", value: impact?.minorEdits || 0, className: "bg-[#7C6DF2]" },
    { key: "major_edits", label: "Major edits", value: impact?.majorEdits || 0, className: "bg-amber-500" },
    { key: "rejected_drafts", label: "Rejected", value: impact?.rejected || 0, className: "bg-rose-500" },
  ];

  if (total < 3) {
    return (
      <EmptyAnalyticsState icon={Bot} title="Not enough sent draft data yet">
        Quality appears after more Sona drafts are sent.
      </EmptyAnalyticsState>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex h-3 overflow-hidden rounded-full bg-muted">
        {rows.map((row) => (
          <button
            key={`${row.label}-${row.value}`}
            type="button"
            onClick={() => onDrilldown(row.key, row.label)}
            className={`analytics-stack-segment ${row.className}`}
            style={{ width: `${Math.max(row.value ? 4 : 0, (row.value / total) * 100)}%` }}
            title={`${row.label}: ${row.value}`}
          />
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        {rows.map((row) => (
          <button
            key={row.label}
            type="button"
            onClick={() => onDrilldown(row.key, row.label)}
            className={`analytics-pressable rounded-xl border bg-muted/30 p-3 text-left hover:bg-muted/50 ${
              activeKey === row.key ? "ring-1 ring-foreground/15" : ""
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={`size-2.5 rounded-full ${row.className}`} />
              <span className="text-xs font-medium text-muted-foreground">{row.label}</span>
            </div>
            <p className="mt-2 text-xl font-semibold">{formatPercent((row.value / total) * 100)}</p>
            <p className="text-xs text-muted-foreground">{formatNumber(row.value)} drafts</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function SonaImpactSection({ data, loading, onDrilldown, drilldownKey }) {
  const impact = data?.sonaImpact ?? {};
  const hasEnoughDraftQuality = (impact.trackedSentDrafts || 0) >= 3;
  const draftQualityTotal = impact.draftQualityTotal || ((impact.trackedSentDrafts || 0) + (impact.rejectedDrafts ?? impact.rejected ?? 0));
  const readiness = impact.autopilotReadiness ?? {};
  const averageEditEffort = impact.averageEditEffort ?? {};
  const workflowApproval = impact.workflowApproval ?? {};
  const estimatedWork = impact.estimatedWorkAssisted ?? {};
  const averageEdit = hasEnoughDraftQuality && averageEditEffort.averageEditPct != null
    ? formatPercent(averageEditEffort.averageEditPct)
    : hasEnoughDraftQuality && impact.averageEditPct != null
    ? formatPercent(impact.averageEditPct)
    : "Collecting data";

  return (
    <section className="analytics-section space-y-5" style={sectionMotionStyle(3)}>
      <SectionHeading
        title="Sona AI Impact"
        subtitle="Draft quality, workflow automation, and where AI performs best."
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <SonaMetricButton
          label="Autopilot readiness"
          value={readiness.label || "Collecting data"}
          sub={readiness.description || "Needs more sent drafts"}
          active={drilldownKey === "no_minor_edits"}
          onClick={() => onDrilldown("no_minor_edits", "Autopilot readiness")}
        />
        <SonaMetricButton
          label="Average edit effort"
          value={averageEdit}
          sub={averageEditEffort.averageEditDistance != null ? `${formatNumber(averageEditEffort.averageEditDistance)} chars avg.` : "More sent drafts needed"}
          active={drilldownKey === "highest_edit_pct"}
          onClick={() => onDrilldown("highest_edit_pct", "Highest draft edits")}
        />
        <SonaMetricButton
          label="Workflow approval"
          value={formatPercent(workflowApproval.approvalRate ?? impact.actionApprovalRate)}
          sub={`${formatNumber(workflowApproval.actionsHandled ?? impact.actionsHandled ?? 0)} of ${formatNumber(workflowApproval.actionsSuggested ?? impact.actionsSuggested ?? 0)} handled`}
          active={drilldownKey?.startsWith?.("action:")}
          onClick={() => onDrilldown("action:all", "Sona workflows")}
        />
        <SonaMetricButton
          label="Estimated work assisted"
          value={estimatedWork.label || "Collecting data"}
          sub={estimatedWork.calculationNote ? "Drafts + handled workflows" : "Needs activity data"}
          active={false}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="rounded-2xl shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Bot className="size-4 text-[#7C6DF2]" />
                AI Draft Quality
              </CardTitle>
              <Badge variant="outline" className="rounded-md">
                {hasEnoughDraftQuality ? "Quality signal" : "Collecting data"}
              </Badge>
            </div>
            <CardDescription>{formatNumber(draftQualityTotal)} tracked draft outcomes</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {loading ? (
              <LoadingCard className="h-48" />
            ) : (
              <>
                <DraftQualityStack impact={impact} onDrilldown={onDrilldown} activeKey={drilldownKey} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => onDrilldown("highest_edit_pct", "Highest draft edits")}
                    className={`analytics-pressable rounded-xl border bg-muted/30 p-3 text-left hover:bg-muted/50 ${
                      drilldownKey === "highest_edit_pct" ? "ring-1 ring-foreground/15" : ""
                    }`}
                  >
                    <p className="text-xs font-medium text-muted-foreground">Average edit</p>
                    <p className="mt-1.5 text-2xl font-semibold tabular-nums">{averageEdit}</p>
                  </button>
                  <div className="rounded-xl border bg-muted/30 p-3">
                    <p className="text-xs font-medium text-muted-foreground">Avg. edit distance</p>
                    <p className="mt-1.5 text-2xl font-semibold tabular-nums">
                      {hasEnoughDraftQuality && impact.averageEditDistance != null ? `${formatNumber(impact.averageEditDistance)} chars` : "Collecting data"}
                    </p>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="size-4 text-[#7C6DF2]" />
              Workflow Automation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <LoadingCard className="h-48" />
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <ImpactStat label="Approval rate" value={formatPercent(impact.actionApprovalRate)} />
                  <ImpactStat label="Handled rate" value={formatPercent(impact.actionHandledRate ?? impact.actionApprovalRate)} />
                  <ImpactStat label="Suggested" value={impact.actionsSuggested} sub={`${formatNumber(impact.actionsHandled ?? 0)} handled`} />
                </div>
                {impact.topActionTypes?.length ? (
                  <div className="space-y-2">
                    {impact.topActionTypes.map((row) => (
                      <button
                        key={row.key}
                        type="button"
                        onClick={() => onDrilldown(row.key, row.label)}
                        className={`analytics-pressable grid w-full grid-cols-[1fr_auto] gap-3 rounded-xl border border-transparent bg-muted/20 p-3 text-left hover:bg-muted/40 ${
                          drilldownKey === row.key ? "border-foreground/20 ring-1 ring-foreground/10" : ""
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{row.label}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatNumber(row.suggested)} suggested · {formatNumber(row.handled)} handled
                          </p>
                        </div>
                        <Badge variant="outline" className="rounded-md tabular-nums">
                          {formatPercent(row.approvalRate)}
                        </Badge>
                      </button>
                    ))}
                  </div>
                ) : (
                  <EmptyAnalyticsState icon={Zap} title="No Sona actions yet">
                    Suggested workflows appear here.
                  </EmptyAnalyticsState>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="size-4 text-[#7C6DF2]" />
            AI Performance Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <LoadingCard className="h-52" />
          ) : (
            <SonaPerformanceInsights impact={impact} onDrilldown={onDrilldown} drilldownKey={drilldownKey} />
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="size-4 text-[#7C6DF2]" />
            Autopilot Candidates
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <LoadingCard className="h-52" />
          ) : (
            <AutopilotCandidates impact={impact} onDrilldown={onDrilldown} drilldownKey={drilldownKey} />
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function SonaMetricButton({ label, value, sub, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`analytics-pressable rounded-2xl border bg-background px-4 py-3 text-left shadow-sm hover:bg-muted/40 ${
        active ? "border-foreground/25 ring-1 ring-foreground/10" : ""
      } ${!onClick ? "cursor-default hover:bg-background" : ""}`}
    >
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
    </button>
  );
}

function SonaPerformanceInsights({ impact, onDrilldown, drilldownKey }) {
  const best = impact.bestPerformingCategories ?? [];
  const review = impact.needsReviewCategories ?? [];
  const assisted = impact.mostAssistedTopics ?? [];
  const workflows = [
    ...(impact.bestWorkflowTypes ?? []).map((row) => ({ ...row, group: "best" })),
    ...(impact.needsReviewWorkflowTypes ?? []).map((row) => ({ ...row, group: "review" })),
  ];

  if (!best.length && !review.length && !assisted.length && !workflows.length) {
    return (
      <EmptyAnalyticsState icon={Sparkles} title="More sent drafts are needed">
        Category-level AI performance appears after more Sona drafts are sent.
      </EmptyAnalyticsState>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-4">
      <SonaInsightList
        title="Where Sona performs best"
        rows={best}
        valueKey="noMinorEditRate"
        valueLabel="no/minor edit"
        onDrilldown={onDrilldown}
        drilldownKey={drilldownKey}
      />
      <SonaInsightList
        title="Where Sona needs review"
        rows={review}
        valueKey="needsReviewRate"
        valueLabel="review"
        onDrilldown={onDrilldown}
        drilldownKey={drilldownKey}
      />
      <SonaInsightList
        title="Most assisted topics"
        rows={assisted}
        valueKey="assistedTickets"
        valueLabel="tickets"
        onDrilldown={onDrilldown}
        drilldownKey={drilldownKey}
        countValue
      />
      <SonaWorkflowList
        title="Workflow approval"
        rows={workflows}
        onDrilldown={onDrilldown}
        drilldownKey={drilldownKey}
      />
    </div>
  );
}

function AutopilotCandidates({ impact, onDrilldown, drilldownKey }) {
  const candidates = impact.autopilotCandidates ?? {};
  const groups = [
    { key: "readyToTest", title: "Ready to test", rows: candidates.readyToTest ?? [] },
    { key: "needsMoreData", title: "Needs more data", rows: candidates.needsMoreData ?? [] },
    { key: "keepHumanReview", title: "Keep human review", rows: candidates.keepHumanReview ?? [] },
  ];

  if (!groups.some((group) => group.rows.length)) {
    return (
      <EmptyAnalyticsState icon={Gauge} title="More data needed for autopilot candidates">
        Sona needs more sent drafts and approved workflows to recommend candidates.
      </EmptyAnalyticsState>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {groups.map((group) => (
        <div key={group.key} className="space-y-2">
          <p className="text-sm font-medium">{group.title}</p>
          {group.rows.length ? (
            group.rows.map((row) => (
              <button
                key={`${group.key}-${row.key}`}
                type="button"
                onClick={() => onDrilldown(row.key, row.label)}
                className={`analytics-pressable w-full rounded-xl border border-transparent bg-muted/30 p-3 text-left hover:bg-muted/50 ${
                  drilldownKey === row.key ? "border-foreground/20 ring-1 ring-foreground/10" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-medium">{row.label}</p>
                  <Badge variant="outline" className="shrink-0 rounded-md capitalize">
                    {row.type}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{row.reason}</p>
              </button>
            ))
          ) : (
            <EmptyAnalyticsState title="No candidates yet">Collecting data.</EmptyAnalyticsState>
          )}
        </div>
      ))}
    </div>
  );
}

function SonaInsightList({ title, rows, valueKey, valueLabel, onDrilldown, drilldownKey, countValue = false }) {
  if (!rows?.length) {
    return <EmptyAnalyticsState title={title}>Collecting data.</EmptyAnalyticsState>;
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{title}</p>
      {rows.slice(0, 5).map((row) => (
        <button
          key={`${title}-${row.key}`}
          type="button"
          onClick={() => onDrilldown(row.key, row.category)}
          className={`analytics-pressable flex w-full items-center justify-between gap-3 rounded-xl border border-transparent bg-muted/30 p-2.5 text-left hover:bg-muted/50 ${
            drilldownKey === row.key ? "border-foreground/20 ring-1 ring-foreground/10" : ""
          }`}
        >
          <span className="min-w-0 truncate text-sm">{row.category}</span>
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            {countValue ? formatNumber(row[valueKey]) : formatPercent(row[valueKey])} {valueLabel}
          </span>
        </button>
      ))}
    </div>
  );
}

function SonaWorkflowList({ title, rows, onDrilldown, drilldownKey }) {
  if (!rows?.length) {
    return <EmptyAnalyticsState title={title}>Collecting data.</EmptyAnalyticsState>;
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{title}</p>
      {rows.slice(0, 5).map((row) => (
        <button
          key={`${title}-${row.group}-${row.key}`}
          type="button"
          onClick={() => onDrilldown(row.key, row.label)}
          className={`analytics-pressable flex w-full items-center justify-between gap-3 rounded-xl border border-transparent bg-muted/30 p-2.5 text-left hover:bg-muted/50 ${
            drilldownKey === row.key ? "border-foreground/20 ring-1 ring-foreground/10" : ""
          }`}
        >
          <span className="min-w-0 truncate text-sm">{row.label}</span>
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            {formatPercent(row.approvalRate)} approval
          </span>
        </button>
      ))}
    </div>
  );
}

function ImpactStat({ label, value, sub, onClick, active = false }) {
  const content = (
    <>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{typeof value === "number" ? formatNumber(value) : value}</p>
      {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`analytics-pressable rounded-xl border bg-muted/30 p-3 text-left hover:bg-muted/50 ${
          active ? "ring-1 ring-foreground/15" : ""
        }`}
      >
        {content}
      </button>
    );
  }
  return (
    <div className="rounded-xl border bg-muted/30 p-3">
      {content}
    </div>
  );
}

function SupportVolumeSection({ data, loading, onDrilldown, drilldownKey }) {
  const volume = data?.volume ?? {};
  const change = formatChange(volume.changePct);

  return (
    <section className="analytics-section space-y-4" style={sectionMotionStyle(1)}>
      <SectionHeading title="Support Volume" subtitle="Ticket influx over the selected period." />
      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="text-base">Tickets over time</CardTitle>
              {volume.note ? <CardDescription>Filtered to support requests.</CardDescription> : null}
            </div>
            <button
              type="button"
              onClick={() => onDrilldown("support_tickets", "Support tickets")}
              className={`analytics-pressable rounded-xl border bg-muted/30 px-3 py-2 text-left hover:bg-muted/50 sm:min-w-48 ${
                drilldownKey === "support_tickets" ? "border-foreground/25 ring-1 ring-foreground/10" : ""
              }`}
            >
              <p className="text-xs font-medium text-muted-foreground">Support requests</p>
              <p className="mt-1.5 text-2xl font-semibold">{formatNumber(volume.total)}</p>
              <p className={`mt-1 text-xs ${change.tone === "muted" ? "text-muted-foreground" : change.tone === "good" ? "text-teal-700" : "text-amber-700"}`}>
                {change.label}
              </p>
            </button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <LoadingCard className="h-52" />
          ) : (
            <TicketVolumeChart data={volume.series ?? []} periodDays={volume.grouping ?? "day"} />
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function HorizontalBarList({ items = [], emptyTitle, emptyDescription, onSelect, activeKey }) {
  if (!items.length) {
    return (
      <EmptyAnalyticsState title={emptyTitle}>
        {emptyDescription}
      </EmptyAnalyticsState>
    );
  }

  const max = Math.max(...items.map((item) => item.count || 0), 1);
  return (
    <div className="space-y-1">
      {items.map((item) => (
        <button
          key={item.key}
          title={item.fullLabel || item.label}
          type="button"
          onClick={() => onSelect?.(item.key, item.label)}
          className={`analytics-pressable grid w-full grid-cols-[minmax(0,1fr)_56px] items-center gap-3 rounded-xl border border-transparent px-2.5 py-2 text-left hover:bg-muted/40 ${
            activeKey === item.key ? "border-foreground/20 bg-muted/45 ring-1 ring-foreground/10" : ""
          }`}
        >
          <div className="min-w-0">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="truncate text-sm">{item.label}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatPercent(item.pct)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="analytics-bar h-full rounded-full bg-foreground/60"
                style={{
                  width: `${Math.max(4, ((item.count || 0) / max) * 100)}%`,
                  backgroundColor: item.color || undefined,
                }}
              />
            </div>
          </div>
          <span className="text-right text-sm font-semibold tabular-nums">{formatNumber(item.count)}</span>
        </button>
      ))}
    </div>
  );
}

function TopicsProblemAreasSection({ data, loading, onDrilldown, drilldownKey }) {
  const topics = data?.topics ?? {};

  return (
    <section className="analytics-section space-y-4" style={sectionMotionStyle(2)}>
      <SectionHeading title="Topics & Problem Areas" subtitle="What customers contact you about." />
      <div className="grid gap-5 xl:grid-cols-3">
        <TopicCard
          icon={ListFilter}
          title="Top request types"
          loading={loading}
          items={topics.requestTypes}
          emptyTitle="No tagged tickets in this period"
          emptyDescription="Request types appear after tickets are tagged."
          onDrilldown={onDrilldown}
          drilldownKey={drilldownKey}
        />
        <TopicCard
          icon={PackageSearch}
          title="Top products"
          loading={loading}
          items={topics.products}
          emptyTitle="No product data yet"
          emptyDescription="Product analytics need linked ticket metadata."
          onDrilldown={onDrilldown}
          drilldownKey={drilldownKey}
        />
        <TopicCard
          icon={FileBarChart}
          title="Top issue descriptions"
          loading={loading}
          items={topics.issueDescriptions}
          emptyTitle="No issue summaries yet"
          emptyDescription="Issue groups appear after more summaries are available."
          onDrilldown={onDrilldown}
          drilldownKey={drilldownKey}
        />
      </div>
    </section>
  );
}

function TopicCard({ icon: Icon, title, description, loading, items, emptyTitle, emptyDescription, onDrilldown, drilldownKey }) {
  return (
    <Card className="rounded-2xl shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="size-4 text-muted-foreground" />
          {title}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        {loading ? (
          <LoadingCard className="h-64" />
        ) : (
          <HorizontalBarList
            items={items ?? []}
            emptyTitle={emptyTitle}
            emptyDescription={emptyDescription}
            onSelect={onDrilldown}
            activeKey={drilldownKey}
          />
        )}
      </CardContent>
    </Card>
  );
}

function StrengthsWeakSpotsSection({ data, loading, onDrilldown, drilldownKey }) {
  const section = data?.strengthsWeakSpots ?? {};

  return (
    <section className="analytics-section space-y-4" style={sectionMotionStyle(4)}>
      <SectionHeading
        title="Strengths & Weak Spots"
        subtitle="Response patterns across topics."
      />
      <div className="grid gap-5 xl:grid-cols-3">
        <TopicPerformanceCard
          icon={CheckCircle2}
          title="Quick response areas"
          rows={section.fastestTopics}
          loading={loading}
          emptyTitle="No response-time data yet"
          onDrilldown={onDrilldown}
          drilldownKey={drilldownKey}
        />
        <TopicPerformanceCard
          icon={Gauge}
          title="Longer response areas"
          rows={section.slowestTopics}
          loading={loading}
          emptyTitle="No slow topics found"
          onDrilldown={onDrilldown}
          drilldownKey={drilldownKey}
        />
        <TopicPerformanceCard
          icon={TrendingUp}
          title="High-volume issues needing improvement"
          rows={section.highVolumeSlowResponse}
          loading={loading}
          emptyTitle="No high-volume slow spots yet"
          onDrilldown={onDrilldown}
          drilldownKey={drilldownKey}
          emphasis
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Uses median first reply. {section.resolutionTimeNote}
      </p>
    </section>
  );
}

function TopicPerformanceCard({ icon: Icon, title, rows = [], loading, emptyTitle, onDrilldown, drilldownKey, emphasis = false }) {
  return (
    <Card className="rounded-2xl shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className={`size-4 ${emphasis ? "text-amber-600" : "text-muted-foreground"}`} />
          {title}
        </CardTitle>
        {emphasis ? (
          <CardDescription>High volume and slower response.</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent>
        {loading ? (
          <LoadingCard className="h-48" />
        ) : rows.length ? (
          <div className="space-y-1.5">
            {rows.map((row) => (
              <button
                key={`${title}-${row.key}`}
                type="button"
                onClick={() => onDrilldown(row.key, row.topic)}
                className={`analytics-pressable w-full rounded-xl border border-transparent p-3 text-left hover:bg-muted/40 ${
                  drilldownKey === row.key ? "border-foreground/15 bg-muted/40 ring-1 ring-foreground/10" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-medium">{row.topic}</p>
                  <Badge variant="outline" className="shrink-0 rounded-md tabular-nums" title="Tickets in selected period">
                    {formatNumber(row.count)}
                  </Badge>
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-3 text-xs">
                  <span className="text-muted-foreground">Median first reply</span>
                  <span className={`font-semibold tabular-nums ${emphasis ? "text-amber-700" : "text-foreground"}`}>{formatDuration(row.medianFirstReplyMinutes)}</span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <EmptyAnalyticsState icon={Gauge} title={emptyTitle}>
            Needs tagged tickets with response times.
          </EmptyAnalyticsState>
        )}
      </CardContent>
    </Card>
  );
}

function PreviousSystemComparisonSection({ data }) {
  const comparison = data?.previousSystemComparison;

  return (
    <section className="analytics-section" style={sectionMotionStyle(5)}>
      <details className="group rounded-2xl border bg-background/75 shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 marker:hidden">
          <div className="min-w-0">
            <p className="text-sm font-semibold">Compare with previous helpdesk</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Import Zendesk or historical support data to measure Sona impact over time.
            </p>
          </div>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        </summary>
        <div className="border-t p-4 pt-5">
          {comparison ? (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Metric</TableHead>
                    <TableHead>{comparison.sourceName || "Previous system"}</TableHead>
                    <TableHead>Sona</TableHead>
                    <TableHead>Change</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(comparison.metrics ?? []).map((metric) => (
                    <TableRow key={metric.key}>
                      <TableCell className="font-medium">{metric.label}</TableCell>
                      <TableCell>{metric.previous}</TableCell>
                      <TableCell>{metric.sona}</TableCell>
                      <TableCell>{metric.change}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <EmptyAnalyticsState
              icon={Database}
              title="No historical data imported yet"
              action={
                <button
                  type="button"
                  disabled
                  className="inline-flex h-9 items-center rounded-lg border bg-muted/35 px-3 text-sm font-medium text-muted-foreground"
                >
                  CSV import coming soon
                </button>
              }
            >
              Import previous support data to compare volume, response times, issue trends and workload before and after Sona.
            </EmptyAnalyticsState>
          )}
        </div>
      </details>
    </section>
  );
}

function AnalyticsDrilldownTable({ data, drilldown }) {
  const [showAll, setShowAll] = useState(false);
  const tickets = data?.drilldowns?.byKey?.[drilldown.key] ?? data?.drilldowns?.defaultTickets ?? [];
  const title = drilldown.title || "All support tickets";
  const visibleTickets = showAll ? tickets : tickets.slice(0, 10);

  useEffect(() => {
    setShowAll(false);
  }, [drilldown.key]);

  return (
    <section className="analytics-section space-y-3" style={sectionMotionStyle(5)}>
      <SectionHeading
        title={drilldown.key === "all" ? "Tickets behind the numbers" : `Showing tickets for: ${title}`}
        subtitle={`${formatNumber(tickets.length)} matching tickets. Showing ${formatNumber(visibleTickets.length)}.`}
      />
      <Card className="rounded-2xl shadow-sm">
        <CardContent className="p-0">
          {!tickets.length ? (
            <div className="p-5">
              <EmptyAnalyticsState icon={Table2} title="No tickets match this view">
                Try another period or choose a different analytics metric.
              </EmptyAnalyticsState>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table key={drilldown.key} className="analytics-table-swap">
                <TableHeader>
                  <TableRow className="border-b bg-background hover:bg-background">
                    <TableHead className="min-w-28">Ticket</TableHead>
                    <TableHead className="min-w-64">Subject</TableHead>
                    <TableHead className="min-w-44">Customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="min-w-40">Request type</TableHead>
                    <TableHead className="min-w-36">Product</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead>First reply</TableHead>
                    <TableHead>Sona usage</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleTickets.map((ticket) => (
                    <TableRow key={ticket.id} className="h-11 transition-colors hover:bg-muted/25">
                      <TableCell className="whitespace-nowrap">
                        <a href={ticket.url} className="font-mono text-sm font-semibold text-indigo-700 underline-offset-2 transition-colors hover:text-indigo-900 hover:underline">
                          #{ticket.ticketNumber || String(ticket.id).slice(0, 8)}
                        </a>
                      </TableCell>
                      <TableCell className="max-w-80 truncate text-sm">{ticket.subject}</TableCell>
                      <TableCell className="max-w-56 truncate text-sm text-muted-foreground">{ticket.customer}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="rounded-md capitalize">{ticket.status}</Badge>
                      </TableCell>
                      <TableCell className="max-w-44 truncate text-sm">{ticket.requestType}</TableCell>
                      <TableCell className="max-w-40 truncate text-sm text-muted-foreground">{ticket.product || "-"}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{formatDate(ticket.createdAt)}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{formatDate(ticket.updatedAt)}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{formatDuration(ticket.firstReplyMinutes)}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{ticket.sonaUsage}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {tickets.length > 10 ? (
                <div className="flex items-center justify-between border-t bg-muted/10 px-4 py-3">
                  <p className="text-xs text-muted-foreground">
                    {showAll ? `Showing all ${formatNumber(tickets.length)} tickets.` : `Showing first 10 of ${formatNumber(tickets.length)} tickets.`}
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowAll((value) => !value)}
                    className="analytics-pressable rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
                  >
                    {showAll ? "Show first 10" : "View all"}
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function CoverageFooter({ data }) {
  const coverage = data?.coverage;
  if (!coverage) return null;
  const rows = [
    ["Topics identified", coverage.taggedRate],
    ["Draft quality measured", coverage.draftTrackingRate],
    ["Reply time available", coverage.responseTimeRate],
    ["Products identified", coverage.productDetectionRate],
    ["Issue summaries available", coverage.issueMetadataRate],
  ];

  return (
    <details className="rounded-lg border bg-background/60 p-3 text-muted-foreground">
      <summary className="cursor-pointer text-xs font-medium">
        Data quality details
      </summary>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded-md border bg-muted/10 p-2.5">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className="mt-1 text-lg font-semibold text-foreground">{formatPercent(value)}</p>
          </div>
        ))}
      </div>
    </details>
  );
}

function AnalyticsMotionStyles() {
  return (
    <style jsx global>{`
      @keyframes analytics-enter {
        from {
          opacity: 0;
          transform: translateY(8px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @keyframes analytics-swap {
        from {
          opacity: 0.72;
          transform: translateY(3px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .analytics-section {
        animation: analytics-enter 280ms cubic-bezier(0.23, 1, 0.32, 1) both;
      }

      .analytics-pressable {
        transition:
          transform 150ms cubic-bezier(0.23, 1, 0.32, 1),
          box-shadow 200ms cubic-bezier(0.23, 1, 0.32, 1),
          border-color 150ms ease-out,
          background-color 150ms ease-out;
      }

      .analytics-pressable:active {
        transform: scale(0.98);
      }

      .analytics-bar,
      .analytics-stack-segment {
        transition: width 380ms cubic-bezier(0.23, 1, 0.32, 1);
      }

      .analytics-table-swap {
        animation: analytics-swap 200ms cubic-bezier(0.23, 1, 0.32, 1) both;
      }

      @media (prefers-reduced-motion: reduce) {
        .analytics-section,
        .analytics-table-swap {
          animation: none;
        }

        .analytics-pressable,
        .analytics-bar,
        .analytics-stack-segment {
          transition: none;
        }

        .analytics-pressable:active {
          transform: none;
        }
      }
    `}</style>
  );
}

function SonaStatCard({ value, label, sub, accent = false, loading }) {
  return (
    <div className="rounded-xl border bg-background p-5 text-center">
      {loading ? (
        <Skeleton className="mx-auto mt-1 h-9 w-20" />
      ) : (
        <p className={`text-3xl font-extrabold tracking-tight tabular-nums ${accent ? "text-[#6366f1]" : ""}`}>
          {value}
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">{label}</p>
      {sub ? (
        <p className={`mt-1 text-xs font-medium ${accent ? "text-[#6366f1]" : "text-muted-foreground"}`}>
          {sub}
        </p>
      ) : null}
    </div>
  );
}

function SupportStatCard({ label, value, change, sub, loading }) {
  const toneClass =
    change?.tone === "good"
      ? "text-green-600"
      : change?.tone === "watch"
        ? "text-amber-600"
        : "text-muted-foreground";
  return (
    <div className="rounded-xl border bg-background p-5">
      <p className="text-xs text-muted-foreground">{label}</p>
      {loading ? (
        <Skeleton className="mt-3 h-8 w-24" />
      ) : (
        <p className="mt-2 text-2xl font-bold tracking-tight tabular-nums">{value}</p>
      )}
      {change ? (
        <p className={`mt-2 text-xs font-medium ${toneClass}`}>{change.label}</p>
      ) : sub ? (
        <p className="mt-2 text-xs text-muted-foreground">{sub}</p>
      ) : null}
    </div>
  );
}

function OverviewTab({ data, loading, onDrilldown, drilldownKey }) {
  const summary = data?.summary ?? {};
  const impact = data?.sonaImpact ?? {};
  const volume = data?.volume ?? {};
  const draftQualityTotal =
    impact.draftQualityTotal ||
    ((impact.trackedSentDrafts || 0) + (impact.rejected ?? impact.rejectedDrafts ?? 0));
  const hasEnoughDraftQuality = (impact.trackedSentDrafts || 0) >= 3;

  return (
    <div className="analytics-section flex flex-col gap-6">
      <div>
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground/50">
          Sona AI
        </p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SonaStatCard
            loading={loading}
            value={hasEnoughDraftQuality ? formatNumber(impact.sentAsIs || 0) : "Collecting data"}
            label="Drafts sent as-is"
            sub={
              hasEnoughDraftQuality && draftQualityTotal > 0
                ? `${formatPercent(((impact.sentAsIs || 0) / draftQualityTotal) * 100)} of sent drafts`
                : undefined
            }
            accent={hasEnoughDraftQuality}
          />
          <SonaStatCard
            loading={loading}
            value={
              hasEnoughDraftQuality && impact.averageEditPct != null
                ? formatPercent(impact.averageEditPct)
                : "Collecting data"
            }
            label="Avg. edit effort"
            sub={hasEnoughDraftQuality ? "Lower is better" : undefined}
            accent={hasEnoughDraftQuality}
          />
          <SonaStatCard
            loading={loading}
            value={formatNumber(impact.actionsHandled ?? 0)}
            label="Workflows handled"
            sub={`of ${formatNumber(impact.actionsSuggested ?? 0)} suggested`}
          />
          <SonaStatCard
            loading={loading}
            value={formatPercent(impact.actionApprovalRate)}
            label="Automation rate"
            sub="of suggested actions"
            accent
          />
        </div>
      </div>

      <div>
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground/50">
          Support
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <SupportStatCard
            loading={loading}
            label="Support requests"
            value={formatNumber(summary.supportTickets)}
            change={formatChange(summary.supportTicketsChangePct)}
          />
          <SupportStatCard
            loading={loading}
            label="Median first reply"
            value={
              summary.firstReplyDataQuality === "limited"
                ? "Limited"
                : formatDuration(summary.medianFirstReplyMinutes)
            }
            change={formatChange(summary.medianFirstReplyChangePct, { inverse: true })}
          />
          <SupportStatCard
            loading={loading}
            label="Sona-assisted tickets"
            value={formatNumber(summary.sonaAssistedTickets)}
            sub={`${formatNumber(summary.sonaAssistedReplies)} reply drafts created`}
          />
        </div>
      </div>

      <div className="rounded-xl border bg-background p-5">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <p className="text-sm font-semibold">Tickets over time</p>
          <p className="text-xs text-muted-foreground">by {volume.grouping || "day"}</p>
        </div>
        {loading ? (
          <Skeleton className="h-52" />
        ) : (
          <TicketVolumeChart data={volume.series ?? []} periodDays={volume.grouping ?? "day"} />
        )}
      </div>
    </div>
  );
}

function SonaImpactTab({ data, loading, onDrilldown, drilldownKey }) {
  const impact = data?.sonaImpact ?? {};
  const hasEnoughDraftQuality = (impact.trackedSentDrafts || 0) >= 3;
  const draftQualityTotal =
    impact.draftQualityTotal ||
    ((impact.trackedSentDrafts || 0) + (impact.rejectedDrafts ?? impact.rejected ?? 0));
  const readiness = impact.autopilotReadiness ?? {};
  const averageEditEffort = impact.averageEditEffort ?? {};
  const workflowApproval = impact.workflowApproval ?? {};
  const estimatedWork = impact.estimatedWorkAssisted ?? {};
  const averageEdit =
    hasEnoughDraftQuality && averageEditEffort.averageEditPct != null
      ? formatPercent(averageEditEffort.averageEditPct)
      : hasEnoughDraftQuality && impact.averageEditPct != null
      ? formatPercent(impact.averageEditPct)
      : "Collecting data";

  return (
    <div className="analytics-section flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <SonaMetricButton
          label="Autopilot readiness"
          value={readiness.label || "Collecting data"}
          sub={readiness.description || "Needs more sent drafts"}
          active={drilldownKey === "no_minor_edits"}
          onClick={() => onDrilldown("no_minor_edits", "Autopilot readiness")}
        />
        <SonaMetricButton
          label="Average edit effort"
          value={averageEdit}
          sub={
            averageEditEffort.averageEditDistance != null
              ? `${formatNumber(averageEditEffort.averageEditDistance)} chars avg.`
              : "More sent drafts needed"
          }
          active={drilldownKey === "highest_edit_pct"}
          onClick={() => onDrilldown("highest_edit_pct", "Highest draft edits")}
        />
        <SonaMetricButton
          label="Workflow approval"
          value={formatPercent(workflowApproval.approvalRate ?? impact.actionApprovalRate)}
          sub={`${formatNumber(workflowApproval.actionsHandled ?? impact.actionsHandled ?? 0)} of ${formatNumber(workflowApproval.actionsSuggested ?? impact.actionsSuggested ?? 0)} handled`}
          active={drilldownKey?.startsWith?.("action:")}
          onClick={() => onDrilldown("action:all", "Sona workflows")}
        />
        <SonaMetricButton
          label="Estimated work assisted"
          value={estimatedWork.label || "Collecting data"}
          sub={estimatedWork.calculationNote ? "Drafts + handled workflows" : "Needs activity data"}
          active={false}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="rounded-2xl shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Bot className="size-4 text-[#7C6DF2]" />
                AI Draft Quality
              </CardTitle>
              <Badge variant="outline" className="rounded-md">
                {hasEnoughDraftQuality ? "Quality signal" : "Collecting data"}
              </Badge>
            </div>
            <CardDescription>{formatNumber(draftQualityTotal)} tracked draft outcomes</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {loading ? (
              <LoadingCard className="h-48" />
            ) : (
              <>
                <DraftQualityStack impact={impact} onDrilldown={onDrilldown} activeKey={drilldownKey} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => onDrilldown("highest_edit_pct", "Highest draft edits")}
                    className={`analytics-pressable rounded-xl border bg-muted/30 p-3 text-left hover:bg-muted/50 ${
                      drilldownKey === "highest_edit_pct" ? "ring-1 ring-foreground/15" : ""
                    }`}
                  >
                    <p className="text-xs font-medium text-muted-foreground">Average edit</p>
                    <p className="mt-1.5 text-2xl font-semibold tabular-nums">{averageEdit}</p>
                  </button>
                  <div className="rounded-xl border bg-muted/30 p-3">
                    <p className="text-xs font-medium text-muted-foreground">Avg. edit distance</p>
                    <p className="mt-1.5 text-2xl font-semibold tabular-nums">
                      {hasEnoughDraftQuality && impact.averageEditDistance != null
                        ? `${formatNumber(impact.averageEditDistance)} chars`
                        : "Collecting data"}
                    </p>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="size-4 text-[#7C6DF2]" />
              Workflow Automation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <LoadingCard className="h-48" />
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <ImpactStat label="Approval rate" value={formatPercent(impact.actionApprovalRate)} />
                  <ImpactStat
                    label="Handled rate"
                    value={formatPercent(impact.actionHandledRate ?? impact.actionApprovalRate)}
                  />
                  <ImpactStat
                    label="Suggested"
                    value={impact.actionsSuggested}
                    sub={`${formatNumber(impact.actionsHandled ?? 0)} handled`}
                  />
                </div>
                {impact.topActionTypes?.length ? (
                  <div className="space-y-2">
                    {impact.topActionTypes.map((row) => (
                      <button
                        key={row.key}
                        type="button"
                        onClick={() => onDrilldown(row.key, row.label)}
                        className={`analytics-pressable grid w-full grid-cols-[1fr_auto] gap-3 rounded-xl border border-transparent bg-muted/20 p-3 text-left hover:bg-muted/40 ${
                          drilldownKey === row.key ? "border-foreground/20 ring-1 ring-foreground/10" : ""
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{row.label}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatNumber(row.suggested)} suggested · {formatNumber(row.handled)} handled
                          </p>
                        </div>
                        <Badge variant="outline" className="rounded-md tabular-nums">
                          {formatPercent(row.approvalRate)}
                        </Badge>
                      </button>
                    ))}
                  </div>
                ) : (
                  <EmptyAnalyticsState icon={Zap} title="No Sona actions yet">
                    Suggested workflows appear here.
                  </EmptyAnalyticsState>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="size-4 text-[#7C6DF2]" />
            AI Performance Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <LoadingCard className="h-52" />
          ) : (
            <SonaPerformanceInsights
              impact={impact}
              onDrilldown={onDrilldown}
              drilldownKey={drilldownKey}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AnalyticsPage() {
  const [period, setPeriod] = useState("30");
  const [dateRange, setDateRange] = useState({ start: "", end: "" });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [drilldown, setDrilldown] = useState({ key: "all", title: "All support tickets" });
  const [activeTab, setActiveTab] = useState("overview");

  const fetchData = useCallback((p, range) => {
    if (range.start && range.end && range.end < range.start) {
      setError("End date must be on or after start date.");
      setLoading(false);
      return;
    }

    const params = new URLSearchParams();
    if (range.start && range.end) {
      params.set("start", range.start);
      params.set("end", range.end);
    } else {
      params.set("period", p);
    }

    setLoading(true);
    setError(null);
    fetch(`/api/analytics/overview?${params.toString()}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        setData(json);
        setDrilldown({ key: json?.drilldowns?.defaultKey || "all", title: "All support tickets" });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchData(period, dateRange);
  }, [fetchData, period, dateRange]);

  const handlePreset = (value) => {
    setPeriod(value);
    setDateRange({ start: "", end: "" });
  };

  const handleDrilldown = (key, title) => {
    if (!key) return;
    setDrilldown({ key, title: title || key });
    setActiveTab("tickets");
    requestAnimationFrame(() => {
      document.getElementById("analytics-drilldown")?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  };

  const hasData = useMemo(() => Boolean(data && !error), [data, error]);

  return (
    <div className="@container/main flex flex-1 flex-col">
      <AnalyticsMotionStyles />
      <AnalyticsHeader
        period={period}
        range={dateRange}
        onPreset={handlePreset}
        onRangeChange={setDateRange}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <main className="flex flex-1 flex-col gap-6 p-4 md:p-6">
        {error ? (
          <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            <AlertTriangle className="size-4 shrink-0" />
            {error}
          </div>
        ) : null}

        {activeTab === "overview" && (
          <OverviewTab data={data} loading={loading} onDrilldown={handleDrilldown} drilldownKey={drilldown.key} />
        )}
        {activeTab === "sona-impact" && (hasData || loading) && (
          <SonaImpactTab data={data} loading={loading} onDrilldown={handleDrilldown} drilldownKey={drilldown.key} />
        )}
        {activeTab === "topics" && (hasData || loading) && (
          <TopicsTab data={data} loading={loading} onDrilldown={handleDrilldown} drilldownKey={drilldown.key} />
        )}
        {activeTab === "tickets" && (
          <TicketsTab data={data} drilldown={drilldown} />
        )}
      </main>
    </div>
  );
}
