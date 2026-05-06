"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart2Icon,
  Bot,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Gauge,
  InboxIcon,
  ListFilter,
  MousePointerClick,
  Sparkles,
  Ticket,
  Zap,
} from "lucide-react";

import { TicketVolumeChart } from "@/components/analytics/TicketVolumeChart";
import { TicketTypesChart } from "@/components/analytics/TicketTypesChart";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const PERIOD_OPTIONS = [
  { value: "7", label: "7d" },
  { value: "30", label: "30d" },
  { value: "all", label: "All" },
];

const ACTION_LABELS = {
  cancel_order: "Cancel order",
  refund_order: "Refund",
  create_exchange_request: "Exchange",
  lookup_order_status: "Order lookup",
  add_note: "Internal note",
  update_shipping_address: "Address change",
  send_return_instructions: "Return instructions",
  fetch_tracking: "Tracking info",
  forward_email: "Forward email",
  hold_fulfillment: "Hold fulfillment",
  create_return: "Create return",
  initiate_return: "Return initiated",
  create_refund: "Refund",
  change_shipping_address: "Address change",
  send_message: "Message sent",
};

function formatNumber(value) {
  if (value == null) return "Not tracked";
  return new Intl.NumberFormat("en-US").format(value);
}

function formatPercent(value) {
  if (value == null) return "Not tracked";
  return `${value}%`;
}

function formatDuration(minutes) {
  if (minutes == null) return "Not tracked";
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hrs`;
  const days = hours / 24;
  return `${Number.isInteger(days) ? days : days.toFixed(1)} days`;
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
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

function delta(current, previous, inverse = false) {
  if (current == null || previous == null || previous === 0) return null;
  const value = Math.round(((current - previous) / previous) * 100);
  if (value === 0) return null;
  const positive = inverse ? value < 0 : value > 0;
  return { value, positive };
}

function DeltaPill({ current, previous, inverse = false }) {
  const item = delta(current, previous, inverse);
  if (!item) return null;
  const Icon = item.value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={
        item.positive
          ? "inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"
          : "inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700"
      }
    >
      <Icon className="size-3" />
      {Math.abs(item.value)}%
    </span>
  );
}

function LoadingBlock({ className = "h-24" }) {
  return <Skeleton className={className} />;
}

function MetricCard({
  title,
  value,
  detail,
  icon: Icon,
  tone = "slate",
  loading,
  current,
  previous,
  inverseDelta = false,
  periodLabel,
}) {
  const toneClass = {
    blue: "bg-blue-50 text-blue-700 ring-blue-100",
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    amber: "bg-amber-50 text-amber-700 ring-amber-100",
    rose: "bg-rose-50 text-rose-700 ring-rose-100",
    violet: "bg-violet-50 text-violet-700 ring-violet-100",
    slate: "bg-slate-50 text-slate-700 ring-slate-100",
  }[tone];

  return (
    <Card className="overflow-hidden rounded-lg transition-shadow hover:shadow-sm">
      <CardHeader className="space-y-0 pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardDescription className="text-[11px] font-semibold uppercase tracking-wide">
            {title}
          </CardDescription>
          {Icon ? (
            <span className={`inline-flex size-8 items-center justify-center rounded-md ring-1 ${toneClass}`}>
              <Icon className="size-4" />
            </span>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <LoadingBlock className="h-8" />
        ) : (
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-semibold tabular-nums tracking-normal">{value}</p>
            <DeltaPill current={current} previous={previous} inverse={inverseDelta} />
          </div>
        )}
        <p className="min-h-4 text-xs text-muted-foreground">{loading ? "" : detail}</p>
      </CardContent>
      {periodLabel ? <PeriodFootnote label={periodLabel} /> : null}
    </Card>
  );
}

function PeriodFootnote({ label }) {
  return (
    <div className="border-t bg-muted/25 px-5 py-3 text-xs text-muted-foreground">
      {label}
    </div>
  );
}

function EmptyState({ icon: Icon = ListFilter, children }) {
  return (
    <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground">
      <Icon className="size-7 opacity-30" />
      {children}
    </div>
  );
}

function BucketBars({ rows = [], valueFormatter = formatPercent }) {
  if (!rows.length) return <EmptyState>No data in this period.</EmptyState>;
  const max = Math.max(...rows.map((row) => row.count || 0), 1);
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[88px_1fr_60px] items-center gap-3 text-sm">
          <span className="truncate text-muted-foreground">{row.label}</span>
          <div className="h-7 overflow-hidden rounded-md bg-muted">
            <div
              className="flex h-full min-w-8 items-center justify-end rounded-md bg-teal-600 px-2 text-[11px] font-semibold text-white transition-[width] duration-200"
              style={{ width: `${Math.max(6, ((row.count || 0) / max) * 100)}%` }}
            >
              {row.count ? valueFormatter(row.pct) : ""}
            </div>
          </div>
          <span className="text-right tabular-nums">{row.count || 0}</span>
        </div>
      ))}
    </div>
  );
}

function ActionFunnel({ actions, loading }) {
  const rows = [
    { label: "Suggested", value: actions?.total ?? 0, tone: "bg-slate-500" },
    { label: "Pending", value: actions?.pending ?? 0, tone: "bg-amber-500" },
    { label: "Applied", value: actions?.applied ?? 0, tone: "bg-emerald-600" },
    { label: "Failed / declined", value: actions?.declined ?? 0, tone: "bg-rose-500" },
  ];
  const max = Math.max(...rows.map((row) => row.value), 1);

  if (loading) return <LoadingBlock className="h-40" />;
  if (!actions?.total) return <EmptyState icon={Zap}>No AI actions in this period.</EmptyState>;

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[112px_1fr_56px] items-center gap-3 text-sm">
          <span className="text-muted-foreground">{row.label}</span>
          <div className="h-8 overflow-hidden rounded-md bg-muted">
            <div
              className={`h-full rounded-md ${row.tone} transition-[width] duration-200`}
              style={{ width: `${Math.max(4, (row.value / max) * 100)}%` }}
            />
          </div>
          <span className="text-right font-medium tabular-nums">{row.value}</span>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        {actions.completion_pct}% of suggested actions were applied.
      </p>
    </div>
  );
}

function QualityBars({ quality, loading }) {
  if (loading) return <LoadingBlock className="h-32" />;
  if (!quality?.total) {
    return <EmptyState icon={Bot}>No sent drafts with edit tracking in this period.</EmptyState>;
  }

  const rows = [
    { label: "Accepted as-is", value: quality.no_edit, pct: quality.no_edit_pct, tone: "bg-emerald-600" },
    { label: "Minor edits", value: quality.minor_edit, pct: quality.minor_edit_pct, tone: "bg-amber-500" },
    { label: "Major edits", value: quality.major_edit, pct: quality.major_edit_pct, tone: "bg-rose-500" },
  ];

  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <div key={row.label} className="space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">{row.label}</span>
            <span className="tabular-nums text-muted-foreground">
              {row.value} · {row.pct}%
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-muted">
            <div className={`h-full rounded-full ${row.tone}`} style={{ width: `${row.pct}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function TicketDrillTable({ rows = [], metricLabel }) {
  if (!rows.length) return <EmptyState icon={Ticket}>No ticket drilldown for this metric yet.</EmptyState>;
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            <TableHead>Ticket</TableHead>
            <TableHead>Subject</TableHead>
            <TableHead className="text-right">{metricLabel}</TableHead>
            <TableHead className="text-right">Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} className="hover:bg-muted/30">
              <TableCell className="whitespace-nowrap font-medium">
                {row.url ? (
                  <a href={row.url} className="text-primary hover:underline">
                    #{row.ticket_number || row.id.slice(0, 8)}
                  </a>
                ) : (
                  <>#{row.ticket_number || row.id.slice(0, 8)}</>
                )}
              </TableCell>
              <TableCell className="max-w-[360px] truncate text-muted-foreground">
                {row.subject || row.customer_email || "No subject"}
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatDuration(row.value_minutes)}</TableCell>
              <TableCell className="text-right text-muted-foreground">{formatDate(row.created_at)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function DataCoverage({ coverage, loading }) {
  if (loading) return <LoadingBlock className="h-28" />;
  const rows = [
    { label: "AI touched", value: coverage?.ai_touched_pct ?? 0, detail: coverage?.ai_touched_tickets ?? 0 },
    { label: "Tagged", value: coverage?.tagged_pct ?? 0, detail: coverage?.tagged_tickets ?? 0 },
    { label: "Drafted", value: coverage?.drafted_pct ?? 0, detail: coverage?.drafted_tickets ?? 0 },
    { label: "Reply time tracked", value: coverage?.reply_time_tracked_pct ?? 0, detail: coverage?.reply_time_tracked_tickets ?? 0 },
    { label: "Edit tracking", value: coverage?.edit_tracking_pct ?? 0, detail: coverage?.edit_tracking_tickets ?? 0 },
  ];
  return (
    <div className="grid gap-3 @2xl/main:grid-cols-5">
      {rows.map((row) => (
        <div key={row.label} className="rounded-lg border bg-background p-3">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{row.label}</span>
            <span className="tabular-nums">{row.detail}</span>
          </div>
          <p className="mt-2 text-xl font-semibold tabular-nums">{row.value}%</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-slate-700" style={{ width: `${row.value}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function UnsupportedMetric({ label }) {
  return (
    <div className="rounded-lg border border-dashed p-4">
      <p className="text-sm font-medium">{label}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Not tracked yet. Requires reliable ticket history from the source system.
      </p>
    </div>
  );
}

function periodLabel(period, range) {
  if (range.start && range.end) {
    return `From ${formatDateLabel(range.start, "Start date")} - ${formatDateLabel(range.end, "End date")}`;
  }
  if (period === "7") return "Last 7 days";
  if (period === "30") return "Last 30 days";
  return "All time";
}

function DateRangeControl({ period, range, onPreset, onRangeChange }) {
  const startRef = useRef(null);
  const endRef = useRef(null);

  const openPicker = (input) => {
    if (typeof input?.showPicker === "function") input.showPicker();
    else input?.focus();
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-9 items-center gap-2 rounded-lg border bg-background px-3 text-sm font-medium shadow-sm transition-colors hover:bg-muted active:scale-[0.99]"
        >
          <CalendarDays className="size-4 text-muted-foreground" />
          Date
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
                  !(range.start && range.end) && period === option.value
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
              <span className="text-xs font-medium text-muted-foreground">Start</span>
              <button
                type="button"
                onClick={() => openPicker(startRef.current)}
                className="relative inline-flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-background px-2 text-left text-sm font-medium transition-colors hover:bg-muted active:scale-[0.99]"
              >
                <span className={range.start ? "text-foreground" : "text-muted-foreground"}>
                  {formatDateLabel(range.start, "Start date")}
                </span>
                <CalendarDays className="size-4 text-muted-foreground" />
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
              <span className="text-xs font-medium text-muted-foreground">End</span>
              <button
                type="button"
                onClick={() => openPicker(endRef.current)}
                className="relative inline-flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-background px-2 text-left text-sm font-medium transition-colors hover:bg-muted active:scale-[0.99]"
              >
                <span className={range.end ? "text-foreground" : "text-muted-foreground"}>
                  {formatDateLabel(range.end, "End date")}
                </span>
                <CalendarDays className="size-4 text-muted-foreground" />
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
          <p className="text-xs text-muted-foreground">{periodLabel(period, range)}</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function AnalyticsPage() {
  const [period, setPeriod] = useState("30");
  const [dateRange, setDateRange] = useState({ start: "", end: "" });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchData(period, dateRange);
  }, [fetchData, period, dateRange]);

  const support = data?.support ?? {};
  const quality = data?.draft_quality ?? {};
  const actions = data?.actions ?? {};
  const previous = data?.previous ?? {};
  const aiScore = useMemo(() => {
    const draftQuality = data?.draft_quality;
    if (!draftQuality?.total) return null;
    return Math.max(
      0,
      Math.round((draftQuality.no_edit_pct || 0) - (draftQuality.major_edit_pct || 0) * 0.5),
    );
  }, [data]);
  const activePeriodLabel = periodLabel(period, dateRange);

  return (
    <div className="@container/main flex flex-1 flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-col gap-3 @xl/main:flex-row @xl/main:items-center @xl/main:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <BarChart2Icon className="size-4" />
          </span>
          <div>
            <h1 className="text-xl font-semibold leading-tight">Analytics</h1>
            <p className="text-sm text-muted-foreground">Support efficiency and Sona AI performance</p>
          </div>
        </div>
        <DateRangeControl
          period={period}
          range={dateRange}
          onPreset={(value) => {
            setPeriod(value);
            setDateRange({ start: "", end: "" });
          }}
          onRangeChange={setDateRange}
        />
      </div>

      {error ? (
        <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
        <MetricCard
          title="Created tickets"
          value={formatNumber(support.created_tickets)}
          detail={`${formatNumber(support.unsolved_tickets)} currently unresolved`}
          icon={InboxIcon}
          tone="blue"
          loading={loading}
          current={support.created_tickets}
          previous={previous.tickets_total}
          periodLabel={activePeriodLabel}
        />
        <MetricCard
          title="First reply median"
          value={formatDuration(support.first_reply_time_median_min)}
          detail={`${formatPercent(support.reply_coverage_pct)} of tickets have reply timing`}
          icon={Clock3}
          tone="amber"
          loading={loading}
          current={support.first_reply_time_median_min}
          previous={previous.first_reply_time_median_min}
          inverseDelta
          periodLabel={activePeriodLabel}
        />
        <MetricCard
          title="AI accepted as-is"
          value={formatPercent(quality.no_edit_pct)}
          detail={`${formatNumber(quality.no_edit)} of ${formatNumber(quality.total)} tracked sent drafts`}
          icon={Sparkles}
          tone="emerald"
          loading={loading}
          current={quality.no_edit_pct}
          previous={previous.ai_accepted_pct}
          periodLabel={activePeriodLabel}
        />
        <MetricCard
          title="Automation applied"
          value={formatPercent(actions.completion_pct)}
          detail={`${formatNumber(actions.applied)} applied · ${formatNumber(actions.pending)} pending`}
          icon={Zap}
          tone="violet"
          loading={loading}
          current={actions.completion_pct}
          previous={previous.actions_completion_pct}
          periodLabel={activePeriodLabel}
        />
      </div>

      <div className="grid gap-4 @5xl/main:grid-cols-[1.5fr_1fr]">
        <Card className="rounded-lg">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">Ticket volume</CardTitle>
              <CardDescription>Created tickets over the selected period</CardDescription>
            </div>
            {!loading ? (
              <Badge variant="outline" className="rounded-md">
                {formatNumber(data?.tickets_total ?? 0)} total
              </Badge>
            ) : null}
          </CardHeader>
          <CardContent>
            {loading ? <LoadingBlock className="h-[220px]" /> : <TicketVolumeChart data={data?.volume_by_day ?? []} periodDays={period} />}
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="text-base">Executive read</CardTitle>
            <CardDescription>What matters operationally right now</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <LoadingBlock className="h-36" />
            ) : (
              <>
                <div className="rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Solved tickets</span>
                    <span className="font-semibold tabular-nums">{formatNumber(support.solved_tickets)}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">One-touch tickets</span>
                    <span className="font-semibold tabular-nums">{formatPercent(support.one_touch_pct)}</span>
                  </div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">AI score</span>
                    <span className="font-semibold tabular-nums">{aiScore == null ? "Not tracked" : `${aiScore}/100`}</span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Based on accepted-as-is rate minus major-edit pressure.
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Major edit rate</span>
                    <span className="font-semibold tabular-nums">{formatPercent(quality.major_edit_pct)}</span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Categories below show where Sona needs better context or policies.
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 @5xl/main:grid-cols-2">
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Gauge className="size-4" />
              Reply speed
            </CardTitle>
            <CardDescription>Tickets by first public reply time</CardDescription>
          </CardHeader>
          <CardContent>{loading ? <LoadingBlock className="h-48" /> : <BucketBars rows={support.first_reply_brackets ?? []} />}</CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="size-4" />
              Resolution time
            </CardTitle>
            <CardDescription>Where solved tickets land by full resolution time</CardDescription>
          </CardHeader>
          <CardContent>{loading ? <LoadingBlock className="h-48" /> : <BucketBars rows={support.resolution_brackets ?? []} />}</CardContent>
        </Card>
      </div>

      <div className="grid gap-4 @5xl/main:grid-cols-[1.1fr_0.9fr]">
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="text-base">Ticket categories</CardTitle>
            <CardDescription>Issue, product, and request distribution from ticket tags</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <LoadingBlock className="h-[320px]" /> : <TicketTypesChart data={data?.ticket_types ?? []} />}
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="text-base">Agent reply load</CardTitle>
            <CardDescription>Tickets by number of agent replies</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <LoadingBlock className="h-48" /> : <BucketBars rows={support.agent_reply_brackets ?? []} />}
            <div className="mt-4 rounded-lg border p-3">
              <p className="text-sm text-muted-foreground">Average agent replies</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {support.agent_replies_average == null ? "Not tracked" : support.agent_replies_average}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 @5xl/main:grid-cols-2">
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bot className="size-4" />
              AI draft quality
            </CardTitle>
            <CardDescription>How much agents edit Sona before sending</CardDescription>
          </CardHeader>
          <CardContent>
            <QualityBars quality={quality} loading={loading} />
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MousePointerClick className="size-4" />
              Automation funnel
            </CardTitle>
            <CardDescription>Suggested actions through applied or declined outcomes</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionFunnel actions={actions} loading={loading} />
            {!loading && actions?.by_type?.length ? (
              <div className="mt-5 overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead>Action</TableHead>
                      <TableHead className="text-right">Suggested</TableHead>
                      <TableHead className="text-right">Applied</TableHead>
                      <TableHead className="text-right">Pending</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {actions.by_type.slice(0, 6).map((row) => (
                      <TableRow key={row.type} className="hover:bg-muted/30">
                        <TableCell className="font-medium">{ACTION_LABELS[row.type] ?? row.type}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.total}</TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-700">{row.applied}</TableCell>
                        <TableCell className="text-right tabular-nums text-amber-700">{row.pending}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="text-base">AI problem categories</CardTitle>
          <CardDescription>Tags ranked by major-edit pressure and average edit percentage</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <LoadingBlock className="h-48" />
          ) : !quality?.by_tag?.length ? (
            <EmptyState icon={Bot}>No tagged draft quality data in this period.</EmptyState>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Tracked drafts</TableHead>
                    <TableHead className="text-right">Accepted as-is</TableHead>
                    <TableHead className="text-right">Major edit rate</TableHead>
                    <TableHead className="text-right">Avg. edited</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quality.by_tag.slice(0, 10).map((row) => (
                    <TableRow key={row.tag} className="hover:bg-muted/30">
                      <TableCell className="font-medium">
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <span
                            className="size-2.5 shrink-0 rounded-sm"
                            style={{ backgroundColor: row.color || "#64748b" }}
                          />
                          <span className="truncate">{row.tag}</span>
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.total}</TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-700">{row.no_edit_pct}%</TableCell>
                      <TableCell className="text-right tabular-nums text-rose-700">{row.major_edit_pct}%</TableCell>
                      <TableCell className="text-right tabular-nums">{row.avg_edited_pct ?? 0}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 @5xl/main:grid-cols-2">
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="text-base">Tickets driving first reply median</CardTitle>
            <CardDescription>Slowest first replies in the selected period</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <LoadingBlock className="h-48" />
            ) : (
              <TicketDrillTable rows={support.slow_first_reply_tickets ?? []} metricLabel="First reply" />
            )}
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="text-base">Tickets driving resolution time</CardTitle>
            <CardDescription>Slowest solved tickets by full resolution duration</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <LoadingBlock className="h-48" />
            ) : (
              <TicketDrillTable rows={support.slow_resolution_tickets ?? []} metricLabel="Resolution" />
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="text-base">Data coverage</CardTitle>
          <CardDescription>How much of the period can support reliable analytics</CardDescription>
        </CardHeader>
        <CardContent>
          <DataCoverage coverage={data?.coverage} loading={loading} />
          <div className="mt-4 grid gap-3 @2xl/main:grid-cols-3">
            <UnsupportedMetric label="Reopened tickets" />
            <UnsupportedMetric label="First resolution median" />
            <UnsupportedMetric label="Group / assignee stations average" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
