"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
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
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "all", label: "All time" },
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
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US").format(value);
}

function formatPercent(value) {
  if (value == null) return "—";
  return `${value}%`;
}

function formatDuration(minutes) {
  if (minutes == null) return "—";
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

function periodLabel(period, range) {
  if (range.start && range.end) {
    return `${formatDateLabel(range.start, "Start")} – ${formatDateLabel(range.end, "End")}`;
  }
  if (period === "7") return "Last 7 days";
  if (period === "30") return "Last 30 days";
  return "All time";
}

function LoadingBlock({ className = "h-24" }) {
  return <Skeleton className={className} />;
}

function EmptyState({ icon: Icon = ListFilter, title, children }) {
  return (
    <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center">
      <Icon className="size-6 text-muted-foreground/40" />
      {title && <p className="text-sm font-medium">{title}</p>}
      {children && <p className="text-xs text-muted-foreground">{children}</p>}
    </div>
  );
}

function StatCard({ label, value, sub, accent = "indigo", loading = false }) {
  const accentBorder = {
    indigo: "border-t-indigo-500",
    teal: "border-t-teal-500",
    amber: "border-t-amber-400",
    rose: "border-t-rose-500",
    slate: "border-t-slate-300",
  }[accent];

  return (
    <div className={`rounded-xl border border-t-2 bg-background p-4 ${accentBorder}`}>
      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      {loading ? (
        <Skeleton className="mt-2 h-9 w-24" />
      ) : (
        <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight">{value}</p>
      )}
      {sub && <p className="mt-1.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function ViewTabs({ active, onChange }) {
  const items = [
    { value: "overview", label: "Overview" },
    { value: "workload", label: "Workload" },
    { value: "topics", label: "Topics" },
    { value: "sona", label: "Sona AI" },
    { value: "diagnostics", label: "Diagnostics" },
  ];

  return (
    <nav className="-mb-px flex overflow-x-auto">
      {items.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          className={`shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            active === value
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
          }`}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}

function BucketBars({ rows = [], valueFormatter = formatPercent }) {
  if (!rows.length) {
    return (
      <EmptyState title="No data yet">
        No tickets in this period match this breakdown.
      </EmptyState>
    );
  }
  const max = Math.max(...rows.map((row) => row.count || 0), 1);
  return (
    <div className="space-y-2.5">
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[120px_1fr_56px] items-center gap-3 text-sm">
          <span className="truncate text-muted-foreground">{row.label}</span>
          <div className="h-6 overflow-hidden rounded bg-muted">
            <div
              className="flex h-full min-w-6 items-center justify-end rounded bg-indigo-600 px-2 text-[10px] font-semibold text-white transition-[width] duration-500"
              style={{ width: `${Math.max(6, ((row.count || 0) / max) * 100)}%` }}
            >
              {row.count ? valueFormatter(row.pct) : ""}
            </div>
          </div>
          <span className="text-right tabular-nums text-muted-foreground">{row.count || 0}</span>
        </div>
      ))}
    </div>
  );
}

function ActionFunnel({ actions, loading }) {
  const rows = [
    { label: "Suggested", value: actions?.total ?? 0, color: "bg-slate-400" },
    { label: "Pending review", value: actions?.pending ?? 0, color: "bg-amber-400" },
    { label: "Applied", value: actions?.applied ?? 0, color: "bg-teal-500" },
    { label: "Declined", value: actions?.declined ?? 0, color: "bg-rose-400" },
  ];
  const max = Math.max(...rows.map((row) => row.value), 1);

  if (loading) return <LoadingBlock className="h-40" />;
  if (!actions?.total) {
    return (
      <EmptyState icon={Zap} title="No actions yet">
        Sona hasn't suggested any actions in this period.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-2.5">
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[120px_1fr_56px] items-center gap-3 text-sm">
          <span className="text-muted-foreground">{row.label}</span>
          <div className="h-6 overflow-hidden rounded bg-muted">
            <div
              className={`h-full rounded ${row.color} transition-[width] duration-500`}
              style={{ width: `${Math.max(4, (row.value / max) * 100)}%` }}
            />
          </div>
          <span className="text-right font-semibold tabular-nums">{row.value}</span>
        </div>
      ))}
      <p className="pt-1 text-xs text-muted-foreground">
        <span className="font-semibold text-teal-700">{actions.completion_pct}%</span> of suggested actions were applied by agents.
      </p>
    </div>
  );
}

function QualityBars({ quality, loading }) {
  if (loading) return <LoadingBlock className="h-32" />;
  if (!quality?.total) {
    return (
      <EmptyState icon={Bot} title="No draft quality data">
        Edit tracking begins when agents send Sona-generated drafts.
      </EmptyState>
    );
  }

  const rows = [
    {
      label: "Sent without edits",
      hint: "Draft was good enough to send as-is",
      value: quality.no_edit,
      pct: quality.no_edit_pct,
      barClass: "bg-teal-500",
      textClass: "text-teal-700",
    },
    {
      label: "Minor edits",
      hint: "Small tweaks before sending",
      value: quality.minor_edit,
      pct: quality.minor_edit_pct,
      barClass: "bg-indigo-400",
      textClass: "text-indigo-700",
    },
    {
      label: "Major edits",
      hint: "Significant rewrite required",
      value: quality.major_edit,
      pct: quality.major_edit_pct,
      barClass: "bg-rose-400",
      textClass: "text-rose-700",
    },
  ];

  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <div key={row.label} className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <div className="min-w-0">
              <span className="text-sm font-medium">{row.label}</span>
              <span className="ml-2 text-xs text-muted-foreground">{row.hint}</span>
            </div>
            <span className={`shrink-0 text-sm font-bold tabular-nums ${row.textClass}`}>
              {row.pct}%
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full transition-[width] duration-500 ${row.barClass}`}
              style={{ width: `${row.pct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">{row.value} drafts</p>
        </div>
      ))}
    </div>
  );
}

function TicketDrillTable({ rows = [], metricLabel }) {
  if (!rows.length) {
    return (
      <EmptyState icon={Ticket} title="No outliers found">
        No tickets stand out for this metric in the current period.
      </EmptyState>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            <TableHead className="w-24">Ticket</TableHead>
            <TableHead>Subject</TableHead>
            <TableHead className="text-right">{metricLabel}</TableHead>
            <TableHead className="w-24 text-right">Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} className="hover:bg-muted/30">
              <TableCell className="whitespace-nowrap font-mono text-xs font-medium">
                {row.url ? (
                  <a href={row.url} className="text-indigo-600 hover:underline">
                    #{row.ticket_number || row.id.slice(0, 8)}
                  </a>
                ) : (
                  <span className="text-muted-foreground">#{row.ticket_number || row.id.slice(0, 8)}</span>
                )}
              </TableCell>
              <TableCell className="max-w-[360px] truncate text-sm text-muted-foreground">
                {row.subject || row.customer_email || "No subject"}
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {formatDuration(row.value_minutes)}
              </TableCell>
              <TableCell className="text-right text-xs text-muted-foreground">
                {formatDate(row.created_at)}
              </TableCell>
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
    { label: "AI touched", value: coverage?.ai_touched_pct ?? 0, detail: `${coverage?.ai_touched_tickets ?? 0} tickets` },
    { label: "Tagged", value: coverage?.tagged_pct ?? 0, detail: `${coverage?.tagged_tickets ?? 0} tickets` },
    { label: "Drafted", value: coverage?.drafted_pct ?? 0, detail: `${coverage?.drafted_tickets ?? 0} tickets` },
    { label: "Reply time", value: coverage?.reply_time_tracked_pct ?? 0, detail: `${coverage?.reply_time_tracked_tickets ?? 0} tickets` },
    { label: "Edit tracking", value: coverage?.edit_tracking_pct ?? 0, detail: `${coverage?.edit_tracking_tickets ?? 0} tickets` },
  ];
  return (
    <div className="grid gap-3 @2xl/main:grid-cols-5">
      {rows.map((row) => (
        <div key={row.label} className="rounded-lg border bg-background p-3">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            {row.label}
          </p>
          <p className="mt-2 text-2xl font-bold tabular-nums">{row.value}%</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full transition-[width] duration-500 ${
                row.value >= 80 ? "bg-teal-500" : row.value >= 50 ? "bg-amber-400" : "bg-rose-400"
              }`}
              style={{ width: `${row.value}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">{row.detail}</p>
        </div>
      ))}
    </div>
  );
}

function UnsupportedMetric({ label }) {
  return (
    <div className="rounded-lg border border-dashed p-4">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Not yet tracked — requires reliable ticket history from the source system.
      </p>
    </div>
  );
}

function DateRangeControl({ period, range, onPreset, onRangeChange }) {
  const startRef = useRef(null);
  const endRef = useRef(null);

  const openPicker = (input) => {
    if (typeof input?.showPicker === "function") input.showPicker();
    else input?.focus();
  };

  const activeOption = PERIOD_OPTIONS.find((o) => o.value === period);
  const buttonLabel =
    range.start && range.end
      ? `${formatDateLabel(range.start, "Start")} – ${formatDateLabel(range.end, "End")}`
      : (activeOption?.label ?? "Period");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-9 items-center gap-2 rounded-lg border bg-background px-3 text-sm font-medium shadow-sm transition-colors hover:bg-muted active:scale-[0.98]"
        >
          <CalendarDays className="size-4 text-muted-foreground" />
          {buttonLabel}
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
              <span className="text-xs font-medium text-muted-foreground">From</span>
              <button
                type="button"
                onClick={() => openPicker(startRef.current)}
                className="relative inline-flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-background px-2 text-left text-sm font-medium transition-colors hover:bg-muted active:scale-[0.99]"
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
                className="relative inline-flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-background px-2 text-left text-sm font-medium transition-colors hover:bg-muted active:scale-[0.99]"
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

  return (
    <div className="@container/main flex flex-1 flex-col">
      {/* Sticky header with tab navigation */}
      <div className="border-b bg-background px-4 pt-5 pb-0 md:px-6">
        <div className="flex items-center justify-between gap-4 pb-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Analytics</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Support performance · {periodLabel(period, dateRange)}
            </p>
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
        <ViewTabs active={activeView} onChange={setActiveView} />
      </div>

      <div className="flex flex-1 flex-col gap-5 p-4 md:p-6">
        {error ? (
          <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            <AlertTriangle className="size-4 shrink-0" />
            {error}
          </div>
        ) : null}

        {/* Overview */}
        {activeView === "overview" && (
          <div className="space-y-5">
            <div className="grid gap-3 @2xl/main:grid-cols-4">
              <StatCard
                label="Tickets created"
                value={formatNumber(support.created_tickets)}
                sub="New support requests"
                accent="indigo"
                loading={loading}
              />
              <StatCard
                label="Unresolved"
                value={formatNumber(support.unsolved_tickets)}
                sub={`${formatNumber(support.solved_tickets)} solved`}
                accent="rose"
                loading={loading}
              />
              <StatCard
                label="Median first reply"
                value={formatDuration(support.first_reply_time_median_min)}
                sub="Customer wait time"
                accent="amber"
                loading={loading}
              />
              <StatCard
                label="Accepted as-is"
                value={formatPercent(quality.no_edit_pct)}
                sub="Drafts sent without edits"
                accent="teal"
                loading={loading}
              />
            </div>

            <div className="grid gap-5 @5xl/main:grid-cols-[3fr_2fr]">
              <Card className="rounded-xl">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <CardTitle className="text-base">Ticket volume</CardTitle>
                      <CardDescription className="mt-0.5">
                        Support tickets over the selected period. Notification noise excluded.
                      </CardDescription>
                    </div>
                    {!loading && (
                      <Badge variant="outline" className="shrink-0 rounded-md tabular-nums">
                        {formatNumber(data?.tickets_total ?? 0)} total
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <LoadingBlock className="h-[220px]" />
                  ) : (
                    <TicketVolumeChart data={data?.volume_by_day ?? []} periodDays={period} />
                  )}
                </CardContent>
              </Card>

              <div className="space-y-4">
                <Card className="rounded-xl">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Draft quality</CardTitle>
                    <CardDescription>
                      How much agents edit Sona's drafts before sending.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <QualityBars quality={quality} loading={loading} />
                  </CardContent>
                </Card>

                <Card className="rounded-xl">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Automation funnel</CardTitle>
                    <CardDescription>
                      Sona actions from suggestion to execution.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ActionFunnel actions={actions} loading={loading} />
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        )}

        {/* Workload */}
        {activeView === "workload" && (
          <div className="space-y-5">
            <Card className="rounded-xl">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <CardTitle className="text-base">Ticket volume</CardTitle>
                    <CardDescription>
                      Support tickets over the selected period. Notification noise excluded.
                    </CardDescription>
                  </div>
                  {!loading && (
                    <Badge variant="outline" className="shrink-0 rounded-md tabular-nums">
                      {formatNumber(data?.tickets_total ?? 0)} total
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <LoadingBlock className="h-[260px]" />
                ) : (
                  <TicketVolumeChart data={data?.volume_by_day ?? []} periodDays={period} />
                )}
              </CardContent>
            </Card>

            <div className="grid gap-5 @5xl/main:grid-cols-2">
              <Card className="rounded-xl">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Gauge className="size-4 text-indigo-500" />
                    First reply speed
                  </CardTitle>
                  <CardDescription>
                    How quickly customers received the first response.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <LoadingBlock className="h-48" />
                  ) : (
                    <BucketBars rows={support.first_reply_brackets ?? []} />
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-xl">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <CheckCircle2 className="size-4 text-teal-500" />
                    Resolution time
                  </CardTitle>
                  <CardDescription>
                    How long solved tickets took from creation to resolution.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <LoadingBlock className="h-48" />
                  ) : (
                    <BucketBars rows={support.resolution_brackets ?? []} />
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Topics */}
        {activeView === "topics" && (
          <div className="grid gap-5 @5xl/main:grid-cols-[3fr_2fr]">
            <Card className="rounded-xl">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Customer topics</CardTitle>
                <CardDescription>
                  The issue types and request categories creating the most support load.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <LoadingBlock className="h-[320px]" />
                ) : (
                  <TicketTypesChart data={data?.ticket_types ?? []} />
                )}
              </CardContent>
            </Card>

            <Card className="rounded-xl">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Replies per ticket</CardTitle>
                <CardDescription>
                  Whether tickets resolve in one response or require back-and-forth.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {loading ? (
                  <LoadingBlock className="h-48" />
                ) : (
                  <>
                    <BucketBars rows={support.agent_reply_brackets ?? []} />
                    <div className="rounded-lg border bg-muted/30 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                        Average replies per ticket
                      </p>
                      <p className="mt-1.5 text-2xl font-bold tabular-nums">
                        {support.agent_replies_average == null ? "—" : support.agent_replies_average}
                      </p>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Sona AI */}
        {activeView === "sona" && (
          <div className="space-y-5">
            <div className="grid gap-5 @5xl/main:grid-cols-2">
              <Card className="rounded-xl">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Bot className="size-4 text-violet-500" />
                    Draft quality
                  </CardTitle>
                  <CardDescription>
                    How much agents edit Sona's drafts. Fewer edits = higher quality.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <QualityBars quality={quality} loading={loading} />
                </CardContent>
              </Card>

              <Card className="rounded-xl">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <MousePointerClick className="size-4 text-indigo-500" />
                    Actions by type
                  </CardTitle>
                  <CardDescription>
                    Operational actions Sona suggested, broken down by type.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <LoadingBlock className="h-48" />
                  ) : actions?.by_type?.length ? (
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
                              <TableCell className="font-medium">
                                {ACTION_LABELS[row.type] ?? row.type}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-muted-foreground">
                                {row.total}
                              </TableCell>
                              <TableCell className="text-right font-medium tabular-nums text-teal-700">
                                {row.applied}
                              </TableCell>
                              <TableCell className="text-right font-medium tabular-nums text-amber-700">
                                {row.pending}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <EmptyState icon={Zap} title="No actions yet">
                      Sona hasn't suggested any actions in this period.
                    </EmptyState>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card className="rounded-xl">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Bot className="size-4 text-violet-500" />
                  Where Sona needs improvement
                </CardTitle>
                <CardDescription>
                  Categories with the highest major-edit rate — where drafts need the most work.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <LoadingBlock className="h-48" />
                ) : !quality?.by_tag?.length ? (
                  <EmptyState icon={Bot} title="No category data yet">
                    Quality data appears here when drafts are tagged by topic.
                  </EmptyState>
                ) : (
                  <div className="overflow-hidden rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/40">
                          <TableHead>Category</TableHead>
                          <TableHead className="text-right">Drafts sent</TableHead>
                          <TableHead className="text-right">Major edit rate</TableHead>
                          <TableHead className="text-right">Avg. edit %</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {quality.by_tag.slice(0, 8).map((row) => (
                          <TableRow key={row.tag} className="hover:bg-muted/30">
                            <TableCell className="font-medium">
                              <span className="inline-flex min-w-0 items-center gap-2">
                                <span
                                  className={`size-2 shrink-0 rounded-full ${
                                    row.major_edit_pct > 40
                                      ? "bg-rose-500"
                                      : row.major_edit_pct > 20
                                        ? "bg-amber-400"
                                        : "bg-teal-500"
                                  }`}
                                />
                                <span className="truncate">{row.tag}</span>
                              </span>
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {row.total}
                            </TableCell>
                            <TableCell
                              className={`text-right font-medium tabular-nums ${
                                row.major_edit_pct > 40
                                  ? "text-rose-700"
                                  : row.major_edit_pct > 20
                                    ? "text-amber-700"
                                    : "text-teal-700"
                              }`}
                            >
                              {row.major_edit_pct}%
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {row.avg_edited_pct ?? 0}%
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Diagnostics */}
        {activeView === "diagnostics" && (
          <div className="space-y-5">
            <div className="grid gap-5 @5xl/main:grid-cols-2">
              <Card className="rounded-xl">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Slowest first replies</CardTitle>
                  <CardDescription>
                    Tickets that most impacted average first-reply time in this period.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <LoadingBlock className="h-48" />
                  ) : (
                    <TicketDrillTable
                      rows={support.slow_first_reply_tickets ?? []}
                      metricLabel="First reply"
                    />
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-xl">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Slowest resolutions</CardTitle>
                  <CardDescription>
                    Solved tickets that took the longest from open to close.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <LoadingBlock className="h-48" />
                  ) : (
                    <TicketDrillTable
                      rows={support.slow_resolution_tickets ?? []}
                      metricLabel="Resolution"
                    />
                  )}
                </CardContent>
              </Card>
            </div>

            <Card className="rounded-xl">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Data coverage</CardTitle>
                <CardDescription>
                  How much of the selected period has reliable tracking data. Low coverage means some metrics may be incomplete.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <DataCoverage coverage={data?.coverage} loading={loading} />
                <div>
                  <p className="mb-3 text-sm font-medium text-muted-foreground">Not yet tracked</p>
                  <div className="grid gap-3 @2xl/main:grid-cols-3">
                    <UnsupportedMetric label="Reopened tickets" />
                    <UnsupportedMetric label="Full resolution median" />
                    <UnsupportedMetric label="Group / assignee averages" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
