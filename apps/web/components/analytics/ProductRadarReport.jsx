"use client";
import { formatDate } from "@/lib/format/datetime";

import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";
import { AlertTriangle, ArrowLeft, ChevronRight, PackageSearch } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { toast } from "sonner";

import { useScopedReadResource } from "@/hooks/useScopedReadResource";
import { AnalyticsChartCard, AnalyticsSkeleton, MetricCell, MetricStrip } from "@/components/analytics/AnalyticsPrimitives";
import { RADAR_STATUS_BADGE, RADAR_STATUS_LABEL, describeRadarSignal, usualLabel } from "@/lib/product-radar-copy";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function formatNumber(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return new Intl.NumberFormat("en-US").format(Number(value));
}

function StatusBadge({ status }) {
  return <Badge variant={RADAR_STATUS_BADGE[status] || "neutral"}>{RADAR_STATUS_LABEL[status] || "Steady"}</Badge>;
}

function EmptyState({ title, description }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg bg-muted/30 p-6 text-center">
      <PackageSearch className="size-5 text-muted-foreground/45" />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-sm text-xs leading-5 text-muted-foreground">{description}</p>
    </div>
  );
}

function Sparkline({ weekly = [], className }) {
  const width = 96;
  const height = 24;
  const max = Math.max(...weekly.map((week) => week.count), 1);
  const step = weekly.length > 1 ? width / (weekly.length - 1) : width;
  const points = weekly.map((week, index) => `${(index * step).toFixed(1)},${(height - 2 - (week.count / max) * (height - 4)).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={className} aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function WeeklyChart({ weekly }) {
  const reduceMotion = useReducedMotion();
  const config = { count: { label: "Tickets", color: "hsl(var(--primary))" } };
  const axisProps = { tickLine: false, axisLine: false, tickMargin: 10, tick: { fontSize: 11, fill: "hsl(var(--muted-foreground))" } };
  return (
    <ChartContainer config={config} className="h-[250px] w-full">
      <BarChart data={weekly} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.35} />
        <XAxis dataKey="weekStart" {...axisProps} tickFormatter={(value) => formatDate(value) || value} interval="preserveStartEnd" />
        <YAxis {...axisProps} allowDecimals={false} width={28} />
        <ChartTooltip cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }} content={<ChartTooltipContent labelFormatter={(label) => `Week from ${formatDate(label) || label}`} />} />
        <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} isAnimationActive={!reduceMotion} animationDuration={240} />
      </BarChart>
    </ChartContainer>
  );
}

function coverageLine(coverage) {
  if (!coverage?.supportTickets) return "No support tickets in the last 12 weeks.";
  return `${formatNumber(coverage.supportTickets)} support tickets in the last 12 weeks · ${coverage.pct}% linked to a product.`;
}

function AlertCards({ alerts, onSelect }) {
  if (!alerts.length) return null;
  return (
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Product alerts">
      {alerts.map((row) => (
        <button key={row.productId} type="button" onClick={() => onSelect(row.productId)} className="analytics-pressable flex items-start justify-between gap-3 rounded-xl border bg-card p-4 text-left shadow-sm hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0 text-warning-foreground" aria-hidden="true" />
              <p className="truncate text-sm font-medium">{row.name}</p>
              <StatusBadge status={row.status} />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">{describeRadarSignal(row)}</p>
          </div>
          <Sparkline weekly={row.weekly} className="mt-0.5 shrink-0 text-primary" />
        </button>
      ))}
    </section>
  );
}

function ProductTable({ products, onSelect }) {
  return (
    <Card className="overflow-hidden rounded-xl shadow-sm">
      <CardHeader><CardTitle className="text-section-heading">All products</CardTitle><CardDescription>Support tickets per product, in rolling 7-day weeks.</CardDescription></CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow className="bg-muted/20 hover:bg-muted/20"><TableHead className="min-w-48">Product</TableHead><TableHead className="text-right">Last 7 days</TableHead><TableHead className="text-right">Usual week</TableHead><TableHead className="text-right">12 weeks</TableHead><TableHead>Trend</TableHead><TableHead>Status</TableHead><TableHead className="w-8"><span className="sr-only">Open</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {products.map((row) => (
                <TableRow key={row.productId} className="cursor-pointer" onClick={() => onSelect(row.productId)}>
                  <TableCell><button type="button" onClick={(event) => { event.stopPropagation(); onSelect(row.productId); }} className="max-w-72 truncate text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">{row.name}</button></TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(row.current)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{formatNumber(Math.round(row.baseline))}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{formatNumber(row.total)}</TableCell>
                  <TableCell><Sparkline weekly={row.weekly} className="text-primary/80" /></TableCell>
                  <TableCell><StatusBadge status={row.status} /></TableCell>
                  <TableCell><ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function ProductDetail({ product, tickets, onBack }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Breadcrumb><BreadcrumbList><BreadcrumbItem><button type="button" onClick={onBack} className="transition-colors hover:text-foreground">Products</button></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>{product.name}</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>
          <div className="mt-3 flex items-center gap-2"><h2 className="text-section-heading font-semibold tracking-tight">{product.name}</h2><StatusBadge status={product.status} /></div>
          <p className="mt-1 text-sm text-muted-foreground">{describeRadarSignal(product)}</p>
        </div>
        <Button variant="ghost" onClick={onBack}><ArrowLeft data-icon="inline-start" />All products</Button>
      </div>

      <MetricStrip columns={4}>
        <MetricCell label="Last 7 days" definition="Support tickets linked to this product in the last 7 days." value={formatNumber(product.current)} detail={usualLabel(product.baseline)} />
        <MetricCell label="Usual week" definition="Average weekly tickets over the 8 weeks before the last 7 days." value={formatNumber(Math.round(product.baseline))} detail="8-week average" />
        <MetricCell label="Last 4 weeks" definition="Support tickets linked to this product in the last 28 days." value={formatNumber(product.recentTotal)} detail={usualLabel(product.priorMean * 4)} />
        <MetricCell label="Last 12 weeks" definition="Support tickets linked to this product in the last 84 days." value={formatNumber(product.total)} detail="Shown in the chart" />
      </MetricStrip>

      <AnalyticsChartCard title="Tickets per week" description="Rolling 7-day weeks, newest on the right." meta="12 weeks">
        <WeeklyChart weekly={product.weekly} />
      </AnalyticsChartCard>

      <Card className="overflow-hidden rounded-xl shadow-sm">
        <CardHeader><CardTitle className="text-section-heading">What customers write</CardTitle><CardDescription>{tickets.length ? `The ${formatNumber(tickets.length)} most recent tickets about ${product.name}.` : `Tickets about ${product.name}.`}</CardDescription></CardHeader>
        <CardContent className="p-0">
          {tickets.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow className="bg-muted/20 hover:bg-muted/20"><TableHead>Ticket</TableHead><TableHead className="min-w-80">Issue</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
                <TableBody>
                  {tickets.map((ticket) => (
                    <TableRow key={ticket.id}>
                      <TableCell><a href={ticket.url} className="font-medium text-primary hover:underline">#{ticket.ticketNumber || ticket.id.slice(0, 8)}</a></TableCell>
                      <TableCell><p className="max-w-xl">{ticket.issueSummary || ticket.subject || "No summary"}</p></TableCell>
                      <TableCell className="capitalize text-muted-foreground">{ticket.status || "Unknown"}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(ticket.createdAt) || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : <div className="p-6"><EmptyState title="No tickets in the last 12 weeks" description="Tickets linked to this product will appear here." /></div>}
        </CardContent>
      </Card>
    </div>
  );
}

export default function ProductRadarReport({ productId, onSelectProduct, onBack }) {
  const { scopeKey, ready, getCached, readJson } = useScopedReadResource();
  const url = productId ? `/api/analytics/products?product=${encodeURIComponent(productId)}` : "/api/analytics/products";
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const data = state?.scopeKey === scopeKey && state?.url === url ? state.payload : null;

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const cached = getCached(url);
    setState(cached ? { scopeKey, url, payload: cached } : null);
    setError(null);
    readJson(url)
      .then((json) => {
        if (cancelled) return;
        if (json.error) throw new Error(json.error);
        setState({ scopeKey, url, payload: json });
      })
      .catch((err) => {
        if (cancelled || err.name === "AbortError") return;
        if (cached) toast.error("Products could not be refreshed", { description: err.message });
        else setError(err.message);
      });
    return () => { cancelled = true; };
  }, [url, ready, scopeKey, getCached, readJson]);

  if (error && !data) {
    return <Card className="rounded-xl border-destructive/40"><CardContent className="flex items-center gap-3 p-5 text-sm text-destructive"><AlertTriangle className="size-4" />{error}</CardContent></Card>;
  }
  if (!data) return <AnalyticsSkeleton />;

  if (productId) {
    if (!data.product) {
      return (
        <div className="flex flex-col gap-4">
          <EmptyState title="No recent tickets for this product" description="This product has no support tickets in the last 12 weeks." />
          <Button variant="ghost" className="self-center" onClick={onBack}><ArrowLeft data-icon="inline-start" />All products</Button>
        </div>
      );
    }
    return <ProductDetail product={data.product} tickets={data.tickets || []} onBack={onBack} />;
  }

  const products = data.products || [];
  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-muted-foreground">{coverageLine(data.coverage)}</p>
      <AlertCards alerts={data.alerts || []} onSelect={onSelectProduct} />
      {products.length ? (
        <ProductTable products={products} onSelect={onSelectProduct} />
      ) : (
        <Card className="rounded-xl shadow-sm"><CardContent className="p-6">
          <EmptyState
            title={data.coverage?.supportTickets ? "No tickets linked to a product yet" : "No support tickets yet"}
            description={data.coverage?.supportTickets ? "Products appear once tickets mention a product from your connected store." : "Products appear here once customers start writing in about them."}
          />
        </CardContent></Card>
      )}
    </div>
  );
}
