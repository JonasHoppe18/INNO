"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FlaskConical,
  Loader2,
  Play,
  RefreshCw,
  Trash2,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

// ─── Score badge ──────────────────────────────────────────────────────────────

function ScoreBadge({ value }) {
  if (value == null) return null;
  const variant =
    value >= 4 ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
    value === 3 ? "bg-amber-50 text-amber-700 border-amber-200" :
    "bg-red-50 text-red-600 border-red-200";
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-semibold tabular-nums ${variant}`}>
      {value}/5
    </span>
  );
}

function ScoreBar({ label, value }) {
  if (value == null) return null;
  const pct = Math.round((value / 5) * 100);
  const color =
    value >= 4 ? "bg-emerald-500" :
    value === 3 ? "bg-amber-400" :
    "bg-red-400";
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-6 text-right text-xs font-medium tabular-nums">{value}</span>
    </div>
  );
}

// ─── Action badge ─────────────────────────────────────────────────────────────

const ACTION_LABELS = {
  cancel_order:             "Cancel order",
  refund:                   "Refund",
  update_shipping_address:  "Update address",
  send_return_instructions: "Return instructions",
  exchange:                 "Exchange",
  hold_fulfillment:         "Hold fulfillment",
};

function ActionBadge({ action }) {
  const label = ACTION_LABELS[action.type] || action.type;
  return (
    <span className="inline-flex items-center gap-1 rounded-md border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
      <Zap className="h-3 w-3" />
      {label}
    </span>
  );
}

// ─── Result row ───────────────────────────────────────────────────────────────

function EvalResultRow({ result }) {
  const [open, setOpen] = useState(false);
  const label = result.ticket_subject || (result.thread_id ? `Thread ${result.thread_id.slice(0, 8)}…` : "Email");
  const actions = Array.isArray(result.proposed_actions) ? result.proposed_actions : [];
  const dims = [
    ["Correctness",   result.correctness],
    ["Completeness",  result.completeness],
    ["Tone",          result.tone],
    ["Actionability", result.actionability],
    ["Overall",       result.overall],
  ];

  return (
    <div className="border-b last:border-0">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted/40 transition-colors select-none"
      >
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
        <span className="flex-1 truncate text-sm">{label}</span>
        {actions.length > 0 && (
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            {actions.length} action{actions.length !== 1 ? "s" : ""}
          </Badge>
        )}
        <ScoreBadge value={result.overall} />
      </div>

      {open && (
        <div className="border-t bg-muted/20 px-4 pb-4 pt-3">
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Left: scores */}
            <div className="space-y-3">
              <div className="rounded-lg border bg-card p-3 space-y-2">
                {dims.map(([lbl, val]) => (
                  <ScoreBar key={lbl} label={lbl} value={val} />
                ))}
              </div>

              {result.reasoning && (
                <p className="text-xs text-muted-foreground italic leading-relaxed">{result.reasoning}</p>
              )}

              {actions.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium">Proposed actions</p>
                  <div className="flex flex-wrap gap-1.5">
                    {actions.map((a, i) => <ActionBadge key={i} action={a} />)}
                  </div>
                </div>
              )}
            </div>

            {/* Right: content */}
            <div className="space-y-2">
              {result.ticket_body && (
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground select-none">
                    <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                    Customer email
                  </summary>
                  <div className="mt-1.5 rounded-md border bg-card p-3">
                    <p className="whitespace-pre-wrap text-xs leading-relaxed">{result.ticket_body}</p>
                  </div>
                </details>
              )}

              {result.draft_content && (
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground select-none">
                    <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                    Sona draft
                  </summary>
                  <div className="mt-1.5 rounded-md border bg-card p-3">
                    <p className="whitespace-pre-wrap text-xs leading-relaxed">{result.draft_content}</p>
                  </div>
                </details>
              )}

              {result.human_reply && (
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground select-none">
                    <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                    <span className="flex items-center gap-1.5">
                      Human reply
                      <Badge variant="outline" className="text-[10px] py-0">Zendesk</Badge>
                    </span>
                  </summary>
                  <div className="mt-1.5 rounded-md border bg-card p-3">
                    <p className="whitespace-pre-wrap text-xs leading-relaxed">{result.human_reply}</p>
                  </div>
                </details>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Run card ─────────────────────────────────────────────────────────────────

function RunCard({ run, expanded, onToggle, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const overall = run.averages.overall;
  const scoreColor =
    overall >= 4 ? "text-emerald-700 bg-emerald-50 border-emerald-200" :
    overall === 3 ? "text-amber-700 bg-amber-50 border-amber-200" :
    "text-red-600 bg-red-50 border-red-200";

  const handleDelete = async (e) => {
    e.stopPropagation();
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    await onDelete(run.run_label);
    setDeleting(false);
    setConfirmDelete(false);
  };

  return (
    <Card className="group overflow-hidden shadow-none">
      <div className="flex items-center">
        <div
          role="button"
          tabIndex={0}
          onClick={onToggle}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onToggle()}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 p-4 text-left hover:bg-muted/30 transition-colors select-none"
        >
          <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-sm font-bold tabular-nums ${scoreColor}`}>
            {overall}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{run.run_label}</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
              {run.count} ticket{run.count !== 1 ? "s" : ""} · <span className="font-mono">{run.model}</span>
              {run.pipeline_version === "v2" && (
                <span className="inline-flex items-center rounded border border-violet-200 bg-violet-50 px-1.5 py-0 text-[10px] font-semibold text-violet-700">V2</span>
              )}
              {run.created_at && ` · ${new Date(run.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
            </p>
          </div>
          <div className="hidden shrink-0 items-center gap-4 sm:flex">
            {[["Corr", run.averages.correctness], ["Comp", run.averages.completeness], ["Tone", run.averages.tone], ["Act", run.averages.actionability]].map(([abbr, val]) => (
              <div key={abbr} className="text-center">
                <p className="text-xs font-medium tabular-nums">{val}</p>
                <p className="text-[10px] text-muted-foreground">{abbr}</p>
              </div>
            ))}
          </div>
          <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
        </div>

        {/* Delete control — separate from the expand area */}
        <div className="shrink-0 pr-3">
          {confirmDelete ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="rounded px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
              >
                {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Slet"}
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
                className="rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Annuller
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleDelete}
              className="rounded p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-destructive transition-all [.group:hover_&]:opacity-100"
              aria-label="Slet run"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <>
          <Separator />
          {run.results.map((r) => <EvalResultRow key={r.id} result={r} />)}
        </>
      )}
    </Card>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

let _emailCounter = 0;
const EMPTY_EMAIL = () => ({ id: `email-${++_emailCounter}`, subject: "", body: "" });
const MODELS = ["gpt-4o", "gpt-4o-mini"];
const PIPELINES = [{ value: "legacy", label: "Legacy" }, { value: "v2", label: "V2 (ny)" }];

export function EvalPanel({ fullPage = false }) {
  const [mode, setMode] = useState("zendesk");
  const [emails, setEmails] = useState([EMPTY_EMAIL()]);
  const [zendeskTickets, setZendeskTickets] = useState([]);
  const [selectedZendesk, setSelectedZendesk] = useState(new Set());
  const [loadingZendesk, setLoadingZendesk] = useState(false);
  const [zendeskError, setZendeskError] = useState(null);
  const [runLabel, setRunLabel] = useState("");
  const [model, setModel] = useState("gpt-4o");
  const [pipeline, setPipeline] = useState("legacy");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState(null);
  const [runs, setRuns] = useState([]);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [expandedRun, setExpandedRun] = useState(null);

  const fetchRuns = useCallback(async () => {
    setLoadingRuns(true);
    try {
      const res = await fetch("/api/eval/results", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      setRuns(data?.runs ?? []);
    } catch { /* silent */ } finally {
      setLoadingRuns(false);
    }
  }, []);

  useEffect(() => { fetchRuns(); }, [fetchRuns]);

  const deleteRun = useCallback(async (runLabel) => {
    try {
      await fetch("/api/eval/results", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_label: runLabel }),
      });
      setRuns((prev) => prev.filter((r) => r.run_label !== runLabel));
      if (expandedRun === runLabel) setExpandedRun(null);
    } catch { /* silent */ }
  }, [expandedRun]);

  const fetchZendeskTickets = async () => {
    setLoadingZendesk(true);
    setZendeskError(null);
    try {
      const res = await fetch("/api/eval/zendesk-tickets?limit=30", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to fetch Zendesk tickets");
      setZendeskTickets(data?.tickets ?? []);
      setSelectedZendesk(new Set((data?.tickets ?? []).map((t) => t.id)));
    } catch (err) {
      setZendeskError(err.message);
    } finally {
      setLoadingZendesk(false);
    }
  };

  const handleModeChange = (next) => {
    setMode(next);
    if (next === "zendesk" && zendeskTickets.length === 0) fetchZendeskTickets();
  };

  const toggleZendesk = (id) => setSelectedZendesk((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const addEmail = () => setEmails((prev) => [...prev, EMPTY_EMAIL()]);
  const removeEmail = (id) => setEmails((prev) => prev.filter((e) => e.id !== id));
  const updateEmail = (id, field, value) =>
    setEmails((prev) => prev.map((e) => e.id === id ? { ...e, [field]: value } : e));

  const handleRun = async () => {
    if (!runLabel.trim()) return;
    setRunning(true);
    setRunError(null);
    try {
      const payload = mode === "zendesk"
        ? { zendesk_tickets: zendeskTickets.filter((t) => selectedZendesk.has(t.id)), run_label: runLabel.trim(), model, pipeline }
        : { emails: emails.filter((e) => e.body.trim()).map((e) => ({ subject: e.subject, body: e.body })), run_label: runLabel.trim(), model, pipeline };

      const res = await fetch("/api/eval/run", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Eval failed");
      await fetchRuns();
      setExpandedRun(runLabel.trim());
      setRunLabel("");
    } catch (err) {
      setRunError(err.message);
    } finally {
      setRunning(false);
    }
  };

  const canRun = runLabel.trim() && (
    (mode === "manual" && emails.some((e) => e.body.trim())) ||
    (mode === "zendesk" && selectedZendesk.size > 0)
  );

  // ── Input section ────────────────────────────────────────────────────────
  const inputSection = (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div className="flex rounded-lg border bg-muted p-1 text-xs">
        {[["zendesk", "Zendesk"], ["manual", "Manual"]].map(([val, label]) => (
          <button
            key={val}
            type="button"
            onClick={() => handleModeChange(val)}
            className={`flex-1 rounded-md py-1.5 font-medium transition-colors ${
              mode === val ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      {mode === "manual" ? (
        <div className="space-y-3">
          {emails.map((email, idx) => (
            <div key={email.id} className="rounded-lg border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Email {idx + 1}</span>
                {emails.length > 1 && (
                  <button type="button" onClick={() => removeEmail(email.id)} className="text-xs text-muted-foreground hover:text-destructive">Remove</button>
                )}
              </div>
              <Input
                value={email.subject}
                onChange={(e) => updateEmail(email.id, "subject", e.target.value)}
                placeholder="Subject (optional)"
                className="h-8 text-xs"
              />
              <textarea
                value={email.body}
                onChange={(e) => updateEmail(email.id, "body", e.target.value)}
                placeholder="Paste customer email here…"
                rows={5}
                className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          ))}
          <button type="button" onClick={addEmail} className="text-xs text-muted-foreground hover:text-foreground">
            + Add email
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {loadingZendesk && (
            <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Fetching tickets…
            </div>
          )}
          {zendeskError && <p className="text-xs text-destructive">{zendeskError}</p>}
          {!loadingZendesk && !zendeskError && zendeskTickets.length === 0 && (
            <p className="py-3 text-xs text-muted-foreground">No solved Zendesk tickets found.</p>
          )}
          {zendeskTickets.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{selectedZendesk.size} of {zendeskTickets.length} selected</span>
                <div className="flex gap-2 text-xs">
                  <button type="button" onClick={() => setSelectedZendesk(new Set(zendeskTickets.map((t) => t.id)))} className="text-muted-foreground hover:text-foreground">All</button>
                  <button type="button" onClick={() => setSelectedZendesk(new Set())} className="text-muted-foreground hover:text-foreground">None</button>
                  <button type="button" onClick={fetchZendeskTickets} className="text-muted-foreground hover:text-foreground">Refresh</button>
                </div>
              </div>
              <div className="overflow-hidden rounded-lg border divide-y">
                {zendeskTickets.map((ticket) => (
                  <label key={ticket.id} className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-muted/40 transition-colors">
                    <input
                      type="checkbox"
                      checked={selectedZendesk.has(ticket.id)}
                      onChange={() => toggleZendesk(ticket.id)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary cursor-pointer"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">{ticket.subject || "(no subject)"}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{ticket.customer_body?.slice(0, 80)}…</p>
                    </div>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <Separator />

      {/* Run controls */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <Input
            value={runLabel}
            onChange={(e) => setRunLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && canRun && !running && handleRun()}
            placeholder='Label, e.g. "v2 test"'
            className="flex-1 text-sm"
          />
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODELS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={pipeline} onValueChange={setPipeline}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PIPELINES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button
          onClick={handleRun}
          disabled={running || !canRun}
          className="w-full"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {running ? "Running…" : "Run eval"}
        </Button>
        {runError && <p className="text-xs text-destructive">{runError}</p>}
      </div>
    </div>
  );

  // ── Results section ──────────────────────────────────────────────────────
  const resultsSection = loadingRuns ? (
    <div className="space-y-2">
      {[1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />)}
    </div>
  ) : runs.length === 0 ? (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-12 text-center">
      <FlaskConical className="mb-2 h-7 w-7 text-muted-foreground/30" />
      <p className="text-sm text-muted-foreground">No eval runs yet</p>
      <p className="mt-0.5 text-xs text-muted-foreground/60">Run an eval to see results here</p>
    </div>
  ) : (
    <div className="space-y-2">
      {runs.map((run) => (
        <RunCard
          key={run.run_label}
          run={run}
          expanded={expandedRun === run.run_label}
          onToggle={() => setExpandedRun(expandedRun === run.run_label ? null : run.run_label)}
          onDelete={deleteRun}
        />
      ))}
    </div>
  );

  // ── Full page ────────────────────────────────────────────────────────────
  if (fullPage) {
    return (
      <div className="flex h-screen flex-col overflow-hidden bg-background">
        {/* Body — two panes that fill remaining height */}
        <div className="flex min-h-0 flex-1">
          {/* Left: results */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-5">
            <div className="mb-4 flex items-center gap-2">
              <p className="text-sm font-semibold">Runs</p>
              {runs.length > 0 && (
                <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{runs.length}</span>
              )}
            </div>
            {resultsSection}
          </div>

          {/* Right: config sidebar */}
          <div className="hidden w-[380px] shrink-0 overflow-y-auto border-l bg-muted/30 px-5 py-5 lg:block">
            <p className="mb-4 text-sm font-semibold">New run</p>
            {inputSection}
          </div>
        </div>

        {/* Mobile: config below results */}
        <div className="shrink-0 border-t px-5 py-5 lg:hidden">
          <p className="mb-4 text-sm font-semibold">New run</p>
          {inputSection}
        </div>
      </div>
    );
  }

  // ── Embedded ─────────────────────────────────────────────────────────────
  return (
    <Card className="mt-8 overflow-hidden shadow-none">
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-semibold">Draft quality eval</p>
            <p className="text-xs text-muted-foreground">Score drafts against real tickets using the full pipeline.</p>
          </div>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/eval" target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-3.5 w-3.5" />
            Full page
          </Link>
        </Button>
      </div>
      <CardContent className="space-y-6 pt-5">
        {inputSection}
        {resultsSection}
      </CardContent>
    </Card>
  );
}
