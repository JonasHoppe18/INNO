"use client";

import { useState } from "react";
import {
  AlertTriangle,
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
      { icon: RadarIcon, title: "Demo Table Lamp: rising", detail: "19 tickets in the last 4 weeks (usually 8)", action: "View product" },
      { icon: Clock, title: "1 customer has waited over 24 hours", detail: "Where is my order #1065?", action: "Open ticket" },
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
      { icon: Mail, title: "Mailbox disconnected", detail: "No new mail since 07:12. Replies can't be sent.", action: "Reconnect", severity: "danger" },
      { icon: Clock, title: "3 customers have waited over 24 hours", detail: "Oldest: Can I change the delivery address?", action: "Open queue" },
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
  { label: "Resolved", value: "38", change: "+12%", good: true, detail: "vs last week" },
  { label: "First human reply", value: "1h 40m", change: "−18%", good: true, detail: "Median, confirmations excluded" },
  { label: "CSAT", value: "4.6", change: "+0.2", good: true, detail: "12 responses" },
  { label: "Sona drafted", value: "82%", change: "+5 pts", good: true, detail: "61% sent without edits" },
];

function FlowStrip({ flow }) {
  return (
    <Card className="overflow-hidden rounded-xl shadow-sm">
      <CardContent className="grid p-0 sm:grid-cols-2 xl:grid-cols-4">
        {FLOW_STEPS.map((step, index) => {
          const [count, detail] = flow[step.key];
          const idle = count === 0;
          return (
            <button
              key={step.key}
              type="button"
              className={cn(
                "group relative flex flex-col gap-1 border-border/70 p-5 text-left transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                index > 0 && "sm:border-l",
                index > 1 && "border-t xl:border-t-0",
              )}
            >
              <span className={cn("absolute inset-x-0 top-0 h-1", idle ? "bg-muted" : step.bar)} aria-hidden="true" />
              <span className="flex items-center justify-between text-sm font-medium">
                {step.label}
                <ChevronRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
              </span>
              <span className={cn("mt-2 text-3xl font-semibold tracking-tight tabular-nums", idle && "text-muted-foreground/60")}>{count}</span>
              <span className="text-xs text-muted-foreground">{detail}</span>
              <span className="sr-only">{step.hint}</span>
            </button>
          );
        })}
      </CardContent>
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
        <CardDescription className="mt-1">Things that are out of the ordinary.</CardDescription>
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

function SystemStatus({ broken }) {
  const healthy = broken.length === 0;
  return (
    <Card className="self-start rounded-xl shadow-sm">
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex items-center gap-3">
          {healthy
            ? <CheckCircle2 className="size-8 text-success-foreground" aria-hidden="true" />
            : <CircleAlert className="size-8 text-danger-foreground" aria-hidden="true" />}
          <div>
            <p className="text-sm font-semibold">{healthy ? "Everything is running" : "Something needs fixing"}</p>
            <p className="text-xs text-muted-foreground">Checked 2 minutes ago</p>
          </div>
        </div>
        <ul className="flex flex-col gap-2.5">
          {HEALTH_CHECKS.map((check) => {
            const isBroken = broken.includes(check.key) || (!healthy && (check.key === "sending" || check.key === "drafting"));
            const Icon = check.icon;
            return (
              <li key={check.key} className="flex items-center gap-2.5 text-sm">
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="flex-1">{check.label}</span>
                <span className={cn("flex items-center gap-1.5 text-xs", isBroken ? "text-danger-foreground" : "text-muted-foreground")}>
                  <span className={cn("size-1.5 rounded-full", isBroken ? "bg-danger-foreground" : "bg-success-foreground")} aria-hidden="true" />
                  {isBroken ? check.broken : check.ok}
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function ThisWeek() {
  return (
    <section aria-labelledby="this-week" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 id="this-week" className="text-section-heading font-semibold">This week</h2>
        <Button variant="ghost" size="sm">Analytics<ChevronRight data-icon="inline-end" /></Button>
      </div>
      <Card className="overflow-hidden rounded-xl border-border/60 bg-border/60 shadow-sm">
        <CardContent className="grid gap-px p-0 sm:grid-cols-2 xl:grid-cols-4">
          {WEEK.map((metric) => {
            const Arrow = metric.change.startsWith("−") ? ArrowDownRight : ArrowUpRight;
            return (
              <div key={metric.label} className="bg-card p-4">
                <p className="text-xs text-muted-foreground">{metric.label}</p>
                <div className="mt-2 flex items-baseline gap-2">
                  <p className="text-2xl font-semibold tracking-tight tabular-nums">{metric.value}</p>
                  <span className={cn("flex items-center text-xs font-medium", metric.good ? "text-success-foreground" : "text-danger-foreground")}>
                    <Arrow className="size-3.5" aria-hidden="true" />{metric.change}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{metric.detail}</p>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </section>
  );
}

export function DashboardMockup() {
  const [scenarioKey, setScenarioKey] = useState("busy");
  const scenario = SCENARIOS[scenarioKey];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-3 py-2">
        <span className="text-xs text-muted-foreground">Preview scenario</span>
        {Object.entries(SCENARIOS).map(([key, value]) => (
          <Button key={key} size="sm" variant={key === scenarioKey ? "default" : "outline"} onClick={() => setScenarioKey(key)}>{value.label}</Button>
        ))}
      </div>

      <div className="flex flex-col gap-6 rounded-xl bg-muted/30 p-4 sm:p-6">
        <header className="flex items-end justify-between gap-4">
          <h1 className="text-page-heading font-semibold tracking-tight">Dashboard</h1>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-1.5 rounded-full bg-success-foreground" aria-hidden="true" />
            Live
          </span>
        </header>

        <FlowStrip flow={scenario.flow} />

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex flex-col gap-5">
            <NeedsAction alerts={scenario.alerts} />
            <UpNext items={scenario.upNext} />
          </div>
          <SystemStatus broken={scenario.health} />
        </div>

        <ThisWeek />
      </div>
      {scenario.alerts.length === 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><AlertTriangle className="size-3.5" aria-hidden="true" />&quot;Needs action&quot; is hidden because nothing is out of the ordinary.</p>
      ) : null}
    </div>
  );
}
