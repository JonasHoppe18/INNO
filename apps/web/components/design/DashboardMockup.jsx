"use client";

import { useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock,
  Mail,
  RadarIcon,
  Send,
  ShoppingBag,
  Sparkles,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Fictional data only. Three scenarios show how the page behaves when busy,
// when there is nothing to do, and when a connection is broken.
const SCENARIOS = {
  busy: {
    label: "Busy day",
    flow: { new: [3, "1 waiting over 24h"], drafts: [4, "Oldest 2h ago"], approvals: [2, "2 refunds"], customer: [5, "Oldest 3 days"] },
    upNext: [
      { id: "1042", subject: "Where is my order #1065?", customer: "Demo customer A", waited: "26h", state: "new" },
      { id: "1047", subject: "Lamp arrived with a cracked shade", customer: "Demo customer B", waited: "2h", state: "draft" },
      { id: "1049", subject: "Refund for returned throw", customer: "Demo customer C", waited: "1h", state: "approval" },
    ],
    alerts: [
      { kind: "product", icon: RadarIcon, title: "Demo Table Lamp: rising", detail: "19 tickets in the last 4 weeks (usually 8)", action: "View product" },
      { kind: "waiting", icon: Clock, title: "1 customer has waited over 24 hours", detail: "Where is my order #1065?", action: "Open ticket" },
    ],
    health: [],
  },
  calm: {
    label: "All caught up",
    flow: { new: [0, "Nothing new"], drafts: [0, "No drafts waiting"], approvals: [0, "Nothing to approve"], customer: [3, "Oldest 1 day"] },
    upNext: [],
    alerts: [],
    health: [],
  },
  broken: {
    label: "Something broken",
    flow: { new: [7, "3 waiting over 24h"], drafts: [0, "Paused, mailbox offline"], approvals: [1, "1 address change"], customer: [5, "Oldest 3 days"] },
    upNext: [
      { id: "1051", subject: "Can I change the delivery address?", customer: "Demo customer D", waited: "31h", state: "new" },
      { id: "1052", subject: "Is the side table back in stock?", customer: "Demo customer E", waited: "28h", state: "new" },
      { id: "1049", subject: "Refund for returned throw", customer: "Demo customer C", waited: "5h", state: "approval" },
    ],
    alerts: [
      { kind: "system", icon: Mail, title: "Mailbox disconnected", detail: "No new mail since 07:12. Replies can't be sent.", action: "Reconnect", severity: "danger" },
      { kind: "waiting", icon: Clock, title: "3 customers have waited over 24 hours", detail: "Oldest: Can I change the delivery address?", action: "Open queue" },
    ],
    health: ["mailbox"],
  },
};

const FLOW_STEPS = [
  { key: "new", label: "New", hint: "Needs a first look", bar: "bg-info-foreground" },
  { key: "drafts", label: "Replies ready", hint: "Sona drafted, waiting for review", bar: "bg-primary" },
  { key: "approvals", label: "Awaiting approval", hint: "Refunds, address changes", bar: "bg-warning-foreground" },
  { key: "customer", label: "Waiting on customer", hint: "Nothing to do yet", bar: "bg-muted-foreground/40" },
];

const STATE_BADGE = {
  new: { variant: "info", label: "New", action: "Open" },
  draft: { variant: "ai", label: "Reply ready", action: "Review reply" },
  approval: { variant: "warning", label: "Awaiting approval", action: "Review action" },
};

const HEALTH_CHECKS = [
  { key: "mailbox", icon: Mail, label: "Mailbox", ok: "Receiving mail", broken: "Disconnected at 07:12" },
  { key: "store", icon: ShoppingBag, label: "Connected store", ok: "Orders syncing", broken: "Not syncing" },
  { key: "sending", icon: Send, label: "Sending", ok: "All replies delivered", broken: "Failing" },
  { key: "drafting", icon: Sparkles, label: "Sona", ok: "Drafting replies", broken: "Paused" },
];

const WEEK = [
  { label: "Resolved", value: "38", change: "+12%", good: true, detail: "vs last week", series: [24, 29, 27, 31, 30, 34, 34, 38] },
  { label: "First human reply", value: "1h 40m", change: "−18%", good: true, lowerIsBetter: true, detail: "Median, confirmations excluded", series: [190, 175, 160, 168, 140, 132, 122, 100] },
  { label: "CSAT", value: "4.6", change: "+0.2", good: true, detail: "12 responses", series: [4.2, 4.4, 4.3, 4.4, 4.5, 4.3, 4.4, 4.6] },
  { label: "Sona drafted", value: "82%", change: "+5 pts", good: true, detail: "61% sent without edits", series: [58, 63, 66, 70, 72, 75, 77, 82] },
];

function FlowStrip({ flow }) {
  const total = FLOW_STEPS.reduce((sum, step) => sum + flow[step.key][0], 0);
  return (
    <Card className="overflow-hidden rounded-xl shadow-sm">
      <div className="flex flex-col gap-3 px-5 pb-4 pt-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-medium">Open tickets</p>
          <p className="text-xs text-muted-foreground"><span className="font-semibold tabular-nums text-foreground">{total}</span> in progress</p>
        </div>
        <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          {FLOW_STEPS.map((step) => {
            const count = flow[step.key][0];
            return count ? <span key={step.key} className={cn("h-full transition-[flex-grow] duration-300", step.bar)} style={{ flexGrow: count }} /> : null;
          })}
        </div>
      </div>
      <div className="grid border-t border-border/70 sm:grid-cols-2 xl:grid-cols-4">
        {FLOW_STEPS.map((step, index) => {
          const [count, detail] = flow[step.key];
          const idle = count === 0;
          return (
            <button
              key={step.key}
              type="button"
              className={cn(
                "group flex flex-col gap-1 border-border/70 px-5 py-4 text-left transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                index > 0 && "sm:border-l",
                index > 1 && "border-t xl:border-t-0",
              )}
            >
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className={cn("size-2 rounded-full", idle ? "bg-muted-foreground/25" : step.bar)} aria-hidden="true" />
                {step.label}
                <ChevronRight className="ml-auto size-3.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100" aria-hidden="true" />
              </span>
              <span className={cn("mt-1 text-2xl font-semibold tracking-tight tabular-nums", idle && "text-muted-foreground/50")}>{count}</span>
              <span className="text-xs text-muted-foreground">{detail}</span>
              <span className="sr-only">{step.hint}</span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function UpNext({ items }) {
  return (
    <Card className="rounded-xl shadow-sm">
      <CardHeader className="flex-row items-center justify-between gap-3 pb-3">
        <div>
          <CardTitle className="text-section-heading">Up next</CardTitle>
          <CardDescription className="mt-1">The tickets that need you first.</CardDescription>
        </div>
        <Button variant="ghost" size="sm">Open inbox<ChevronRight data-icon="inline-end" /></Button>
      </CardHeader>
      <CardContent>
        {items.length ? (
          <ol className="flex flex-col divide-y divide-border/70">
            {items.map((item) => {
              const state = STATE_BADGE[item.state];
              return (
                <li key={item.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.subject}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">#{item.id} · {item.customer} · waited {item.waited}</p>
                  </div>
                  <Badge variant={state.variant} className="hidden shrink-0 sm:inline-flex">{state.label}</Badge>
                  <Button variant="outline" size="sm" className="shrink-0">{state.action}</Button>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="flex items-center gap-3 rounded-lg bg-success/60 px-4 py-4">
            <CheckCircle2 className="size-5 shrink-0 text-success-foreground" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium">You&apos;re all caught up</p>
              <p className="text-xs text-muted-foreground">New tickets and Sona&apos;s replies will show up here.</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function NeedsAction({ alerts }) {
  if (!alerts.length) return null;
  return (
    <Card className="rounded-xl shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-section-heading">Needs action</CardTitle>
        <CardDescription className="mt-1">Products getting more tickets than usual.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {alerts.map((alert) => {
          const Icon = alert.icon;
          const danger = alert.severity === "danger";
          return (
            <div key={alert.title} className={cn("flex items-center gap-3 rounded-lg border px-4 py-3", danger ? "border-danger-border bg-danger" : "border-border/70")}>
              <Icon className={cn("size-4 shrink-0", danger ? "text-danger-foreground" : "text-warning-foreground")} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm font-medium", danger && "text-danger-foreground")}>{alert.title}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{alert.detail}</p>
              </div>
              <Button variant={danger ? "default" : "ghost"} size="sm" className="shrink-0">{alert.action}</Button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// Healthy: one quiet line. Broken: the card itself becomes the alert, so the
// failure is not repeated under Needs action.
function SystemStatus({ broken }) {
  const healthy = broken.length === 0;
  const isBroken = (key) => broken.includes(key) || (!healthy && (key === "sending" || key === "drafting"));

  if (healthy) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border/70 bg-card px-4 py-2.5 shadow-sm">
        <span className="flex items-center gap-2 text-sm font-medium">
          <CheckCircle2 className="size-4 text-success-foreground" aria-hidden="true" />
          Everything is running
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {HEALTH_CHECKS.map((check) => (
            <span key={check.key} className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-success-foreground" aria-hidden="true" />
              {check.label}
            </span>
          ))}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">Checked 2 minutes ago</span>
      </div>
    );
  }

  return (
    <Card role="alert" className="rounded-xl border-danger-border shadow-sm">
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex items-center gap-3">
          <CircleAlert className="size-5 shrink-0 text-danger-foreground" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-danger-foreground">Mailbox disconnected</p>
            <p className="text-xs text-muted-foreground">No new mail since 07:12, and replies can&apos;t be sent until it&apos;s reconnected.</p>
          </div>
          <Button size="sm" className="shrink-0">Reconnect</Button>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {HEALTH_CHECKS.map((check) => {
            const Icon = check.icon;
            const down = isBroken(check.key);
            return (
              <li key={check.key} className={cn("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm", down ? "bg-danger" : "bg-muted/40")}>
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="flex-1">{check.label}</span>
                <span className={cn("text-xs", down ? "text-danger-foreground" : "text-muted-foreground")}>{down ? check.broken : check.ok}</span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

// For metrics where lower is better the line is flipped, so improvement
// always points up.
function Sparkline({ series, id, invert = false }) {
  const width = 160;
  const height = 36;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  const points = series.map((value, index) => {
    const share = (value - min) / range;
    return [(index / (series.length - 1)) * width, height - 3 - (invert ? 1 - share : share) * (height - 6)];
  });
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-9 w-full text-primary" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.16" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${line} ${width},${height}`} fill={`url(#${id})`} />
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function ThisWeek() {
  return (
    <section aria-labelledby="this-week" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 id="this-week" className="text-section-heading font-semibold">This week</h2>
        <Button variant="ghost" size="sm">Analytics<ChevronRight data-icon="inline-end" /></Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {WEEK.map((metric, index) => {
          const Arrow = metric.change.startsWith("−") ? ArrowDownRight : ArrowUpRight;
          return (
            <Card key={metric.label} className="flex flex-col gap-1 overflow-hidden rounded-xl p-4 pb-0 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">{metric.label}</p>
                <span className={cn("flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums", metric.good ? "bg-success text-success-foreground" : "bg-danger text-danger-foreground")}>
                  <Arrow className="size-3" aria-hidden="true" />{metric.change}
                </span>
              </div>
              <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{metric.value}</p>
              <p className="text-xs text-muted-foreground">{metric.detail}</p>
              <div className="-mx-4 mt-2"><Sparkline series={metric.series} invert={metric.lowerIsBetter} id={`week-spark-${index}`} /></div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

// Variant B: one fact in one place. System status lives in the header and
// only turns into a banner when something is broken; waiting-time alerts are
// already covered by the flow and Up next, so only product alerts get a banner.
function StatusPill({ broken }) {
  const healthy = broken.length === 0;
  return (
    <span className={cn("flex items-center gap-1.5 text-xs", healthy ? "text-muted-foreground" : "font-medium text-danger-foreground")}>
      <span className={cn("size-1.5 rounded-full", healthy ? "bg-success-foreground" : "bg-danger-foreground")} aria-hidden="true" />
      {healthy ? "All systems running" : "Mailbox disconnected"}
    </span>
  );
}

function Banner({ alert }) {
  const Icon = alert.icon;
  const danger = alert.kind === "system";
  return (
    <div role={danger ? "alert" : undefined} className={cn("flex items-center gap-3 rounded-xl border px-4 py-3", danger ? "border-danger-border bg-danger" : "border-border/70 bg-card")}>
      <Icon className={cn("size-4 shrink-0", danger ? "text-danger-foreground" : "text-warning-foreground")} aria-hidden="true" />
      <p className="min-w-0 flex-1 text-sm">
        <span className={cn("font-medium", danger && "text-danger-foreground")}>{alert.title}</span>
        <span className="text-muted-foreground"> · {alert.detail}</span>
      </p>
      <Button variant={danger ? "default" : "ghost"} size="sm" className="shrink-0">{alert.action}</Button>
    </div>
  );
}

function VariantA({ scenario }) {
  // Only product alerts: waiting time is in the flow and Up next, system
  // failures are in the status card.
  const productAlerts = scenario.alerts.filter((alert) => alert.kind === "product");
  return (
    <>
      <header className="flex items-end justify-between gap-4">
        <h1 className="text-page-heading font-semibold tracking-tight">Dashboard</h1>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="size-1.5 rounded-full bg-success-foreground" aria-hidden="true" />
          Live
        </span>
      </header>
      <SystemStatus broken={scenario.health} />
      <FlowStrip flow={scenario.flow} />
      <NeedsAction alerts={productAlerts} />
      <UpNext items={scenario.upNext} />
      <ThisWeek />
    </>
  );
}

function VariantB({ scenario }) {
  const banners = scenario.alerts
    .filter((alert) => alert.kind === "system" || alert.kind === "product")
    .sort((a, b) => (a.kind === "system" ? -1 : 0) - (b.kind === "system" ? -1 : 0));
  return (
    <>
      <header className="flex items-end justify-between gap-4">
        <h1 className="text-page-heading font-semibold tracking-tight">Dashboard</h1>
        <StatusPill broken={scenario.health} />
      </header>
      {banners.length ? <div className="flex flex-col gap-2">{banners.map((alert) => <Banner key={alert.title} alert={alert} />)}</div> : null}
      <FlowStrip flow={scenario.flow} />
      <UpNext items={scenario.upNext} />
      <ThisWeek />
    </>
  );
}

const VARIANTS = { a: "A · Original", b: "B · Calm" };

export function DashboardMockup() {
  const [scenarioKey, setScenarioKey] = useState("busy");
  const [variant, setVariant] = useState("a");
  const scenario = SCENARIOS[scenarioKey];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-dashed px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Variant</span>
          {Object.entries(VARIANTS).map(([key, label]) => (
            <Button key={key} size="sm" variant={key === variant ? "default" : "outline"} onClick={() => setVariant(key)}>{label}</Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Scenario</span>
          {Object.entries(SCENARIOS).map(([key, value]) => (
            <Button key={key} size="sm" variant={key === scenarioKey ? "default" : "outline"} onClick={() => setScenarioKey(key)}>{value.label}</Button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-6 rounded-xl bg-muted/30 p-4 sm:p-6">
        {variant === "a" ? <VariantA scenario={scenario} /> : <VariantB scenario={scenario} />}
      </div>
    </div>
  );
}
