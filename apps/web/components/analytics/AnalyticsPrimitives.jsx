"use client";

import { ChevronRight, CircleHelp, ListFilter } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function MetricLabel({ label, definition }) {
  return (
    <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      {definition ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="rounded-sm text-muted-foreground/55 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <CircleHelp className="size-3.5" />
              <span className="sr-only">How {label} is calculated</span>
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-72 leading-5" sideOffset={6}>{definition}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}

const changeTone = {
  good: "text-emerald-700",
  watch: "text-amber-700",
  bad: "text-rose-700",
  neutral: "text-muted-foreground",
  muted: "text-muted-foreground",
};

export function MetricCell({ label, definition, value, detail, change, onClick }) {
  const Component = onClick ? "button" : "div";
  return (
    <Component
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "min-h-28 bg-card p-4 text-left transition-colors",
        onClick && "analytics-pressable hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
      )}
    >
      <MetricLabel label={label} definition={definition} />
      <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      <div className="mt-2 flex min-h-8 flex-col gap-0.5 text-xs">
        {change?.label ? <span className={cn("font-medium", changeTone[change.tone] || changeTone.muted)}>{change.label}</span> : null}
        {detail ? <span className="text-muted-foreground">{detail}</span> : null}
      </div>
    </Component>
  );
}

export function MetricStrip({ children, columns = 4, className }) {
  const gridColumns = {
    4: "sm:grid-cols-2 xl:grid-cols-4",
    5: "sm:grid-cols-2 sm:[&>*:last-child:nth-child(odd)]:col-span-2 lg:grid-cols-5 lg:[&>*:last-child:nth-child(odd)]:col-span-1",
    6: "sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6",
    8: "sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8",
  };
  return (
    <Card className={cn("overflow-hidden rounded-xl border-border/60 bg-border/60 shadow-sm", className)}>
      <CardContent className={cn("grid gap-px p-0", gridColumns[columns] || gridColumns[4])}>
        {children}
      </CardContent>
    </Card>
  );
}

export function AnalyticsChartCard({ title, description, meta, children, className }) {
  return (
    <Card className={cn("rounded-xl shadow-sm", className)}>
      <CardHeader className="flex-row items-start justify-between gap-4 pb-2">
        <div className="flex flex-col gap-1">
          <CardTitle className="text-base">{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {meta ? <Badge variant="secondary" className="shrink-0 font-normal">{meta}</Badge> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function FocusSignals({ signals = [], onSelect }) {
  const variants = { attention: "destructive", watch: "secondary", opportunity: "default", info: "outline" };
  const labels = { attention: "Attention", watch: "Watch", opportunity: "Opportunity", info: "Info" };
  return (
    <Card className="rounded-xl border-primary/10 bg-primary/[0.035] shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Needs attention</CardTitle>
        <CardDescription>Changes and opportunities worth reviewing first.</CardDescription>
      </CardHeader>
      <CardContent>
        {signals.length ? (
          <div className="flex flex-col gap-1">
            {signals.map((signal) => (
              <button
                key={`${signal.type}-${signal.metricKey}`}
                type="button"
                onClick={() => onSelect?.(signal.drilldownKey, signal.title)}
                className="analytics-pressable group flex items-start gap-3 rounded-xl bg-background/75 px-3 py-3 text-left shadow-sm hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Badge variant={variants[signal.severity] || "outline"} className="mt-0.5 shrink-0">{labels[signal.severity] || "Signal"}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{signal.title}</p>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{signal.detail}</p>
                </div>
                <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </button>
            ))}
          </div>
        ) : (
          <div className="flex min-h-52 flex-col items-center justify-center gap-2 text-center">
            <ListFilter className="size-5 text-muted-foreground/40" />
            <p className="text-sm font-medium">No issues detected</p>
            <p className="max-w-xs text-xs leading-5 text-muted-foreground">More history and tagged tickets will improve the signal quality.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AnalyticsSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-label="Loading analytics" aria-busy="true">
      <Card className="overflow-hidden rounded-xl border-border/60 bg-border/60 shadow-sm">
        <CardContent className="grid gap-px p-0 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="min-h-28 bg-card p-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-4 h-8 w-20" />
              <Skeleton className="mt-3 h-3 w-28" />
            </div>
          ))}
        </CardContent>
      </Card>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.72fr)]">
        <Card className="rounded-xl p-5 shadow-sm"><Skeleton className="h-4 w-40" /><Skeleton className="mt-5 h-[250px] w-full rounded-lg" /></Card>
        <Card className="rounded-xl p-5 shadow-sm"><Skeleton className="h-4 w-32" /><div className="mt-5 flex flex-col gap-3">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-14 w-full rounded-lg" />)}</div></Card>
      </div>
      <div className="grid gap-5 xl:grid-cols-2"><Skeleton className="h-72 rounded-xl" /><Skeleton className="h-72 rounded-xl" /></div>
    </div>
  );
}
