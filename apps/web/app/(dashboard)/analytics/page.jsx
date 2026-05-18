"use client";

import { useCallback, useEffect, forwardRef, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  FileBarChart,
  Gauge,
  Inbox,
  ListFilter,
  PackageSearch,
  Search,
  Table2,
  TrendingUp,
  X,
} from "lucide-react";

import { TicketVolumeChart } from "@/components/analytics/TicketVolumeChart";
import { exportAnalyticsToExcel } from "@/utils/export-analytics";
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

const EMPTY_TICKETS = [];

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
  { id: "support", label: "Support" },
  { id: "topics", label: "Topics" },
  { id: "tickets", label: "Tickets" },
];

function AnalyticsHeader({ period, range, onPreset, onRangeChange, activeTab, onTabChange, onExport, exportDisabled }) {
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
            onClick={onExport}
            disabled={exportDisabled}
            title="Export analytics data to Excel"
            className="inline-flex h-9 items-center gap-2 rounded-lg border bg-background px-3 text-sm font-medium shadow-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="size-4" />
            Export Excel
          </button>
        </div>
      </div>
      <div className="flex">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium ${
              activeTab === tab.id
                ? "-mb-px border-b-2 border-[#6366f1] text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            style={{ transition: "color 150ms cubic-bezier(0.23, 1, 0.32, 1), border-color 150ms cubic-bezier(0.23, 1, 0.32, 1)" }}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
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
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/50">
        Topics &amp; Problem Areas
      </p>
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
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/50">
        Strengths &amp; Weak Spots
      </p>
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

const STATUS_STYLES = {
  new: "bg-blue-50 text-blue-700 border-blue-200",
  open: "bg-blue-50 text-blue-700 border-blue-200",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  solved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  closed: "bg-muted text-muted-foreground border-border",
  hold: "bg-purple-50 text-purple-700 border-purple-200",
};

function TicketStatusBadge({ status }) {
  const key = (status || "").toLowerCase();
  const cls = STATUS_STYLES[key] ?? "bg-muted text-muted-foreground border-border";
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium capitalize ${cls}`}>
      {status}
    </span>
  );
}

const FilterTriggerButton = forwardRef(function FilterTriggerButton({ label, isActive, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className="group/ft inline-flex items-center gap-1 rounded px-0.5 py-0.5 hover:bg-muted/60"
      {...props}
    >
      <span className={`text-xs font-semibold uppercase tracking-wide ${isActive ? "text-[#6366f1]" : "text-muted-foreground/60 group-hover/ft:text-muted-foreground"}`}>
        {label}
      </span>
      <ChevronDown className={`size-3 shrink-0 transition-colors ${isActive ? "text-[#6366f1]" : "text-muted-foreground/30 group-hover/ft:text-muted-foreground/60"}`} />
    </button>
  );
});

function CheckboxFilterPopover({ label, values, selected, onChange }) {
  const allSelected = selected.length === 0;

  const toggle = (val) => {
    if (allSelected) {
      onChange(values.filter((v) => v !== val));
    } else {
      const next = selected.includes(val)
        ? selected.filter((v) => v !== val)
        : [...selected, val];
      onChange(next.length === values.length ? [] : next);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <FilterTriggerButton label={label} isActive={!allSelected} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-2">
        <label className="mb-1.5 flex cursor-pointer items-center gap-2 rounded-md border-b px-2 pb-2.5 pt-1 text-sm font-medium hover:bg-muted/60">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => onChange([])}
            className="rounded"
          />
          Select all
        </label>
        <div className="max-h-52 space-y-0.5 overflow-y-auto">
          {values.map((v) => (
            <label key={v} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60">
              <input
                type="checkbox"
                checked={allSelected || selected.includes(v)}
                onChange={() => toggle(v)}
                className="rounded"
              />
              <span className="capitalize">{v}</span>
            </label>
          ))}
        </div>
        {!allSelected ? (
          <button
            type="button"
            onClick={() => onChange([])}
            className="mt-1.5 w-full rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground hover:border-foreground/30 hover:text-foreground"
          >
            Clear filter
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function TextFilterPopover({ label, value, onChange, placeholder }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <FilterTriggerButton label={label} isActive={Boolean(value)} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            autoFocus
            className="h-8 w-full rounded-md border bg-background pl-8 pr-8 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-foreground/20"
          />
          {value ? (
            <button
              type="button"
              onClick={() => onChange("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 hover:bg-muted"
            >
              <X className="size-3.5 text-muted-foreground" />
            </button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function DateRangeFilterPopover({ label, value, onChange }) {
  const isActive = Boolean(value.start || value.end);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <FilterTriggerButton label={label} isActive={isActive} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-3">
        <div className="space-y-2">
          <div>
            <p className="mb-1 text-xs text-muted-foreground">From</p>
            <input
              type="date"
              value={value.start}
              onChange={(e) => onChange({ ...value, start: e.target.value })}
              className="h-8 w-full rounded-md border bg-background px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20"
            />
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">To</p>
            <input
              type="date"
              value={value.end}
              min={value.start || undefined}
              onChange={(e) => onChange({ ...value, end: e.target.value })}
              className="h-8 w-full rounded-md border bg-background px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20"
            />
          </div>
          {isActive ? (
            <button
              type="button"
              onClick={() => onChange({ start: "", end: "" })}
              className="w-full rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground hover:border-foreground/30 hover:text-foreground"
            >
              Clear filter
            </button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function AnalyticsDrilldownTable({ data, drilldown }) {
  const [ticketSearch, setTicketSearch] = useState("");
  const [subjectSearch, setSubjectSearch] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState([]);
  const [requestTypeFilter, setRequestTypeFilter] = useState([]);
  const [productFilter, setProductFilter] = useState([]);
  const [createdFilter, setCreatedFilter] = useState({ start: "", end: "" });
  const [updatedFilter, setUpdatedFilter] = useState({ start: "", end: "" });
  const [firstReplyFilter, setFirstReplyFilter] = useState([]);

  const tickets = data?.drilldowns?.byKey?.[drilldown.key] ?? data?.drilldowns?.defaultTickets ?? EMPTY_TICKETS;
  const title = drilldown.title || "All support tickets";

  useEffect(() => {
    setTicketSearch("");
    setSubjectSearch("");
    setCustomerSearch("");
    setStatusFilter([]);
    setRequestTypeFilter([]);
    setProductFilter([]);
    setCreatedFilter({ start: "", end: "" });
    setUpdatedFilter({ start: "", end: "" });
    setFirstReplyFilter([]);
  }, [drilldown.key]);

  const statuses = useMemo(() => [...new Set(tickets.map((t) => t.status).filter(Boolean))].sort(), [tickets]);
  const requestTypes = useMemo(() => [...new Set(tickets.map((t) => t.requestType).filter(Boolean))].sort(), [tickets]);
  const products = useMemo(() => [...new Set(tickets.map((t) => t.product).filter(Boolean))].sort(), [tickets]);
  const firstReplyLabels = useMemo(() => {
    const labels = tickets.map((t) => t.firstReplyMinutes != null ? formatDuration(t.firstReplyMinutes) : "No reply");
    return [...new Set(labels)].sort();
  }, [tickets]);

  const filteredTickets = useMemo(() => {
    return tickets.filter((ticket) => {
      if (ticketSearch) {
        const q = ticketSearch.toLowerCase();
        if (!String(ticket.ticketNumber || "").includes(q) && !String(ticket.id || "").toLowerCase().includes(q)) return false;
      }
      if (subjectSearch && !(ticket.subject || "").toLowerCase().includes(subjectSearch.toLowerCase())) return false;
      if (customerSearch && !(ticket.customer || "").toLowerCase().includes(customerSearch.toLowerCase())) return false;
      if (statusFilter.length > 0 && !statusFilter.includes(ticket.status)) return false;
      if (requestTypeFilter.length > 0 && !requestTypeFilter.includes(ticket.requestType)) return false;
      if (productFilter.length > 0 && !productFilter.includes(ticket.product)) return false;
      if (createdFilter.start || createdFilter.end) {
        const d = ticket.createdAt ? new Date(ticket.createdAt) : null;
        if (!d || Number.isNaN(d.getTime())) return false;
        if (createdFilter.start && d < new Date(`${createdFilter.start}T00:00:00`)) return false;
        if (createdFilter.end && d > new Date(`${createdFilter.end}T23:59:59`)) return false;
      }
      if (updatedFilter.start || updatedFilter.end) {
        const d = ticket.updatedAt ? new Date(ticket.updatedAt) : null;
        if (!d || Number.isNaN(d.getTime())) return false;
        if (updatedFilter.start && d < new Date(`${updatedFilter.start}T00:00:00`)) return false;
        if (updatedFilter.end && d > new Date(`${updatedFilter.end}T23:59:59`)) return false;
      }
      if (firstReplyFilter.length > 0) {
        const label = ticket.firstReplyMinutes != null ? formatDuration(ticket.firstReplyMinutes) : "No reply";
        if (!firstReplyFilter.includes(label)) return false;
      }
      return true;
    });
  }, [tickets, ticketSearch, subjectSearch, customerSearch, statusFilter, requestTypeFilter, productFilter, createdFilter, updatedFilter, firstReplyFilter]);

  const hasActiveFilters = ticketSearch || subjectSearch || customerSearch ||
    statusFilter.length > 0 || requestTypeFilter.length > 0 || productFilter.length > 0 ||
    createdFilter.start || createdFilter.end || updatedFilter.start || updatedFilter.end ||
    firstReplyFilter.length > 0;

  const clearAllFilters = () => {
    setTicketSearch("");
    setSubjectSearch("");
    setCustomerSearch("");
    setStatusFilter([]);
    setRequestTypeFilter([]);
    setProductFilter([]);
    setCreatedFilter({ start: "", end: "" });
    setUpdatedFilter({ start: "", end: "" });
    setFirstReplyFilter([]);
  };

  return (
    <section className="analytics-section space-y-3" style={sectionMotionStyle(5)}>
      <SectionHeading
        title={drilldown.key === "all" ? "Tickets behind the numbers" : `Showing tickets for: ${title}`}
        action={hasActiveFilters ? (
          <button
            type="button"
            onClick={clearAllFilters}
            className="flex items-center gap-1.5 rounded-md border border-dashed px-2.5 py-1.5 text-xs text-muted-foreground hover:border-foreground/30 hover:text-foreground"
          >
            <X className="size-3" />
            Clear all filters
          </button>
        ) : null}
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
                  <TableRow className="border-b border-border/60 bg-muted/25 hover:bg-muted/25">
                    <TableHead className="min-w-[100px] py-3">
                      <TextFilterPopover label="Ticket" value={ticketSearch} onChange={setTicketSearch} placeholder="Search ticket #…" />
                    </TableHead>
                    <TableHead className="min-w-64 py-3">
                      <TextFilterPopover label="Subject" value={subjectSearch} onChange={setSubjectSearch} placeholder="Search subject…" />
                    </TableHead>
                    <TableHead className="min-w-44 py-3">
                      <TextFilterPopover label="Customer" value={customerSearch} onChange={setCustomerSearch} placeholder="Search customer…" />
                    </TableHead>
                    <TableHead className="py-3">
                      <CheckboxFilterPopover label="Status" values={statuses} selected={statusFilter} onChange={setStatusFilter} />
                    </TableHead>
                    <TableHead className="min-w-40 py-3">
                      <CheckboxFilterPopover label="Request type" values={requestTypes} selected={requestTypeFilter} onChange={setRequestTypeFilter} />
                    </TableHead>
                    <TableHead className="min-w-36 py-3">
                      <CheckboxFilterPopover label="Product" values={products} selected={productFilter} onChange={setProductFilter} />
                    </TableHead>
                    <TableHead className="py-3">
                      <DateRangeFilterPopover label="Created" value={createdFilter} onChange={setCreatedFilter} />
                    </TableHead>
                    <TableHead className="py-3">
                      <DateRangeFilterPopover label="Updated" value={updatedFilter} onChange={setUpdatedFilter} />
                    </TableHead>
                    <TableHead className="py-3">
                      <CheckboxFilterPopover label="First reply" values={firstReplyLabels} selected={firstReplyFilter} onChange={setFirstReplyFilter} />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTickets.length ? filteredTickets.map((ticket) => (
                    <TableRow key={ticket.id} className="group border-border/40 transition-colors hover:bg-muted/30">
                      <TableCell className="whitespace-nowrap">
                        <a
                          href={ticket.url}
                          className="inline-flex items-center rounded-md bg-indigo-50 px-2 py-0.5 font-mono text-xs font-medium text-indigo-600 ring-1 ring-inset ring-indigo-600/20 transition-colors hover:bg-indigo-100"
                        >
                          #{ticket.ticketNumber || String(ticket.id).slice(0, 8)}
                        </a>
                      </TableCell>
                      <TableCell className="max-w-80 text-sm">
                        <span className="line-clamp-1">{ticket.subject}</span>
                      </TableCell>
                      <TableCell className="max-w-56 text-sm text-muted-foreground">
                        <span className="line-clamp-1">{ticket.customer}</span>
                      </TableCell>
                      <TableCell>
                        <TicketStatusBadge status={ticket.status} />
                      </TableCell>
                      <TableCell className="max-w-44 text-sm">
                        <span className="line-clamp-1">{ticket.requestType}</span>
                      </TableCell>
                      <TableCell className="max-w-40 text-sm text-muted-foreground">
                        <span className="line-clamp-1">{ticket.product || <span className="text-muted-foreground/40">—</span>}</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">{formatDate(ticket.createdAt)}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">{formatDate(ticket.updatedAt)}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm tabular-nums">
                        {ticket.firstReplyMinutes != null ? formatDuration(ticket.firstReplyMinutes) : <span className="text-muted-foreground/40">—</span>}
                      </TableCell>
                    </TableRow>
                  )) : (
                    <TableRow>
                      <TableCell colSpan={9} className="py-10 text-center">
                        <p className="text-sm text-muted-foreground">No tickets match the current filters.</p>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {hasActiveFilters ? (
                <div className="border-t bg-muted/10 px-4 py-2.5">
                  <p className="text-xs text-muted-foreground">
                    {filteredTickets.length < tickets.length
                      ? `${formatNumber(filteredTickets.length)} of ${formatNumber(tickets.length)} tickets`
                      : `${formatNumber(tickets.length)} tickets`}
                  </p>
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

      .analytics-stat-card {
        animation: analytics-enter 280ms cubic-bezier(0.23, 1, 0.32, 1) both;
        transition: transform 150ms cubic-bezier(0.23, 1, 0.32, 1), box-shadow 150ms cubic-bezier(0.23, 1, 0.32, 1);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.04);
      }

      .analytics-stat-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.05);
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

function SonaStatCard({ value, label, sub, accent = false, loading, style }) {
  const isPlaceholder = value === "Collecting data";
  return (
    <div className="analytics-stat-card rounded-xl border bg-background p-5 text-center" style={style}>
      {loading ? (
        <Skeleton className="mx-auto mt-1 h-9 w-20" />
      ) : isPlaceholder ? (
        <p className="mt-3 text-sm font-medium text-muted-foreground/50">Collecting data</p>
      ) : (
        <p className={`text-3xl font-extrabold tracking-tight tabular-nums ${accent ? "text-[#6366f1]" : ""}`}>
          {value}
        </p>
      )}
      <p className={`text-xs text-muted-foreground ${isPlaceholder ? "mt-2" : "mt-2"}`}>{label}</p>
      {sub && !isPlaceholder ? (
        <p className={`mt-1 text-xs font-medium ${accent ? "text-[#6366f1]" : "text-muted-foreground"}`}>
          {sub}
        </p>
      ) : null}
    </div>
  );
}

function SupportStatCard({ label, value, change, sub, loading, style }) {
  const toneClass =
    change?.tone === "good"
      ? "text-green-600"
      : change?.tone === "watch"
        ? "text-amber-600"
        : "text-muted-foreground";
  return (
    <div className="analytics-stat-card rounded-xl border bg-background p-5" style={style}>
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
  const topics = data?.topics ?? {};
  const hasEnoughDraftQuality = (impact.trackedSentDrafts || 0) >= 3;
  const draftQualityTotal = impact.draftQualityTotal || ((impact.trackedSentDrafts || 0) + (impact.rejected ?? impact.rejectedDrafts ?? 0));
  const estimatedWork = impact.estimatedWorkAssisted ?? {};
  const topRequestTypes = (topics.requestTypes ?? []).slice(0, 4);

  return (
    <div className="analytics-section flex flex-col gap-6">
      <div>
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground/50">
          Sona AI
        </p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SonaStatCard
            loading={loading}
            value={estimatedWork.label || "Collecting data"}
            label="Time saved this period"
            sub={estimatedWork.label ? "Drafts + handled workflows" : "Needs more activity"}
            accent={!!estimatedWork.label}
            style={{ animationDelay: "0ms" }}
          />
          <SonaStatCard
            loading={loading}
            value={hasEnoughDraftQuality ? formatNumber(impact.sentAsIs || 0) : "Collecting data"}
            label="Drafts sent as-is"
            sub={hasEnoughDraftQuality && draftQualityTotal > 0 ? `${formatPercent(((impact.sentAsIs || 0) / draftQualityTotal) * 100)} of sent drafts` : undefined}
            accent={hasEnoughDraftQuality}
            style={{ animationDelay: "40ms" }}
          />
          <SonaStatCard
            loading={loading}
            value={hasEnoughDraftQuality && impact.averageEditPct != null ? formatPercent(impact.averageEditPct) : "Collecting data"}
            label="Avg. edit effort"
            sub={hasEnoughDraftQuality ? "Lower is better" : undefined}
            style={{ animationDelay: "80ms" }}
          />
          <SonaStatCard
            loading={loading}
            value={formatPercent(impact.actionApprovalRate)}
            label="Automation rate"
            sub="of suggested actions"
            accent
            style={{ animationDelay: "120ms" }}
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
            style={{ animationDelay: "160ms" }}
          />
          <SupportStatCard
            loading={loading}
            label="Unsolved tickets"
            value={formatNumber(summary.unsolvedTickets)}
            change={formatChange(summary.unsolvedTicketsChangePct, { inverse: true })}
            style={{ animationDelay: "200ms" }}
          />
          <SupportStatCard
            loading={loading}
            label="Median first reply"
            value={summary.firstReplyDataQuality === "limited" ? "Limited" : formatDuration(summary.medianFirstReplyMinutes)}
            change={formatChange(summary.medianFirstReplyChangePct, { inverse: true })}
            style={{ animationDelay: "240ms" }}
          />
        </div>
      </div>

      <div className="rounded-xl border bg-background p-5" style={sectionMotionStyle(3)}>
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

      {(loading || topRequestTypes.length > 0) && (
        <div style={sectionMotionStyle(4)}>
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground/50">
            Top Request Types
          </p>
          {loading ? (
            <LoadingCard className="h-32" />
          ) : (
            <HorizontalBarList
              items={topRequestTypes}
              emptyTitle="No tagged tickets yet"
              emptyDescription="Request types appear after tickets are tagged."
              onSelect={onDrilldown}
              activeKey={drilldownKey}
            />
          )}
        </div>
      )}
    </div>
  );
}

function TopicsTab({ data, loading, onDrilldown, drilldownKey }) {
  return (
    <div className="analytics-section flex flex-col gap-6">
      <TopicsProblemAreasSection
        data={data}
        loading={loading}
        onDrilldown={onDrilldown}
        drilldownKey={drilldownKey}
      />
      <StrengthsWeakSpotsSection
        data={data}
        loading={loading}
        onDrilldown={onDrilldown}
        drilldownKey={drilldownKey}
      />
    </div>
  );
}

function TicketsTab({ data, drilldown }) {
  return (
    <div className="analytics-section flex flex-col gap-6">
      <div id="analytics-drilldown">
        <AnalyticsDrilldownTable data={data} drilldown={drilldown} />
      </div>
    </div>
  );
}

function SupportKpiCard({ label, value, sub, loading, accent = false, style }) {
  const isPlaceholder = !value || value === "Collecting data" || value === "-";
  return (
    <div className="analytics-stat-card rounded-xl border bg-background p-5 text-center" style={style}>
      {loading ? (
        <Skeleton className="mx-auto mt-1 h-8 w-20" />
      ) : isPlaceholder ? (
        <p className="mt-2 text-sm font-medium text-muted-foreground/40">Collecting data</p>
      ) : (
        <p className={`text-3xl font-bold tracking-tight tabular-nums ${accent ? "text-[#6366f1]" : ""}`}>
          {value}
        </p>
      )}
      <p className={`text-xs text-muted-foreground ${isPlaceholder ? "mt-2" : "mt-2"}`}>{label}</p>
      {sub && !isPlaceholder ? (
        <p className="mt-1 text-xs text-muted-foreground/70">{sub}</p>
      ) : null}
    </div>
  );
}

function TimeBracketChart({ brackets, loading, emptyTitle }) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="grid grid-cols-[76px_1fr_36px_44px] items-center gap-2.5">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-1.5 w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
          </div>
        ))}
      </div>
    );
  }
  if (!brackets?.length) {
    return <EmptyAnalyticsState icon={Gauge} title={emptyTitle}>Collecting data.</EmptyAnalyticsState>;
  }
  const max = Math.max(...brackets.map((b) => b.count), 1);
  return (
    <div className="space-y-2.5">
      {brackets.map((bracket) => {
        const isNoReply = bracket.key === "no_reply";
        return (
          <div key={bracket.key} className="grid grid-cols-[76px_1fr_36px_44px] items-center gap-2.5">
            <span className={`text-right text-xs tabular-nums ${isNoReply ? "font-medium text-amber-600" : "text-muted-foreground"}`}>
              {bracket.label}
            </span>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="analytics-bar h-full rounded-full"
                style={{
                  width: `${Math.max(bracket.count ? 3 : 0, (bracket.count / max) * 100)}%`,
                  backgroundColor: isNoReply ? "rgb(251 191 36)" : "#6366f1",
                  opacity: 0.75,
                }}
              />
            </div>
            <span className="text-right text-xs font-semibold tabular-nums">{formatPercent(bracket.pct)}</span>
            <span className="text-right text-xs tabular-nums text-muted-foreground/60">
              {formatNumber(bracket.count)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function SupportTab({ data, loading }) {
  const kpis = data?.supportKpis ?? {};

  return (
    <div className="analytics-section flex flex-col gap-6">
      <div>
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground/50">
          Tickets
        </p>
        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <SupportKpiCard loading={loading} label="Created tickets" value={formatNumber(kpis.createdTickets)} style={{ animationDelay: "0ms" }} />
          <SupportKpiCard loading={loading} label="Unsolved tickets" value={formatNumber(kpis.unsolvedTickets)} style={{ animationDelay: "40ms" }} />
          <SupportKpiCard loading={loading} label="Solved tickets" value={formatNumber(kpis.solvedTickets)} style={{ animationDelay: "80ms" }} />
          <SupportKpiCard
            loading={loading}
            label="One-touch tickets"
            value={kpis.solvedTickets > 0 ? formatPercent(kpis.oneTouchRate) : "Collecting data"}
            sub={kpis.solvedTickets > 0 ? `${formatNumber(kpis.oneTouchTickets)} of ${formatNumber(kpis.solvedTickets)} solved` : undefined}
            accent={kpis.solvedTickets > 0}
            style={{ animationDelay: "120ms" }}
          />
          <SupportKpiCard
            loading={loading}
            label="Reopened tickets"
            value="Collecting data"
            style={{ animationDelay: "160ms" }}
          />
        </div>
      </div>

      <div>
        <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-muted-foreground/50">
          Response &amp; Resolution Time
        </p>
        <div className="grid gap-5 xl:grid-cols-2">
          <Card className="rounded-2xl shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Tickets by first reply time</CardTitle>
            </CardHeader>
            <CardContent>
              <TimeBracketChart
                brackets={kpis.firstReplyBrackets}
                loading={loading}
                emptyTitle="No first reply data yet"
              />
            </CardContent>
          </Card>
          <Card className="rounded-2xl shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Tickets by full resolution time</CardTitle>
            </CardHeader>
            <CardContent>
              <TimeBracketChart
                brackets={kpis.resolutionBrackets}
                loading={loading}
                emptyTitle="No resolution time data yet"
              />
            </CardContent>
          </Card>
        </div>
      </div>

      <div>
        <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-muted-foreground/50">
          Median Times
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="analytics-stat-card rounded-xl border bg-background p-5 text-center" style={{ animationDelay: "200ms" }}>
            {loading ? (
              <Skeleton className="mx-auto mt-1 h-8 w-24" />
            ) : (
              <p className="text-3xl font-bold tracking-tight tabular-nums">
                {formatDuration(kpis.medianFirstReplyMinutes)}
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">First reply time median</p>
          </div>
          <div className="analytics-stat-card rounded-xl border bg-background p-5 text-center" style={{ animationDelay: "240ms" }}>
            {loading ? (
              <Skeleton className="mx-auto mt-1 h-8 w-24" />
            ) : kpis.medianResolutionMinutes != null ? (
              <p className="text-3xl font-bold tracking-tight tabular-nums">
                {formatDuration(kpis.medianResolutionMinutes)}
              </p>
            ) : (
              <p className="mt-2 text-sm font-medium text-muted-foreground/40">Collecting data</p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">Full resolution time median</p>
            <p className="mt-1 text-xs text-muted-foreground/50">Time from open to solved</p>
          </div>
        </div>
      </div>
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

  const handleExport = useCallback(async () => {
    if (!data) return;
    try {
      const periodLabel = getPeriodButtonLabel(period, dateRange);
      await exportAnalyticsToExcel(data, periodLabel);
    } catch (err) {
      setError("Export failed: " + (err?.message || "unknown error"));
    }
  }, [data, period, dateRange]);

  const hasData = useMemo(() => Boolean(data && !error), [data, error]);

  return (
    <div className="@container/main flex flex-1 flex-col bg-sidebar">
      <AnalyticsMotionStyles />
      <AnalyticsHeader
        period={period}
        range={dateRange}
        onPreset={handlePreset}
        onRangeChange={setDateRange}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onExport={handleExport}
        exportDisabled={!data || loading || Boolean(error)}
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
        {activeTab === "topics" && (hasData || loading) && (
          <TopicsTab data={data} loading={loading} onDrilldown={handleDrilldown} drilldownKey={drilldown.key} />
        )}
        {activeTab === "support" && (hasData || loading) && (
          <SupportTab data={data} loading={loading} />
        )}
        {activeTab === "tickets" && (
          <TicketsTab data={data} drilldown={drilldown} />
        )}
      </main>
    </div>
  );
}
