"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  Download,
  Inbox,
  ListFilter,
  LoaderCircle,
  PackageSearch,
  Search,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { AnalyticsChartCard, AnalyticsSkeleton, FocusSignals, MetricCell, MetricStrip } from "@/components/analytics/AnalyticsPrimitives";
import { CommerceRateChart, SonaRateChart, SupportFlowChart } from "@/components/analytics/AnalyticsTrendCharts";
import { exportAnalyticsToExcel } from "@/utils/export-analytics";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";

const PERIOD_OPTIONS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "this_month", label: "This month" },
];
const REPORTS = [
  { id: "overview", label: "Overview" },
  { id: "support", label: "Support" },
  { id: "business", label: "Business impact" },
  { id: "sona", label: "Sona impact" },
];
const REPORT_IDS = new Set([...REPORTS.map((report) => report.id), "tickets"]);
const REPORT_COPY = {
  support: ["Service operations", "Support performance", "See whether the team is keeping pace, where response time slips and whether issues stay solved."],
  business: ["Business impact", "Where support meets the business", "Connect customer contact to orders, returns, refunded value, products and recurring friction."],
  sona: ["Sona impact", "Measured assistance and quality", "See how much work Sona assists, how strong the output is and which workflows are ready for more automation."],
};

function formatNumber(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return new Intl.NumberFormat("en-US").format(Number(value));
}
function formatPercent(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return `${Math.round(Number(value))}%`;
}
function formatDuration(minutes) {
  if (minutes == null || Number.isNaN(Number(minutes))) return "—";
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hrs`;
  const days = hours / 24;
  return `${Number.isInteger(days) ? days : days.toFixed(1)} days`;
}
function formatMoney(amount, currency) {
  if (amount == null || !currency) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(amount));
}
function formatMoneyTotals(totals = []) {
  if (!totals.length) return "Collecting";
  if (totals.length === 1) return formatMoney(totals[0].amount, totals[0].currency);
  return `${totals.length} currencies`;
}
function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function formatDateLabel(value, fallback) {
  return value ? formatDate(`${value}T00:00:00`) : fallback;
}
function formatChange(value, { inverse = false, neutral = false } = {}) {
  if (value == null || Number.isNaN(Number(value))) return { label: "No previous data", tone: "muted" };
  if (Number(value) === 0) return { label: "No change", tone: "muted" };
  const improved = inverse ? Number(value) < 0 : Number(value) > 0;
  return {
    label: `${Number(value) > 0 ? "+" : ""}${Math.round(Number(value))}% vs previous`,
    tone: neutral ? "neutral" : improved ? "good" : "watch",
  };
}
function resolutionRate(summary) {
  return summary.supportTickets > 0 ? (summary.solvedTickets / summary.supportTickets) * 100 : null;
}
function periodLabel(period, range) {
  if (range.start && range.end) return `${formatDateLabel(range.start, "Start")} – ${formatDateLabel(range.end, "End")}`;
  return PERIOD_OPTIONS.find((option) => option.value === period)?.label || "Date range";
}

function EmptyState({ icon: Icon = ListFilter, title, description }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg bg-muted/30 p-6 text-center">
      <Icon className="size-5 text-muted-foreground/45" />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-sm text-xs leading-5 text-muted-foreground">{description}</p>
    </div>
  );
}

function AnalyticsHeader({ period, range, report, refreshing, onPeriod, onRange, onReport, onExport, exportDisabled }) {
  const startRef = useRef(null);
  const endRef = useRef(null);
  const openPicker = (input) => typeof input?.showPicker === "function" ? input.showPicker() : input?.focus();

  return (
    <header className="bg-background">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 px-4 pb-4 pt-6 md:px-6 lg:flex-row lg:items-start lg:justify-between lg:px-7">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">Support performance, business impact and Sona value.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" aria-busy={refreshing}>
                {refreshing ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <CalendarDays data-icon="inline-start" />}
                {periodLabel(period, range)}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-3">
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-3 gap-1 rounded-md bg-muted p-1">
                  {PERIOD_OPTIONS.map((option) => (
                    <button key={option.value} type="button" onClick={() => onPeriod(option.value)} className={cn("h-8 rounded text-xs font-medium transition-colors", !range.start && !range.end && period === option.value ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>{option.label}</button>
                  ))}
                </div>
                <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
                  {[{ label: "From", key: "start", ref: startRef }, { label: "To", key: "end", ref: endRef }].map((field, index) => (
                    <div key={field.key} className={cn("grid gap-1", index === 1 && "col-start-3")}>
                      <span className="text-xs font-medium text-muted-foreground">{field.label}</span>
                      <button type="button" onClick={() => openPicker(field.ref.current)} className="relative inline-flex h-9 items-center justify-between gap-2 rounded-md border bg-background px-2 text-left text-sm">
                        <span className={range[field.key] ? "text-foreground" : "text-muted-foreground"}>{formatDateLabel(range[field.key], field.label)}</span>
                        <CalendarDays className="size-4 text-muted-foreground" />
                        <input ref={field.ref} type="date" aria-label={field.label} value={range[field.key]} min={field.key === "end" ? range.start || undefined : undefined} onChange={(event) => onRange({ ...range, [field.key]: event.target.value })} className="pointer-events-none absolute inset-0 opacity-0" tabIndex={-1} />
                      </button>
                    </div>
                  ))}
                  <span className="col-start-2 row-start-1 pb-2 text-xs text-muted-foreground">to</span>
                </div>
              </div>
            </PopoverContent>
          </Popover>
          <Button variant="outline" onClick={onExport} disabled={exportDisabled}><Download data-icon="inline-start" />Export</Button>
        </div>
      </div>
      <div className="mx-auto w-full max-w-[1500px] overflow-x-auto px-4 pb-4 md:px-6 lg:px-7">
        <Tabs value={report === "tickets" ? "overview" : report} onValueChange={onReport}>
          <TabsList className="h-auto w-max justify-start gap-1 rounded-lg bg-muted/60 p-1">
            {REPORTS.map((item) => <TabsTrigger key={item.id} value={item.id} className="rounded-md px-4 py-1.5 text-sm shadow-none transition-[color,background-color,box-shadow] duration-150 data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm">{item.label}</TabsTrigger>)}
          </TabsList>
        </Tabs>
      </div>
    </header>
  );
}

function ReportIntro({ report }) {
  const copy = REPORT_COPY[report];
  if (!copy) return null;
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{copy[0]}</p>
      <h2 className="mt-1.5 text-xl font-semibold tracking-tight">{copy[1]}</h2>
      <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{copy[2]}</p>
    </div>
  );
}

function HorizontalBars({ items = [], onSelect, emptyTitle, emptyDescription }) {
  if (!items.length) return <EmptyState title={emptyTitle} description={emptyDescription} />;
  const max = Math.max(...items.map((item) => Number(item.count) || 0), 1);
  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => {
        const Component = onSelect ? "button" : "div";
        return (
          <Component key={item.key || item.label} type={onSelect ? "button" : undefined} onClick={onSelect ? () => onSelect(item.key, item.label) : undefined} className={cn("group text-left", onSelect && "analytics-pressable rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>
            <div className="flex items-center justify-between gap-4 text-xs"><span className="truncate font-medium">{item.label}</span><span className="shrink-0 tabular-nums text-muted-foreground">{formatNumber(item.count)}{item.pct != null ? ` · ${formatPercent(item.pct)}` : ""}</span></div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"><div className="analytics-bar h-full rounded-full bg-primary/75" style={{ width: `${Math.max(item.count ? 3 : 0, (item.count / max) * 100)}%` }} /></div>
          </Component>
        );
      })}
    </div>
  );
}

function TimeDistribution({ rows = [], onSelect, title }) {
  if (!rows.length) return <EmptyState title={`No ${title.toLowerCase()} data yet`} description="This distribution appears after enough conversations have timestamps." />;
  const max = Math.max(...rows.map((row) => row.count), 1);
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <button key={row.key} type="button" onClick={() => onSelect?.(row.key === "no_reply" ? "slow_first_replies" : "support_tickets", row.label)} className="analytics-pressable grid grid-cols-[76px_1fr_40px_42px] items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className={cn("text-right text-xs", row.key === "no_reply" ? "font-medium text-amber-700" : "text-muted-foreground")}>{row.label}</span>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("analytics-bar h-full rounded-full", row.key === "no_reply" ? "bg-amber-500" : "bg-primary/75")} style={{ width: `${Math.max(row.count ? 3 : 0, (row.count / max) * 100)}%` }} /></div>
          <span className="text-right text-xs font-medium tabular-nums">{formatPercent(row.pct)}</span>
          <span className="text-right text-xs tabular-nums text-muted-foreground">{formatNumber(row.count)}</span>
        </button>
      ))}
    </div>
  );
}

function QualityBreakdown({ breakdown = {} }) {
  const rows = [
    ["Sent as-is", breakdown.sentAsIs, "bg-emerald-500"],
    ["Minor edits", breakdown.minorEdits, "bg-primary"],
    ["Major edits", breakdown.majorEdits, "bg-amber-500"],
    ["Rejected", breakdown.rejected, "bg-rose-500"],
  ];
  if (!breakdown.total) return <EmptyState icon={Sparkles} title="Draft quality is collecting" description="Send and review more Sona drafts to unlock the quality distribution." />;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex h-3 overflow-hidden rounded-full bg-muted">{rows.map(([label, row, color]) => row?.pct > 0 ? <div key={label} className={cn("analytics-bar", color)} style={{ width: `${row.pct}%` }} title={`${label}: ${row.pct}%`} /> : null)}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map(([label, row, color]) => <div key={label} className="flex items-center justify-between gap-3 rounded-md bg-muted/35 px-3 py-2"><div className="flex items-center gap-2"><span className={cn("size-2 rounded-full", color)} /><span className="text-xs text-muted-foreground">{label}</span></div><span className="text-sm font-medium tabular-nums">{formatNumber(row?.count || 0)} · {formatPercent(row?.pct || 0)}</span></div>)}
      </div>
    </div>
  );
}

function OverviewReport({ data, onDrilldown }) {
  const summary = data.summary || {};
  const commerce = data.commerce || {};
  const outcomes = data.customerOutcomes || {};
  const impact = data.sonaImpact || {};
  const topics = data.topics || {};
  const resolved = resolutionRate(summary);
  const friction = [...(topics.requestTypes || []).slice(0, 3), ...(topics.products || []).slice(0, 2)];

  return (
    <div className="analytics-report flex flex-col gap-5">
      <MetricStrip columns={5}>
        <MetricCell label="Open backlog" definition="Support tickets in the period that are not currently solved or closed." value={formatNumber(summary.unsolvedTickets)} change={formatChange(summary.unsolvedTicketsChangePct, { inverse: true })} detail="Open conversations" onClick={() => onDrilldown("unsolved_tickets", "Open backlog")} />
        <MetricCell label="Median first reply" definition="The median time from the first customer message to the first teammate reply." value={formatDuration(summary.medianFirstReplyMinutes)} change={formatChange(summary.medianFirstReplyChangePct, { inverse: true })} detail={summary.firstReplyDataQuality === "limited" ? "Limited response coverage" : "Customer wait time"} onClick={() => onDrilldown("slow_first_replies", "First reply time")} />
        <MetricCell label="Resolution rate" definition="Solved tickets divided by all support tickets created in the selected period." value={formatPercent(resolved)} detail={`${formatNumber(summary.solvedTickets)} of ${formatNumber(summary.supportTickets)} tickets`} onClick={() => onDrilldown("solved_tickets", "Solved tickets")} />
        <MetricCell label="Tickets per 100 orders" definition="Support tickets linked to an order, divided by Shopify orders, multiplied by 100." value={commerce.ticketsPer100Orders == null ? "Collecting" : commerce.ticketsPer100Orders.toFixed(1)} change={formatChange(commerce.ticketsPer100OrdersChangePct, { inverse: true })} detail={`${formatNumber(commerce.linkedSupportTickets)} linked tickets`} onClick={() => onDrilldown("support_tickets", "Sales-driven support")} />
        <MetricCell label="CSAT" definition="Average customer satisfaction score from submitted support feedback in this period." value={outcomes.csatAvailable ? `${outcomes.csatAverage} / 5` : "Collecting"} detail={outcomes.csatAvailable ? `${formatNumber(outcomes.csatResponses)} responses` : "Needs customer feedback"} />
      </MetricStrip>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.72fr)]">
        <AnalyticsChartCard title="Support demand vs. solved" description="Shows whether the team is closing work at the same pace it arrives." meta={`By ${data.supportTrend?.grouping || "day"}`}>
          {(data.supportTrend?.series || []).length ? <SupportFlowChart data={data.supportTrend.series} /> : <EmptyState title="No support trend yet" description="Created and solved tickets appear here once activity is recorded." />}
          {data.supportTrend?.solvedDataQuality === "proxy_included" ? <p className="mt-2 text-xs text-muted-foreground">Includes {formatNumber(data.supportTrend.solvedProxyCount)} historical resolution timestamps estimated from the latest ticket update.</p> : null}
        </AnalyticsChartCard>
        <FocusSignals signals={data.signals || []} onSelect={onDrilldown} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="rounded-xl shadow-sm">
          <CardHeader><CardTitle className="text-base">Customer friction</CardTitle><CardDescription>The reasons and products driving customer contact.</CardDescription></CardHeader>
          <CardContent><HorizontalBars items={friction.slice(0, 5)} onSelect={onDrilldown} emptyTitle="No friction patterns yet" emptyDescription="Tag tickets and connect products to identify recurring customer problems." /></CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm">
          <CardHeader><CardTitle className="text-base">Sona impact</CardTitle><CardDescription>Assistance and quality tied to real support work.</CardDescription></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {[
              ["Sent as-is", impact.draftQualityTotal ? formatNumber(impact.sentAsIs) : "Collecting"],
              ["Average edit effort", impact.averageEditEffort?.status === "available" ? formatPercent(impact.averageEditEffort.averageEditPct) : "Collecting"],
              ["Ready with light edits", impact.draftQualityTotal ? formatPercent(impact.noMinorEditRate) : "Collecting"],
              ["Workflow approval", impact.actionsSuggested ? formatPercent(impact.actionApprovalRate) : "Collecting"],
            ].map(([label, value]) => <div key={label} className="rounded-xl bg-muted/35 p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-xl font-semibold tabular-nums">{value}</p></div>)}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SupportReport({ data, onDrilldown }) {
  const kpis = data.supportKpis || {};
  const outcomes = data.customerOutcomes || {};
  const csatStars = outcomes.csatAvailable ? Math.round(outcomes.csatAverage || 0) : 0;
  return (
    <div className="analytics-report flex flex-col gap-5">
      <MetricStrip columns={8}>
        <MetricCell label="Created" definition="New support conversations created in this period." value={formatNumber(kpis.createdTickets)} detail="New tickets" onClick={() => onDrilldown("support_tickets", "Created tickets")} />
        <MetricCell label="Solved" definition="Tickets currently in a solved, resolved or closed state." value={formatNumber(kpis.solvedTickets)} detail="Closed workload" onClick={() => onDrilldown("solved_tickets", "Solved tickets")} />
        <MetricCell label="Backlog" definition="Created tickets that are not currently solved." value={formatNumber(kpis.unsolvedTickets)} detail="Still open" onClick={() => onDrilldown("unsolved_tickets", "Open backlog")} />
        <MetricCell label="Median first reply" definition="The median time from the first customer message to the first teammate reply." value={kpis.medianFirstReplyMinutes == null ? "Collecting" : formatDuration(kpis.medianFirstReplyMinutes)} detail="Customer wait time" onClick={() => onDrilldown("slow_first_replies", "First reply time")} />
        <MetricCell label="Median resolution" definition="The median time from ticket creation to its first recorded resolution. Historical tickets without lifecycle events use their latest update as a clearly marked estimate." value={kpis.medianResolutionMinutes == null ? "Collecting" : formatDuration(kpis.medianResolutionMinutes)} detail={kpis.resolutionTrackedTickets ? kpis.resolutionProxyCount ? `${formatNumber(kpis.resolutionTrackedTickets)} tickets · ${formatNumber(kpis.resolutionProxyCount)} estimated` : `${formatNumber(kpis.resolutionTrackedTickets)} measured tickets` : "Needs resolution events"} onClick={() => onDrilldown("slow_resolutions", "Resolution time")} />
        <MetricCell label="First contact resolution" definition={`Tickets resolved with exactly one teammate reply and not reopened within ${kpis.firstContactResolutionObservationDays || 7} days. Recent resolutions remain excluded until the observation window is complete.`} value={kpis.firstContactResolutionRate == null ? "Collecting" : formatPercent(kpis.firstContactResolutionRate)} change={kpis.solvedTickets ? { label: `${formatPercent(kpis.oneTouchRate)} one-touch`, tone: "neutral" } : null} detail={kpis.firstContactResolutionEligibleTickets ? `${formatNumber(kpis.firstContactResolutionTickets)} of ${formatNumber(kpis.firstContactResolutionEligibleTickets)} mature tickets` : "Needs 7-day lifecycle history"} onClick={() => onDrilldown("first_contact_resolution", "First contact resolution")} />
        <MetricCell label="Reopened" definition="Tickets that moved from a resolved state back into active work." value={outcomes.lifecycleTrackingAvailable ? formatNumber(outcomes.reopenedTickets) : "Collecting"} detail={outcomes.reopenedRate == null ? "Needs lifecycle events" : `${formatPercent(outcomes.reopenedRate)} of requests`} />
        <MetricCell label="Escalated" definition="Tickets with a recorded escalation lifecycle event." value={outcomes.lifecycleTrackingAvailable ? formatNumber(outcomes.escalatedTickets) : "Collecting"} detail={outcomes.escalationRate == null ? "Needs lifecycle events" : `${formatPercent(outcomes.escalationRate)} of requests`} />
      </MetricStrip>

      <AnalyticsChartCard title="Created vs. solved tickets" description="A widening gap indicates that backlog is building." meta={`By ${data.supportTrend?.grouping || "day"}`}>
        {(data.supportTrend?.series || []).length ? <SupportFlowChart data={data.supportTrend.series} /> : <EmptyState title="No support trend yet" description="Created and solved ticket activity will appear here." />}
      </AnalyticsChartCard>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="rounded-xl shadow-sm"><CardHeader><CardTitle className="text-base">First reply distribution</CardTitle><CardDescription>How long customers waited for the first teammate response.</CardDescription></CardHeader><CardContent><TimeDistribution rows={kpis.firstReplyBrackets || []} title="First reply" onSelect={onDrilldown} /></CardContent></Card>
        <Card className="rounded-xl shadow-sm"><CardHeader><CardTitle className="text-base">Resolution distribution</CardTitle><CardDescription>Time from ticket creation until the first recorded resolution.</CardDescription></CardHeader><CardContent><TimeDistribution rows={kpis.resolutionBrackets || []} title="Resolution" onSelect={onDrilldown} /></CardContent></Card>
      </div>

      <Card className="rounded-xl shadow-sm">
        <CardHeader><CardTitle className="text-base">Customer satisfaction</CardTitle><CardDescription>Direct feedback collected after support conversations.</CardDescription></CardHeader>
        <CardContent>
          {outcomes.csatAvailable ? (
            <div className="grid gap-5 sm:grid-cols-[220px_1fr] sm:items-center">
              <div><p className="text-4xl font-semibold tracking-tight tabular-nums">{outcomes.csatAverage} / 5</p><div className="mt-3 flex gap-1" aria-label={`${outcomes.csatAverage} out of 5 stars`}>{Array.from({ length: 5 }).map((_, index) => <Star key={index} className={cn("size-4", index < csatStars ? "fill-amber-400 text-amber-400" : "text-muted")} />)}</div><p className="mt-2 text-xs text-muted-foreground">{formatNumber(outcomes.csatResponses)} responses</p></div>
              <div className="rounded-lg bg-muted/35 p-4"><p className="text-xs text-muted-foreground">Positive CSAT</p><p className="mt-2 text-2xl font-semibold tabular-nums">{formatPercent(outcomes.csatPositiveRate)}</p><p className="mt-1 text-xs text-muted-foreground">Scores of 4 or 5</p></div>
            </div>
          ) : <EmptyState icon={Star} title="No CSAT responses yet" description="Customer satisfaction appears after feedback is submitted for support conversations." />}
        </CardContent>
      </Card>
    </div>
  );
}

function BusinessReport({ data, onDrilldown }) {
  const commerce = data.commerce || {};
  const topics = data.topics || {};
  const refundDetails = (commerce.refundTotals || []).map((row) => formatMoney(row.amount, row.currency)).join(" · ");
  return (
    <div className="analytics-report flex flex-col gap-5">
      <MetricStrip columns={4}>
        <MetricCell label="Orders" definition="Anonymous Shopify order facts recorded in the selected period." value={commerce.orderDataAvailable ? formatNumber(commerce.orderCount) : "Collecting"} detail="Shopify orders" />
        <MetricCell label="Tickets per 100 orders" definition="Order-linked support tickets divided by orders, multiplied by 100." value={commerce.ticketsPer100Orders == null ? "Collecting" : commerce.ticketsPer100Orders.toFixed(1)} change={formatChange(commerce.ticketsPer100OrdersChangePct, { inverse: true })} detail={`${formatNumber(commerce.linkedSupportTickets)} linked tickets`} onClick={() => onDrilldown("support_tickets", "Sales-driven support")} />
        <MetricCell label="Return case rate" definition="Recorded return cases divided by Shopify orders in this period." value={commerce.returnRate == null ? "Collecting" : formatPercent(commerce.returnRate)} change={formatChange(commerce.returnRateChangePct, { inverse: true })} detail={`${formatNumber(commerce.returnCases)} cases`} />
        <MetricCell label="Refunded value" definition="Observed Shopify refund value. Different currencies are never combined." value={formatMoneyTotals(commerce.refundTotals)} detail={refundDetails || "Needs Shopify refund events"} />
      </MetricStrip>

      <AnalyticsChartCard title="Support created by sales" description="Order-linked support demand normalized by order volume." meta={`By ${data.period?.grouping || "day"}`}>
        {(commerce.trendSeries || []).some((row) => row.ticketsPer100Orders != null) ? <CommerceRateChart data={commerce.trendSeries} /> : <EmptyState title="No order-linked trend yet" description="Connect tickets to Shopify orders to see support demand per 100 orders." />}
      </AnalyticsChartCard>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="rounded-xl shadow-sm"><CardHeader><CardTitle className="text-base">Contact reasons</CardTitle><CardDescription>What customers most often need help with.</CardDescription></CardHeader><CardContent><HorizontalBars items={(topics.requestTypes || []).slice(0, 8)} onSelect={onDrilldown} emptyTitle="No contact reasons yet" emptyDescription="Classify or tag tickets to identify recurring support demand." /></CardContent></Card>
        <Card className="rounded-xl shadow-sm"><CardHeader><CardTitle className="text-base">Return reasons</CardTitle><CardDescription>Operational reasons recorded on return cases.</CardDescription></CardHeader><CardContent><HorizontalBars items={commerce.returnReasons || []} emptyTitle="No return reasons yet" emptyDescription="Reasons appear when return cases are created." /></CardContent></Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="rounded-xl shadow-sm"><CardHeader><CardTitle className="text-base">Products driving support</CardTitle><CardDescription>Products associated with the highest ticket volume.</CardDescription></CardHeader><CardContent><HorizontalBars items={(topics.products || []).slice(0, 8)} onSelect={onDrilldown} emptyTitle="No product links yet" emptyDescription="Detected products appear after tickets are classified." /></CardContent></Card>
        <Card className="rounded-xl shadow-sm"><CardHeader><CardTitle className="text-base">Products with refunded value</CardTitle><CardDescription>Values remain separated by currency.</CardDescription></CardHeader><CardContent>{(commerce.refundProducts || []).length ? <div className="flex flex-col gap-1">{commerce.refundProducts.map((row) => <div key={`${row.productId}-${row.currency}`} className="flex items-center justify-between gap-4 rounded-lg px-3 py-3 odd:bg-muted/35"><div className="min-w-0"><p className="truncate text-sm font-medium">Product #{row.productId}</p><p className="mt-0.5 text-xs text-muted-foreground">{formatNumber(row.quantity)} units</p></div><p className="shrink-0 text-sm font-semibold tabular-nums">{row.currency ? formatMoney(row.amount, row.currency) : formatNumber(row.amount)}</p></div>)}</div> : <EmptyState icon={PackageSearch} title="No refunded products yet" description="Product-level value appears after Shopify refund line items are received." />}</CardContent></Card>
      </div>
    </div>
  );
}

function SonaReport({ data, onDrilldown }) {
  const impact = data.sonaImpact || {};
  const hasMeasuredDrafts = impact.draftQualityTotal > 0;
  const hasAverageEditEffort = impact.averageEditEffort?.status === "available";
  const candidates = impact.autopilotCandidates || {};
  const candidateGroups = [
    ["Ready to test", candidates.readyToTest || [], "default"],
    ["Needs more data", candidates.needsMoreData || [], "secondary"],
    ["Keep human review", candidates.keepHumanReview || [], "outline"],
  ];
  return (
    <div className="analytics-report flex flex-col gap-5">
      <MetricStrip columns={4}>
        <MetricCell label="Sent as-is" definition="Sona drafts sent to customers without any teammate edits." value={hasMeasuredDrafts ? formatNumber(impact.sentAsIs) : "Collecting"} detail={hasMeasuredDrafts ? `${formatPercent(impact.sentAsIsRate)} of measured outcomes` : "Needs sent draft outcomes"} onClick={() => onDrilldown("sent_as_is", "Drafts sent as-is")} />
        <MetricCell label="Average edit effort" definition="Average share of Sona's draft text changed by a teammate before sending." value={hasAverageEditEffort ? formatPercent(impact.averageEditEffort.averageEditPct) : "Collecting"} detail={hasAverageEditEffort ? `${formatNumber(impact.trackedSentDrafts)} sent drafts measured` : "Needs sent draft outcomes"} onClick={() => onDrilldown("highest_edit_pct", "Drafts by edit effort")} />
        <MetricCell label="Ready with light edits" definition="Sent drafts requiring no edit or only minor edits." value={hasMeasuredDrafts ? formatPercent(impact.noMinorEditRate) : "Collecting"} detail={`${formatNumber(impact.draftQualityTotal)} measured outcomes`} />
        <MetricCell label="Workflow approval" definition="Suggested actions approved or successfully applied by the team." value={impact.actionsSuggested ? formatPercent(impact.actionApprovalRate) : "Collecting"} detail={`${formatNumber(impact.actionsHandled)} of ${formatNumber(impact.actionsSuggested)} suggestions`} />
      </MetricStrip>

      <AnalyticsChartCard title="Assisted rate over time" description="The share of support conversations where Sona contributed a draft." meta={`By ${data.period?.grouping || "day"}`}>
        {(impact.trendSeries || []).some((row) => row.supportTickets > 0) ? <SonaRateChart data={impact.trendSeries} /> : <EmptyState icon={Sparkles} title="No assisted trend yet" description="Sona-assisted conversations will appear as drafts are generated." />}
      </AnalyticsChartCard>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
        <Card className="rounded-xl shadow-sm"><CardHeader><CardTitle className="text-base">Draft quality</CardTitle><CardDescription>How much teammate editing Sona drafts required before sending.</CardDescription></CardHeader><CardContent><QualityBreakdown breakdown={impact.draftQualityBreakdown || {}} /></CardContent></Card>
        <Card className="rounded-xl shadow-sm"><CardHeader><CardTitle className="text-base">Automation opportunities</CardTitle><CardDescription>Start with repeatable work where quality is measurable.</CardDescription></CardHeader><CardContent className="flex flex-col gap-4">{candidateGroups.map(([label, rows, variant]) => <section key={label}><div className="mb-2 flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p><Badge variant={variant}>{formatNumber(rows.length)}</Badge></div>{rows.length ? <div className="flex flex-col gap-1">{rows.slice(0, 4).map((candidate) => <button key={candidate.key} type="button" onClick={() => onDrilldown(candidate.key, candidate.label)} className="analytics-pressable group flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-muted/45"><div className="min-w-0"><p className="truncate text-sm font-medium">{candidate.label}</p><p className="mt-0.5 text-xs text-muted-foreground">{candidate.reason}</p></div><ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" /></button>)}</div> : <p className="text-xs text-muted-foreground">No workflows in this group.</p>}</section>)}</CardContent></Card>
      </div>
    </div>
  );
}

function TicketStatusBadge({ status }) {
  const normalized = String(status || "").toLowerCase();
  const variant = ["solved", "resolved", "closed"].includes(normalized) ? "secondary" : normalized === "open" || normalized === "new" ? "default" : "outline";
  return <Badge variant={variant} className="capitalize">{status || "Unknown"}</Badge>;
}

function TicketDrilldown({ data, metricKey, title, onBack }) {
  const tickets = useMemo(
    () => data.drilldowns?.byKey?.[metricKey] || data.drilldowns?.defaultTickets || [],
    [data.drilldowns, metricKey],
  );
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [requestType, setRequestType] = useState("all");
  const [product, setProduct] = useState("all");

  useEffect(() => {
    setQuery("");
    setStatus("all");
    setRequestType("all");
    setProduct("all");
  }, [metricKey]);

  const statuses = useMemo(() => [...new Set(tickets.map((ticket) => ticket.status).filter(Boolean))].sort(), [tickets]);
  const requestTypes = useMemo(() => [...new Set(tickets.map((ticket) => ticket.requestType).filter(Boolean))].sort(), [tickets]);
  const products = useMemo(() => [...new Set(tickets.map((ticket) => ticket.product).filter(Boolean))].sort(), [tickets]);
  const filtered = useMemo(() => tickets.filter((ticket) => {
    const search = query.trim().toLowerCase();
    if (search && ![ticket.ticketNumber, ticket.subject, ticket.customer, ticket.issueSummary].some((value) => String(value || "").toLowerCase().includes(search))) return false;
    if (status !== "all" && ticket.status !== status) return false;
    if (requestType !== "all" && ticket.requestType !== requestType) return false;
    if (product !== "all" && ticket.product !== product) return false;
    return true;
  }), [tickets, query, status, requestType, product]);
  const hasFilters = query || status !== "all" || requestType !== "all" || product !== "all";
  const clear = () => { setQuery(""); setStatus("all"); setRequestType("all"); setProduct("all"); };

  return (
    <div className="analytics-report flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Breadcrumb><BreadcrumbList><BreadcrumbItem><button type="button" onClick={onBack} className="transition-colors hover:text-foreground">Analytics</button></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>Tickets</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>
          <h2 className="mt-3 text-xl font-semibold tracking-tight">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{formatNumber(filtered.length)} of {formatNumber(tickets.length)} tickets</p>
        </div>
        <Button variant="ghost" onClick={onBack}><ArrowLeft data-icon="inline-start" />Back to report</Button>
      </div>

      <Card className="overflow-hidden rounded-xl shadow-sm">
        <CardHeader className="border-b bg-muted/20 py-4">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ticket, customer or subject" className="pl-9" /></div>
            {[
              ["Status", status, setStatus, statuses],
              ["Request type", requestType, setRequestType, requestTypes],
              ["Product", product, setProduct, products],
            ].map(([label, value, setter, values]) => (
              <Select key={label} value={value} onValueChange={setter}><SelectTrigger className="w-full lg:w-44"><SelectValue placeholder={label} /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all">All {label.toLowerCase()}s</SelectItem>{values.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectGroup></SelectContent></Select>
            ))}
            {hasFilters ? <Button variant="ghost" size="sm" onClick={clear}><X data-icon="inline-start" />Clear</Button> : null}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow className="bg-muted/20 hover:bg-muted/20"><TableHead>Ticket</TableHead><TableHead className="min-w-64">Subject</TableHead><TableHead>Customer</TableHead><TableHead>Status</TableHead><TableHead>Request type</TableHead><TableHead>Product</TableHead><TableHead>First reply</TableHead><TableHead>Resolution</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
                <TableBody>{filtered.map((ticket) => <TableRow key={ticket.id} className="group"><TableCell><a href={ticket.url || "#"} className="font-medium text-primary hover:underline">#{ticket.ticketNumber || ticket.id?.slice(0, 8)}</a></TableCell><TableCell><p className="max-w-80 truncate font-medium">{ticket.subject || "No subject"}</p><p className="mt-0.5 max-w-80 truncate text-xs text-muted-foreground">{ticket.issueSummary || "No issue summary"}</p></TableCell><TableCell className="max-w-56 truncate">{ticket.customer || "Unknown"}</TableCell><TableCell><TicketStatusBadge status={ticket.status} /></TableCell><TableCell>{ticket.requestType || "Uncategorized"}</TableCell><TableCell>{ticket.product || "—"}</TableCell><TableCell className="tabular-nums">{formatDuration(ticket.firstReplyMinutes)}</TableCell><TableCell className="tabular-nums">{formatDuration(ticket.resolutionMinutes)}</TableCell><TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(ticket.createdAt)}</TableCell></TableRow>)}</TableBody>
              </Table>
            </div>
          ) : <EmptyState icon={Inbox} title="No tickets match these filters" description="Clear one or more filters to see the underlying conversations." />}
        </CardContent>
      </Card>
    </div>
  );
}

function labelForMetric(data, metricKey) {
  const fixed = {
    all: "All support tickets",
    support_tickets: "Support tickets",
    unsolved_tickets: "Open backlog",
    solved_tickets: "Solved tickets",
    slow_first_replies: "Slow first replies",
    slow_resolutions: "Slow resolutions",
    first_contact_resolution: "First contact resolution",
    sona_assisted: "Sona-assisted tickets",
    refund_requests: "Refund requests",
  };
  if (fixed[metricKey]) return fixed[metricKey];
  const collections = [
    ...(data?.topics?.requestTypes || []),
    ...(data?.topics?.products || []),
    ...(data?.topics?.issueDescriptions || []),
    ...(data?.strengthsWeakSpots?.highVolumeSlowResponse || []),
    ...(data?.sonaImpact?.autopilotCandidates?.readyToTest || []),
    ...(data?.sonaImpact?.autopilotCandidates?.needsMoreData || []),
    ...(data?.sonaImpact?.autopilotCandidates?.keepHumanReview || []),
  ];
  return collections.find((item) => item.key === metricKey)?.label || collections.find((item) => item.key === metricKey)?.topic || "Tickets behind the metric";
}

function AnalyticsShell({ children, ...headerProps }) {
  return (
    <TooltipProvider delayDuration={350} skipDelayDuration={0}>
      <div className="@container/main flex min-h-full flex-1 flex-col bg-muted/25">
        <AnalyticsHeader {...headerProps} />
        <main className="mx-auto flex w-full max-w-[1500px] flex-1 flex-col gap-5 p-4 md:p-6 lg:p-7">{children}</main>
      </div>
    </TooltipProvider>
  );
}

export default function AnalyticsDashboardClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const reportParam = searchParams.get("report") || "overview";
  const report = REPORT_IDS.has(reportParam) ? reportParam : "overview";
  const period = searchParams.get("period") || "30";
  const range = { start: searchParams.get("start") || "", end: searchParams.get("end") || "" };
  const metricKey = searchParams.get("metric") || "all";
  const fromReport = REPORTS.some((item) => item.id === searchParams.get("from")) ? searchParams.get("from") : "overview";
  const visibleReport = report === "tickets" ? fromReport : report;
  const [data, setData] = useState(null);
  const dataRef = useRef(null);
  const [refreshing, setRefreshing] = useState(true);
  const [initialError, setInitialError] = useState(null);

  const navigate = useCallback((edit, method = "push") => {
    const next = new URLSearchParams(searchParams.toString());
    edit(next);
    const query = next.toString();
    router[method](`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (range.start && range.end) { params.set("start", range.start); params.set("end", range.end); }
    else params.set("period", period);
    setRefreshing(true);
    setInitialError(null);
    fetch(`/api/analytics/overview?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok || json.error) throw new Error(json.error || "Analytics could not be loaded.");
        return json;
      })
      .then((json) => { dataRef.current = json; setData(json); })
      .catch((error) => {
        if (error.name === "AbortError") return;
        if (dataRef.current) toast.error("Analytics could not be refreshed", { description: error.message });
        else setInitialError(error.message);
      })
      .finally(() => { if (!controller.signal.aborted) setRefreshing(false); });
    return () => controller.abort();
  }, [period, range.start, range.end]);

  const onPeriod = (value) => navigate((params) => { params.set("period", value); params.delete("start"); params.delete("end"); }, "replace");
  const onRange = (nextRange) => navigate((params) => {
    if (nextRange.start) params.set("start", nextRange.start); else params.delete("start");
    if (nextRange.end) params.set("end", nextRange.end); else params.delete("end");
    if (nextRange.start && nextRange.end) params.delete("period");
  }, "replace");
  const onReport = (nextReport) => navigate((params) => { params.set("report", nextReport); params.delete("metric"); params.delete("from"); });
  const onDrilldown = (key, title) => {
    if (!key) return;
    sessionStorage.setItem(`analytics-scroll-${visibleReport}`, String(window.scrollY));
    navigate((params) => { params.set("report", "tickets"); params.set("metric", key); params.set("from", visibleReport); if (title) params.set("label", title); });
  };
  const onBack = () => {
    const target = fromReport || "overview";
    navigate((params) => { params.set("report", target); params.delete("metric"); params.delete("from"); params.delete("label"); });
    requestAnimationFrame(() => window.scrollTo({ top: Number(sessionStorage.getItem(`analytics-scroll-${target}`) || 0), behavior: "smooth" }));
  };
  const onExport = async () => {
    if (!data) return;
    try { await exportAnalyticsToExcel(data, periodLabel(period, range)); }
    catch (error) { toast.error("Export failed", { description: error.message }); }
  };
  const title = searchParams.get("label") || labelForMetric(data, metricKey);

  return (
    <AnalyticsShell period={period} range={range} report={visibleReport} refreshing={refreshing && Boolean(data)} onPeriod={onPeriod} onRange={onRange} onReport={onReport} onExport={onExport} exportDisabled={!data || refreshing}>
      {initialError && !data ? <Card className="rounded-xl border-destructive/40"><CardContent className="flex items-center gap-3 p-5 text-sm text-destructive"><AlertTriangle className="size-4" />{initialError}</CardContent></Card> : null}
      {!data && refreshing ? <AnalyticsSkeleton /> : null}
      {data ? (
        <div className={cn("transition-opacity duration-150", refreshing && "opacity-70")} aria-busy={refreshing}>
          {report !== "overview" && report !== "tickets" ? <div className="mb-6"><ReportIntro report={report} /></div> : null}
          {report === "overview" ? <OverviewReport data={data} onDrilldown={onDrilldown} /> : null}
          {report === "support" ? <SupportReport data={data} onDrilldown={onDrilldown} /> : null}
          {report === "business" ? <BusinessReport data={data} onDrilldown={onDrilldown} /> : null}
          {report === "sona" ? <SonaReport data={data} onDrilldown={onDrilldown} /> : null}
          {report === "tickets" ? <TicketDrilldown data={data} metricKey={metricKey} title={title} onBack={onBack} /> : null}
        </div>
      ) : null}
      <style jsx global>{`
        .analytics-report { animation: analytics-fade 140ms cubic-bezier(0.23, 1, 0.32, 1) both; }
        .analytics-pressable { transition: transform 120ms cubic-bezier(0.23, 1, 0.32, 1), background-color 120ms ease, color 120ms ease; }
        .analytics-pressable:active { transform: scale(0.98); }
        .analytics-bar { transition: width 220ms cubic-bezier(0.23, 1, 0.32, 1); }
        @keyframes analytics-fade { from { opacity: 0.86; } to { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) {
          .analytics-report { animation: none; }
          .analytics-pressable, .analytics-bar { transition: opacity 120ms ease; }
          .analytics-pressable:active { transform: none; }
        }
      `}</style>
    </AnalyticsShell>
  );
}
