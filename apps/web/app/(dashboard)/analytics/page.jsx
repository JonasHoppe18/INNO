"use client";

import { useEffect, useState, useCallback } from "react";
import {
  AlertTriangle,
  BarChart2Icon,
  CheckCircle2,
  Edit3,
  FileText,
  InboxIcon,
  Zap,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TicketVolumeChart } from "@/components/analytics/TicketVolumeChart";
import { TicketTypesChart } from "@/components/analytics/TicketTypesChart";

const PERIOD_OPTIONS = [
  { value: "7", label: "7d" },
  { value: "30", label: "30d" },
  { value: "all", label: "All" },
];

const ACTION_LABELS = {
  cancel_order: "Cancel Order",
  refund_order: "Refund",
  create_exchange_request: "Exchange",
  lookup_order_status: "Order Lookup",
  add_note: "Internal Note",
  update_shipping_address: "Address Change",
  send_return_instructions: "Return Instructions",
  fetch_tracking: "Tracking Info",
  forward_email: "Forward Email",
  hold_fulfillment: "Hold Fulfillment",
  create_return: "Create Return",
};

function DeltaBadge({ current, previous }) {
  if (previous == null || previous === 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return null;
  const up = pct > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium ${
        up ? "text-emerald-600" : "text-rose-600"
      }`}
    >
      {up ? "↑" : "↓"} {Math.abs(pct)}%
    </span>
  );
}

function StatCard({ title, value, description, descriptionNode, icon: Icon, accentClass, badgeContent }) {
  return (
    <Card className="@container/card group relative overflow-hidden transition-shadow hover:shadow-md">
      <div className={`absolute inset-y-0 left-0 w-1 rounded-l-lg ${accentClass}`} />
      <CardHeader className="pl-6">
        <div className="flex items-center justify-between">
          <CardDescription className="text-xs font-medium uppercase tracking-wide">
            {title}
          </CardDescription>
          {Icon && (
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-lg ${accentClass} bg-opacity-10`}
            >
              <Icon className="size-4 opacity-80" />
            </div>
          )}
        </div>
        <CardTitle className="@[250px]/card:text-3xl mt-1 text-2xl font-bold tabular-nums">
          {value}
        </CardTitle>
      </CardHeader>
      <CardContent className="pl-6">
        {descriptionNode ?? <p className="text-xs text-muted-foreground">{description}</p>}
        {badgeContent && <div className="mt-2">{badgeContent}</div>}
      </CardContent>
    </Card>
  );
}

function QualityBar({ label, pct, count, total, colorClass, icon: Icon }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          {Icon && <Icon className="size-3.5 opacity-70" />}
          {label}
        </div>
        <span className="text-sm font-semibold tabular-nums">{pct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all duration-500 ${colorClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {count} of {total} drafts
      </p>
    </div>
  );
}

function ActionProgressBar({ applied, total }) {
  const pct = total > 0 ? Math.round((applied / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{pct}%</span>
    </div>
  );
}

function TagQualityTable({ rows = [] }) {
  const visibleRows = rows.slice(0, 8);
  if (!visibleRows.length) return null;
  return (
    <div className="mt-6 overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            <TableHead className="font-semibold">Tag</TableHead>
            <TableHead className="text-right font-semibold">Drafts</TableHead>
            <TableHead className="text-right font-semibold">Avg. edited</TableHead>
            <TableHead className="text-right font-semibold">Sent as-is</TableHead>
            <TableHead className="text-right font-semibold">Major edits</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleRows.map((row) => (
            <TableRow key={row.tag} className="transition-colors hover:bg-muted/30">
              <TableCell className="font-medium">
                <span className="inline-flex min-w-0 items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: row.color || "#94a3b8" }}
                  />
                  <span className="truncate">{row.tag}</span>
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums">{row.total}</TableCell>
              <TableCell className="text-right tabular-nums">
                {row.avg_edited_pct ?? 0}%
              </TableCell>
              <TableCell className="text-right tabular-nums text-emerald-700">
                {row.no_edit_pct}% ({row.no_edit})
              </TableCell>
              <TableCell className="text-right tabular-nums text-rose-700">
                {row.major_edit}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function LoadingRows({ cols = 4, rows = 3 }) {
  return Array.from({ length: rows }).map((_, i) => (
    <TableRow key={i} className="animate-pulse">
      {Array.from({ length: cols }).map((_, j) => (
        <TableCell key={j}>
          <div className="h-4 rounded bg-muted" />
        </TableCell>
      ))}
    </TableRow>
  ));
}

export default function AnalyticsPage() {
  const [period, setPeriod] = useState("30");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [backfillState, setBackfillState] = useState("idle"); // idle | running | done | error
  const [backfillResult, setBackfillResult] = useState(null);

  async function handleBackfill() {
    if (backfillState === "running") return;
    setBackfillState("running");
    setBackfillResult(null);
    try {
      const res = await fetch("/api/admin/backfill-tags", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Backfill mislykkedes.");
      setBackfillResult(json);
      setBackfillState("done");
    } catch (err) {
      setBackfillResult({ error: err.message });
      setBackfillState("error");
    }
  }

  const fetchData = useCallback((p) => {
    setLoading(true);
    setError(null);
    fetch(`/api/analytics/overview?period=${p}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        setData(json);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchData(period);
  }, [fetchData, period]);

  const actions = data?.actions ?? null;
  const quality = data?.draft_quality ?? null;
  const editedBeforeSendPct = data?.edited_before_send_pct ?? 0;
  const editedBeforeSendCount =
    data?.edited_before_send_count ??
    ((quality?.minor_edit ?? 0) + (quality?.major_edit ?? 0));
  const trackedSentDrafts = data?.tracked_sent_drafts ?? quality?.total ?? 0;
  const editedBeforeSendDescription = loading
    ? ""
    : trackedSentDrafts
      ? `${editedBeforeSendCount} of ${trackedSentDrafts} tracked sent drafts`
      : "No tracked sent drafts yet";

  return (
    <div className="@container/main flex flex-1 flex-col gap-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <BarChart2Icon className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Analytics</h1>
            <p className="text-xs text-muted-foreground">AI performance & ticket overview</p>
          </div>
        </div>
        <ToggleGroup
          type="single"
          value={period}
          onValueChange={(v) => {
            if (v) setPeriod(v);
          }}
          className="gap-0.5 rounded-lg border p-0.5"
        >
          {PERIOD_OPTIONS.map((opt) => (
            <ToggleGroupItem
              key={opt.value}
              value={opt.value}
              className="h-7 rounded-md px-3 text-xs data-[state=on]:bg-background data-[state=on]:shadow-sm"
            >
              {opt.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      {/* KPI Cards */}
      <div className="@xl/main:grid-cols-2 @5xl/main:grid-cols-4 grid grid-cols-1 gap-4">
        <StatCard
          title="Tickets Received"
          value={loading ? "—" : (data?.tickets_total ?? 0)}
          description="Incoming support requests"
          icon={InboxIcon}
          accentClass="bg-blue-500 text-blue-700"
          badgeContent={
            !loading && data?.previous != null ? (
              <DeltaBadge
                current={data?.tickets_total ?? 0}
                previous={data.previous.tickets_total}
              />
            ) : null
          }
        />
        <StatCard
          title="Edited Before Send"
          value={loading ? "—" : `${editedBeforeSendPct}%`}
          description={editedBeforeSendDescription}
          icon={Edit3}
          accentClass="bg-emerald-500 text-emerald-700"
        />
        <StatCard
          title="Actions Automated"
          value={loading ? "—" : (actions?.applied ?? 0)}
          description={`${actions?.total ?? 0} suggested — ${actions?.pending ?? 0} pending`}
          icon={Zap}
          accentClass="bg-violet-500 text-violet-700"
          badgeContent={
            !loading && data?.previous != null ? (
              <DeltaBadge
                current={actions?.applied ?? 0}
                previous={data.previous.actions_applied}
              />
            ) : null
          }
        />
        <StatCard
          title="Drafts Made"
          value={loading ? "—" : (data?.drafts_made ?? 0)}
          description="AI-generated draft replies"
          icon={FileText}
          accentClass="bg-amber-500 text-amber-700"
          badgeContent={
            !loading && data?.previous != null ? (
              <DeltaBadge
                current={data?.drafts_made ?? 0}
                previous={data.previous.drafts_made}
              />
            ) : null
          }
        />
      </div>

      {/* Ticket volume chart */}
      <Card className="transition-shadow hover:shadow-md">
        <CardHeader>
          <CardTitle className="text-base">Ticket Volume Over Time</CardTitle>
          <CardDescription>New tickets per day</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex min-h-[200px] items-center justify-center">
              <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                Loading…
              </div>
            </div>
          ) : (
            <TicketVolumeChart
              data={data?.volume_by_day ?? []}
              periodDays={period}
            />
          )}
        </CardContent>
      </Card>

      {/* Ticket types + Actions side by side */}
      <div className="grid gap-4 @3xl/main:grid-cols-2">
        <Card className="transition-shadow hover:shadow-md">
          <CardHeader>
            <CardTitle className="text-base">Ticket Types</CardTitle>
            <CardDescription>Distribution based on ticket tags</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex min-h-[200px] items-center justify-center">
                <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  Loading…
                </div>
              </div>
            ) : (
              <TicketTypesChart data={data?.ticket_types ?? []} />
            )}
          </CardContent>
        </Card>

        <Card className="transition-shadow hover:shadow-md">
          <CardHeader>
            <CardTitle className="text-base">Actions</CardTitle>
            <CardDescription>AI-suggested actions by type</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Applied</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <LoadingRows cols={4} rows={3} />
                  </TableBody>
                </Table>
              </div>
            ) : !actions?.by_type?.length ? (
              <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <Zap className="size-8 opacity-20" />
                No actions in this period.
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead className="font-semibold">Type</TableHead>
                      <TableHead className="text-right font-semibold">Total</TableHead>
                      <TableHead className="text-right font-semibold text-emerald-700">Applied</TableHead>
                      <TableHead className="text-right font-semibold text-amber-700">Pending</TableHead>
                      <TableHead className="font-semibold">Rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {actions.by_type.map((row) => (
                      <TableRow
                        key={row.type}
                        className="cursor-default transition-colors hover:bg-muted/30"
                      >
                        <TableCell className="font-medium">
                          {ACTION_LABELS[row.type] ?? row.type}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{row.total}</TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-700">
                          {row.applied}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-amber-700">
                          {row.pending}
                        </TableCell>
                        <TableCell>
                          <ActionProgressBar applied={row.applied} total={row.total} />
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

      {/* Draft quality */}
      <Card className="transition-shadow hover:shadow-md">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Draft Quality</CardTitle>
              <CardDescription className="mt-1">
                How much agents edit AI-generated drafts before sending
              </CardDescription>
            </div>
            {quality?.total ? (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
                  {quality.avg_edited_pct ?? 0}% edited on average
                </Badge>
                <Badge
                  variant="outline"
                  className={
                    quality.no_edit_pct >= 60
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : quality.no_edit_pct >= 30
                      ? "border-amber-200 bg-amber-50 text-amber-700"
                      : "border-rose-200 bg-rose-50 text-rose-700"
                  }
                >
                  {quality.no_edit_pct}% accepted as-is
                </Badge>
              </div>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex min-h-[60px] items-center justify-center text-sm text-muted-foreground">
              <div className="flex flex-col items-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                Loading…
              </div>
            </div>
          ) : !quality?.total ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Edit3 className="size-4 opacity-40" />
              No sent drafts with edit tracking in this period.
            </div>
          ) : (
            <>
              <div className="grid gap-5 @xl/main:grid-cols-3">
                <QualityBar
                  label="No edits"
                  pct={quality.no_edit_pct}
                  count={quality.no_edit}
                  total={quality.total}
                  colorClass="bg-emerald-500"
                  icon={CheckCircle2}
                />
                <QualityBar
                  label="Minor edits"
                  pct={quality.minor_edit_pct}
                  count={quality.minor_edit}
                  total={quality.total}
                  colorClass="bg-amber-400"
                  icon={Edit3}
                />
                <QualityBar
                  label="Major edits"
                  pct={quality.major_edit_pct}
                  count={quality.major_edit}
                  total={quality.total}
                  colorClass="bg-rose-500"
                  icon={AlertTriangle}
                />
              </div>
              <TagQualityTable rows={quality.by_tag || []} />
            </>
          )}
        </CardContent>
      </Card>

      {/* Data management */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Data management</CardTitle>
          <CardDescription className="text-xs">Maintenance actions for your workspace data.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-slate-800">Tag historical tickets</p>
              <p className="text-xs text-slate-500 mt-0.5">Run AI tagging on all tickets that currently have no tags.</p>
              {backfillState === "done" && backfillResult && !backfillResult.error && (
                <p className="text-xs text-emerald-600 mt-1">
                  Done — {backfillResult.tagged ?? 0} of {backfillResult.processed ?? 0} tickets tagged.
                </p>
              )}
              {backfillState === "error" && backfillResult?.error && (
                <p className="text-xs text-rose-600 mt-1">{backfillResult.error}</p>
              )}
            </div>
            <button
              type="button"
              onClick={handleBackfill}
              disabled={backfillState === "running"}
              className="shrink-0 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {backfillState === "running" ? "Running…" : "Run backfill"}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
