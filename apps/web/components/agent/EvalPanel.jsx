"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FlaskConical,
  Loader2,
  Play,
  RefreshCw,
  Zap,
} from "lucide-react";
import Link from "next/link";

// ─── Score badge ─────────────────────────────────────────────────────────────

function ScoreBadge({ value }) {
  const color =
    value >= 4 ? "bg-emerald-100 text-emerald-700" :
    value === 3 ? "bg-amber-100 text-amber-700" :
    "bg-red-100 text-red-700";
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${color}`}>
      {value}/5
    </span>
  );
}

// ─── Action type badge ────────────────────────────────────────────────────────

const ACTION_LABELS = {
  cancel_order: { label: "Cancel order", color: "bg-red-100 text-red-700 border-red-200" },
  refund: { label: "Refund", color: "bg-orange-100 text-orange-700 border-orange-200" },
  update_shipping_address: { label: "Update address", color: "bg-blue-100 text-blue-700 border-blue-200" },
  send_return_instructions: { label: "Return instructions", color: "bg-violet-100 text-violet-700 border-violet-200" },
  exchange: { label: "Exchange", color: "bg-indigo-100 text-indigo-700 border-indigo-200" },
  hold_fulfillment: { label: "Hold fulfillment", color: "bg-yellow-100 text-yellow-700 border-yellow-200" },
};

function ActionBadge({ action }) {
  const info = ACTION_LABELS[action.type] || { label: action.type, color: "bg-slate-100 text-slate-700 border-slate-200" };
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${info.color}`}>
      <Zap className="h-2.5 w-2.5" />
      {info.label}
    </span>
  );
}

// ─── Eval result row ──────────────────────────────────────────────────────────

function EvalResultRow({ result }) {
  const [open, setOpen] = useState(false);
  const label = result.ticket_subject || (result.thread_id ? result.thread_id.slice(0, 8) + "…" : "Email");
  const actions = Array.isArray(result.proposed_actions) ? result.proposed_actions : [];

  return (
    <div className="border-b last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-xs hover:bg-slate-50 transition-colors"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <span className="flex-1 truncate font-medium text-slate-700">{label}</span>
        {actions.length > 0 && (
          <span className="shrink-0 rounded-md border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
            {actions.length} action{actions.length !== 1 ? "s" : ""}
          </span>
        )}
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="text-muted-foreground">Overall</span>
          <ScoreBadge value={result.overall} />
        </div>
      </button>

      {open && (
        <div className="bg-slate-50 px-4 pb-4 pt-2 text-xs space-y-3">
          {/* Scores */}
          <div className="flex flex-wrap gap-3">
            {[["Correctness", result.correctness], ["Completeness", result.completeness], ["Tone", result.tone], ["Actionability", result.actionability]].map(([lbl, val]) => (
              <div key={lbl} className="flex items-center gap-1.5">
                <span className="text-muted-foreground">{lbl}</span>
                <ScoreBadge value={val} />
              </div>
            ))}
          </div>

          {/* Reasoning */}
          {result.reasoning && <p className="text-slate-600 italic">{result.reasoning}</p>}

          {/* Proposed actions */}
          {actions.length > 0 && (
            <div className="rounded-lg border border-violet-100 bg-violet-50/60 p-3 space-y-1.5">
              <p className="text-[11px] font-semibold text-violet-800 uppercase tracking-wide">Proposed actions</p>
              <div className="flex flex-wrap gap-1.5">
                {actions.map((action, i) => (
                  <ActionBadge key={i} action={action} />
                ))}
              </div>
            </div>
          )}

          {/* Customer email */}
          {result.ticket_body && (
            <details>
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">Customer email</summary>
              <p className="mt-1.5 whitespace-pre-wrap rounded-lg border bg-white p-2.5 text-slate-700 leading-relaxed">{result.ticket_body}</p>
            </details>
          )}

          {/* AI draft */}
          {result.draft_content && (
            <details>
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">Sona draft</summary>
              <p className="mt-1.5 whitespace-pre-wrap rounded-lg border bg-white p-2.5 text-slate-700 leading-relaxed">{result.draft_content}</p>
            </details>
          )}

          {/* Human reply */}
          {result.human_reply && (
            <details>
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
                <span className="inline-flex items-center gap-1">
                  Zendesk human reply
                  <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-700">human</span>
                </span>
              </summary>
              <p className="mt-1.5 whitespace-pre-wrap rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-slate-700 leading-relaxed">{result.human_reply}</p>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main EvalPanel ──────────────────────────────────────────────────────────

const EMPTY_EMAIL = () => ({ id: Math.random().toString(36).slice(2), subject: "", body: "" });
const MODELS = ["gpt-4o", "gpt-4o-mini"];

export function EvalPanel({ fullPage = false }) {
  const [mode, setMode] = useState("manual");
  const [emails, setEmails] = useState([EMPTY_EMAIL()]);
  const [zendeskTickets, setZendeskTickets] = useState([]);
  const [selectedZendesk, setSelectedZendesk] = useState(new Set());
  const [loadingZendesk, setLoadingZendesk] = useState(false);
  const [zendeskError, setZendeskError] = useState(null);
  const [runLabel, setRunLabel] = useState("");
  const [model, setModel] = useState("gpt-4o");
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
    if (mode === "manual" && !emails.some((e) => e.body.trim())) return;
    if (mode === "zendesk" && selectedZendesk.size === 0) return;

    setRunning(true);
    setRunError(null);
    try {
      const body = mode === "zendesk"
        ? {
            zendesk_tickets: zendeskTickets.filter((t) => selectedZendesk.has(t.id)),
            run_label: runLabel.trim(),
            model,
          }
        : {
            emails: emails.filter((e) => e.body.trim()).map((e) => ({ subject: e.subject, body: e.body })),
            run_label: runLabel.trim(),
            model,
          };

      const res = await fetch("/api/eval/run", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

  const header = (
    <div className="flex items-center justify-between border-b px-6 py-4">
      <div className="flex items-center gap-2">
        <FlaskConical className="h-4 w-4 text-muted-foreground" />
        <div>
          <p className="text-sm font-semibold text-foreground">Draft quality eval</p>
          <p className="text-xs text-muted-foreground">Score Sona&apos;s drafts against real Zendesk tickets or pasted emails using the full pipeline.</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1 rounded-lg border bg-slate-50 p-0.5">
          <button
            type="button"
            onClick={() => setMode("manual")}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${mode === "manual" ? "bg-white shadow-sm text-slate-800" : "text-muted-foreground hover:text-slate-700"}`}
          >Manual</button>
          <button
            type="button"
            onClick={() => { setMode("zendesk"); if (zendeskTickets.length === 0) fetchZendeskTickets(); }}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${mode === "zendesk" ? "bg-white shadow-sm text-slate-800" : "text-muted-foreground hover:text-slate-700"}`}
          >Zendesk</button>
        </div>
        {!fullPage && (
          <Link
            href="/eval"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:bg-slate-50 hover:text-slate-900"
          >
            <ExternalLink className="h-3 w-3" />
            Full page
          </Link>
        )}
        {fullPage && (
          <button
            type="button"
            onClick={fetchRuns}
            className="inline-flex items-center gap-1 rounded-lg border bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:bg-slate-50"
          >
            <RefreshCw className="h-3 w-3" />
            Refresh
          </button>
        )}
      </div>
    </div>
  );

  const inputSection = (
    <div className="space-y-4">
      {mode === "manual" ? (
        <div className="space-y-3">
          {emails.map((email, idx) => (
            <div key={email.id} className="rounded-xl border bg-slate-50 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-600">Email {idx + 1}</span>
                {emails.length > 1 && (
                  <button type="button" onClick={() => removeEmail(email.id)} className="text-xs text-muted-foreground hover:text-destructive transition-colors">Remove</button>
                )}
              </div>
              <input
                type="text"
                value={email.subject}
                onChange={(e) => updateEmail(email.id, "subject", e.target.value)}
                placeholder="Subject (optional)"
                className="w-full rounded-lg border border-input bg-white px-3 py-1.5 text-xs shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
              <textarea
                value={email.body}
                onChange={(e) => updateEmail(email.id, "body", e.target.value)}
                placeholder="Paste customer email here…"
                rows={fullPage ? 6 : 4}
                className="w-full resize-y rounded-lg border border-input bg-white px-3 py-2 text-xs shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
            </div>
          ))}
          <button
            type="button"
            onClick={addEmail}
            className="text-xs text-blue-600 hover:text-blue-500 transition-colors font-medium"
          >
            + Add email
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {loadingZendesk && (
            <p className="text-xs text-muted-foreground">Fetching tickets from Zendesk…</p>
          )}
          {zendeskError && (
            <p className="text-xs text-destructive">{zendeskError}</p>
          )}
          {!loadingZendesk && !zendeskError && zendeskTickets.length === 0 && (
            <p className="text-xs text-muted-foreground">No solved Zendesk tickets found.</p>
          )}
          {zendeskTickets.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">{selectedZendesk.size} of {zendeskTickets.length} tickets selected</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setSelectedZendesk(new Set(zendeskTickets.map((t) => t.id)))} className="text-xs text-blue-600 hover:text-blue-500 font-medium">Select all</button>
                  <button type="button" onClick={() => setSelectedZendesk(new Set())} className="text-xs text-muted-foreground hover:text-slate-700">Clear</button>
                </div>
              </div>
              <div className="divide-y rounded-xl border bg-white overflow-hidden">
                {zendeskTickets.map((ticket) => (
                  <label key={ticket.id} className="flex cursor-pointer items-start gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors">
                    <input
                      type="checkbox"
                      checked={selectedZendesk.has(ticket.id)}
                      onChange={() => toggleZendesk(ticket.id)}
                      className="mt-0.5 shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-slate-800">{ticket.subject || "(no subject)"}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{ticket.customer_body?.slice(0, 80)}…</p>
                    </div>
                  </label>
                ))}
              </div>
              <button type="button" onClick={fetchZendeskTickets} className="text-xs text-muted-foreground hover:text-slate-700">Refresh</button>
            </>
          )}
        </div>
      )}

      {/* Run controls */}
      <div className={`flex gap-2 ${fullPage ? "flex-row" : "flex-col sm:flex-row"}`}>
        <input
          type="text"
          value={runLabel}
          onChange={(e) => setRunLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && canRun && !running && handleRun()}
          placeholder='Run label, e.g. "gpt-4o baseline"'
          className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/30"
        />
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
        >
          {MODELS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleRun}
          disabled={running || !canRun}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-500 disabled:opacity-50"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {running ? "Running…" : "Run eval"}
        </button>
      </div>
      {runError && <p className="text-xs text-destructive">{runError}</p>}
    </div>
  );

  const resultsSection = loadingRuns ? (
    <div className="h-12 animate-pulse rounded-xl bg-slate-100" />
  ) : runs.length === 0 ? (
    <p className="text-xs text-muted-foreground">No eval runs yet.</p>
  ) : (
    <div className="space-y-3">
      <p className="text-xs font-medium text-slate-600">Previous runs</p>
      {runs.map((run) => (
        <div key={run.run_label} className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <button
            type="button"
            onClick={() => setExpandedRun(expandedRun === run.run_label ? null : run.run_label)}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
          >
            <div className="flex min-w-0 items-center gap-2">
              {expandedRun === run.run_label ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
              <span className="truncate text-sm font-semibold text-slate-800">{run.run_label}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{run.count} email{run.count !== 1 ? "s" : ""} · {run.model}</span>
            </div>
            <div className="flex shrink-0 items-center gap-3 text-xs">
              {[["Corr", run.averages.correctness], ["Comp", run.averages.completeness], ["Tone", run.averages.tone], ["Act", run.averages.actionability]].map(([abbr, val]) => (
                <span key={abbr} className="hidden text-muted-foreground sm:inline">
                  {abbr} <span className="font-medium text-slate-700">{val}</span>
                </span>
              ))}
              <span className="ml-1 inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700">
                {run.averages.overall} avg
              </span>
            </div>
          </button>
          {expandedRun === run.run_label && (
            <div className="border-t">
              {run.results.map((r) => <EvalResultRow key={r.id} result={r} />)}
            </div>
          )}
        </div>
      ))}
    </div>
  );

  if (fullPage) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        <div className="flex items-center gap-3">
          <FlaskConical className="h-5 w-5 text-muted-foreground" />
          <div>
            <h1 className="text-lg font-bold text-slate-900">Draft Quality Eval</h1>
            <p className="text-sm text-muted-foreground">Score Sona&apos;s drafts against real Zendesk tickets using the full agent pipeline.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Left: input */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-700">New run</p>
              <div className="flex items-center gap-1 rounded-lg border bg-slate-50 p-0.5">
                <button
                  type="button"
                  onClick={() => setMode("manual")}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${mode === "manual" ? "bg-white shadow-sm text-slate-800" : "text-muted-foreground hover:text-slate-700"}`}
                >Manual</button>
                <button
                  type="button"
                  onClick={() => { setMode("zendesk"); if (zendeskTickets.length === 0) fetchZendeskTickets(); }}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${mode === "zendesk" ? "bg-white shadow-sm text-slate-800" : "text-muted-foreground hover:text-slate-700"}`}
                >Zendesk</button>
              </div>
            </div>
            {inputSection}
          </div>

          {/* Right: results */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-700">Runs</p>
              <button
                type="button"
                onClick={fetchRuns}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-slate-700"
              >
                <RefreshCw className="h-3 w-3" />
                Refresh
              </button>
            </div>
            {resultsSection}
          </div>
        </div>
      </div>
    );
  }

  // Embedded (inside FineTuningPanel)
  return (
    <Card className="mt-8 overflow-hidden border bg-white shadow-sm">
      {header}
      <CardContent className="space-y-6 pt-5">
        {inputSection}
        {resultsSection}
      </CardContent>
    </Card>
  );
}
