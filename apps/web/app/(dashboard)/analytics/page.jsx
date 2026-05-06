"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BarChart2Icon,
  Bot,
  CalendarDays,
  CheckCircle2,
  Gauge,
  ListFilter,
  MousePointerClick,
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

function LoadingBlock({ className = "h-24" }) {
  return <Skeleton className={className} />;
}

function EmptyState({ icon: Icon = ListFilter, children }) {
  return (
    <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground">
      <Icon className="size-7 opacity-30" />
      {children}
    </div>
  );
}

function MiniStat({ label, value, detail, tone = "indigo" }) {
  const toneClass = {
    indigo: "border-indigo-100 bg-indigo-50/70 text-indigo-700",
    teal: "border-teal-100 bg-teal-50/70 text-teal-700",
    amber: "border-amber-100 bg-amber-50/70 text-amber-700",
    rose: "border-rose-100 bg-rose-50/70 text-rose-700",
    slate: "border-slate-200 bg-slate-50 text-slate-700",
  }[tone];

  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide opacity-75">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-normal">{value}</p>
      {detail ? <p className="mt-1 text-xs opacity-75">{detail}</p> : null}
    </div>
  );
}

function ViewTabs({ active, onChange }) {
  const items = [
    ["overview", "Overview"],
    ["workload", "Workload"],
    ["topics", "Topics"],
    ["sona", "Sona"],
    ["diagnostics", "Diagnostics"],
  ];
  return (
    <div className="flex flex-wrap gap-1 rounded-lg border bg-background p-1">
      {items.map(([value, label]) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            active === value
              ? "bg-indigo-50 text-indigo-700 shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          {label}
        </button>
      ))}
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
              className="flex h-full min-w-8 items-center justify-end rounded-md bg-indigo-600 px-2 text-[11px] font-semibold text-white transition-[width] duration-200"
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
    { label: "Suggested", value: actions?.total ?? 0, tone: "bg-indigo-500" },
    { label: "Pending", value: actions?.pending ?? 0, tone: "bg-amber-400" },
    { label: "Applied", value: actions?.applied ?? 0, tone: "bg-teal-500" },
    { label: "Failed / declined", value: actions?.declined ?? 0, tone: "bg-rose-400" },
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
    { label: "Accepted as-is", value: quality.no_edit, pct: quality.no_edit_pct, tone: "bg-teal-500" },
    { label: "Minor edits", value: quality.minor_edit, pct: quality.minor_edit_pct, tone: "bg-indigo-500" },
    { label: "Major edits", value: quality.major_edit, pct: quality.major_edit_pct, tone: "bg-rose-400" },
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
  const [activeView, setActiveView] = useState("overview");
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
  const activePeriodLabel = periodLabel(period, dateRange);

  return (
    <div className="@container/main flex flex-1 flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-col gap-3 @xl/main:flex-row @xl/main:items-start @xl/main:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100">
            <BarChart2Icon className="size-4" />
          </span>
          <div>
            <h1 className="text-xl font-semibold leading-tight">Analytics</h1>
            <p className="text-sm text-muted-foreground">
              One overview for support load, customer topics, and Sona performance.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{activePeriodLabel}</p>
          </div>
        </div>
        <div className="flex flex-col items-start gap-2 @xl/main:items-end">
          <DateRangeControl
            period={period}
            range={dateRange}
            onPreset={(value) => {
              setPeriod(value);
              setDateRange({ start: "", end: "" });
            }}
            onRangeChange={setDateRange}
          />
          <ViewTabs active={activeView} onChange={setActiveView} />
        </div>
      </div>

      {error ? (
        <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
        </div>
      ) : null}

      {activeView === "overview" ? (
      <div className="grid gap-4 @5xl/main:grid-cols-12" id="overview">
        <Card className="rounded-lg @5xl/main:col-span-7">
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Support snapshot</CardTitle>
            <CardDescription>
              The fastest read on workload: volume, open tickets, and customer wait time.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 @2xl/main:grid-cols-3">
              <MiniStat
                label="Tickets created"
                value={loading ? "—" : formatNumber(support.created_tickets)}
                detail="New support tickets"
                tone="indigo"
              />
              <MiniStat
                label="Unresolved"
                value={loading ? "—" : formatNumber(support.unsolved_tickets)}
                detail={`${formatNumber(support.solved_tickets)} solved`}
                tone="rose"
              />
              <MiniStat
                label="First reply"
                value={loading ? "—" : formatDuration(support.first_reply_time_median_min)}
                detail="Median wait time"
                tone="amber"
              />
            </div>
            <div className="rounded-lg border p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">Ticket volume</p>
                  <p className="text-xs text-muted-foreground">Notification noise is excluded.</p>
                </div>
                {!loading ? (
                  <Badge variant="outline" className="rounded-md">
                    {formatNumber(data?.tickets_total ?? 0)} total
                  </Badge>
                ) : null}
              </div>
              {loading ? (
                <LoadingBlock className="h-[220px]" />
              ) : (
                <TicketVolumeChart data={data?.volume_by_day ?? []} periodDays={period} />
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-lg @5xl/main:col-span-5">
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Sona performance</CardTitle>
            <CardDescription>
              Whether Sona is reducing work or creating review effort.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 @xl/main:grid-cols-2">
              <MiniStat
                label="Accepted as-is"
                value={loading ? "—" : formatPercent(quality.no_edit_pct)}
                detail={`${formatNumber(quality.no_edit)} sent directly`}
                tone="teal"
              />
              <MiniStat
                label="Actions applied"
                value={loading ? "—" : formatNumber(actions.applied)}
                detail={`${formatNumber(actions.pending)} pending`}
                tone="indigo"
              />
            </div>
            <div className="rounded-lg border p-4">
              <p className="mb-3 text-sm font-semibold">Draft quality</p>
              <QualityBars quality={quality} loading={loading} />
            </div>
            <div className="rounded-lg border p-4">
              <p className="mb-3 text-sm font-semibold">Automation funnel</p>
              <ActionFunnel actions={actions} loading={loading} />
            </div>
          </CardContent>
        </Card>
      </div>
      ) : null}

      {activeView === "workload" ? (
      <div className="space-y-4" id="workload">
        <Card className="rounded-lg">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">Ticket volume</CardTitle>
              <CardDescription>Support tickets created over the selected period. Notification noise is excluded.</CardDescription>
            </div>
            {!loading ? (
              <Badge variant="outline" className="rounded-md">
                {formatNumber(data?.tickets_total ?? 0)} total
              </Badge>
            ) : null}
          </CardHeader>
          <CardContent>
            {loading ? (
              <LoadingBlock className="h-[260px]" />
            ) : (
              <TicketVolumeChart data={data?.volume_by_day ?? []} periodDays={period} />
            )}
          </CardContent>
        </Card>
        <div className="grid gap-4 @5xl/main:grid-cols-2">
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Gauge className="size-4 text-indigo-600" />
              First reply speed
            </CardTitle>
            <CardDescription>How quickly customers receive the first response.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <LoadingBlock className="h-48" /> : <BucketBars rows={support.first_reply_brackets ?? []} />}
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="size-4 text-teal-600" />
              Resolution time
            </CardTitle>
            <CardDescription>How long solved tickets took from creation to completion.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <LoadingBlock className="h-48" /> : <BucketBars rows={support.resolution_brackets ?? []} />}
          </CardContent>
        </Card>
        </div>
      </div>
      ) : null}

      {activeView === "topics" ? (
      <div id="topics" className="grid gap-4 @5xl/main:grid-cols-[1.1fr_0.9fr]">
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="text-base">Customer topics</CardTitle>
            <CardDescription>
              The issue types, products, and request types creating the most support load.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <LoadingBlock className="h-[320px]" /> : <TicketTypesChart data={data?.ticket_types ?? []} />}
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="text-base">Replies needed per ticket</CardTitle>
            <CardDescription>Whether tickets are handled in one touch or need back-and-forth.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <LoadingBlock className="h-48" /> : <BucketBars rows={support.agent_reply_brackets ?? []} />}
            <MiniStat
              label="Average replies"
              value={support.agent_replies_average == null ? "Not tracked" : support.agent_replies_average}
              detail="Agent replies per ticket"
              tone="slate"
            />
          </CardContent>
        </Card>
      </div>
      ) : null}

      {activeView === "sona" ? (
      <div id="sona" className="grid gap-4 @5xl/main:grid-cols-2">
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bot className="size-4 text-violet-600" />
              Draft quality
            </CardTitle>
            <CardDescription>How much agents edit Sona drafts before sending them.</CardDescription>
          </CardHeader>
          <CardContent>
            <QualityBars quality={quality} loading={loading} />
          </CardContent>
        </Card>
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MousePointerClick className="size-4 text-indigo-600" />
              Actions completed by Sona
            </CardTitle>
            <CardDescription>Suggested operational actions from recommendation to completion.</CardDescription>
          </CardHeader>
          <CardContent>
            {!loading && actions?.by_type?.length ? (
              <div className="overflow-hidden rounded-lg border">
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
                        <TableCell className="text-right tabular-nums text-teal-700">{row.applied}</TableCell>
                        <TableCell className="text-right tabular-nums text-amber-700">{row.pending}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : loading ? (
              <LoadingBlock className="h-48" />
            ) : (
              <EmptyState icon={Zap}>No AI actions in this period.</EmptyState>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-lg @5xl/main:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bot className="size-4 text-violet-600" />
              Where Sona needs improvement
            </CardTitle>
            <CardDescription>Categories with the highest edit pressure.</CardDescription>
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
                      <TableHead className="text-right">Drafts</TableHead>
                      <TableHead className="text-right">Major edits</TableHead>
                      <TableHead className="text-right">Avg. edited</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {quality.by_tag.slice(0, 8).map((row) => (
                      <TableRow key={row.tag} className="hover:bg-muted/30">
                        <TableCell className="font-medium">
                          <span className="inline-flex min-w-0 items-center gap-2">
                            <span className="size-2.5 shrink-0 rounded-sm bg-indigo-500" />
                            <span className="truncate">{row.tag}</span>
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{row.total}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.major_edit_pct}%</TableCell>
                        <TableCell className="text-right tabular-nums">{row.avg_edited_pct ?? 0}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      ) : null}

      {activeView === "diagnostics" ? (
      <div id="diagnostics" className="space-y-4">
          <div className="grid gap-4 @5xl/main:grid-cols-2">
            <Card className="rounded-lg">
              <CardHeader>
                <CardTitle className="text-base">Tickets slowing first reply time</CardTitle>
                <CardDescription>The slowest first replies in the selected period.</CardDescription>
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
                <CardTitle className="text-base">Tickets slowing resolution time</CardTitle>
                <CardDescription>The slowest solved tickets by full resolution duration.</CardDescription>
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
              <CardTitle className="text-base">Tracking coverage</CardTitle>
              <CardDescription>Shows how much of the selected period has enough data to support reliable analytics.</CardDescription>
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
      ) : null}
    </div>
  );
}
