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
  Zap,
} from "lucide-react";
import Link from "next/link";

// ─── Score bar ────────────────────────────────────────────────────────────────

function ScoreBar({ value, max = 5, size = "md" }) {
  const pct = Math.round((value / max) * 100);
  const color =
    value >= 4 ? "bg-emerald-500" :
    value === 3 ? "bg-amber-400" :
    "bg-red-400";
  if (size === "sm") {
    return (
      <div className="flex items-center gap-1.5">
        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
        </div>
        <span className="w-5 text-right text-[11px] font-semibold tabular-nums text-slate-600">{value}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-6 text-right text-xs font-semibold tabular-nums text-slate-700">{value}/5</span>
    </div>
  );
}

function OverallPill({ value }) {
  const color =
    value >= 4 ? "bg-emerald-50 text-emerald-700 ring-emerald-200" :
    value === 3 ? "bg-amber-50 text-amber-700 ring-amber-200" :
    "bg-red-50 text-red-600 ring-red-200";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-sm font-bold ring-1 ${color}`}>
      {value}<span className="ml-0.5 text-xs font-normal opacity-60">/5</span>
    </span>
  );
}

// ─── Action badge ─────────────────────────────────────────────────────────────

const ACTION_LABELS = {
  cancel_order:             { label: "Cancel order",         color: "bg-red-50 text-red-700 ring-red-200" },
  refund:                   { label: "Refund",               color: "bg-orange-50 text-orange-700 ring-orange-200" },
  update_shipping_address:  { label: "Update address",       color: "bg-blue-50 text-blue-700 ring-blue-200" },
  send_return_instructions: { label: "Return instructions",  color: "bg-violet-50 text-violet-700 ring-violet-200" },
  exchange:                 { label: "Exchange",             color: "bg-indigo-50 text-indigo-700 ring-indigo-200" },
  hold_fulfillment:         { label: "Hold fulfillment",     color: "bg-yellow-50 text-yellow-700 ring-yellow-200" },
};

function ActionBadge({ action }) {
  const info = ACTION_LABELS[action.type] || { label: action.type, color: "bg-slate-50 text-slate-700 ring-slate-200" };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ${info.color}`}>
      <Zap className="h-2.5 w-2.5" />
      {info.label}
    </span>
  );
}

// ─── Eval result row ──────────────────────────────────────────────────────────

function EvalResultRow({ result }) {
  const [open, setOpen] = useState(false);
  const label = result.ticket_subject || (result.thread_id ? `Thread ${result.thread_id.slice(0, 8)}…` : "Email");
  const actions = Array.isArray(result.proposed_actions) ? result.proposed_actions : [];

  const dims = [
    ["Correctness",  result.correctness],
    ["Completeness", result.completeness],
    ["Tone",         result.tone],
    ["Actionability",result.actionability],
  ];

  return (
    <div className="border-b border-slate-100 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-slate-50/80 transition-colors"
      >
        <span className="text-slate-300 transition-colors group-hover:text-slate-400">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
        <span className="flex-1 truncate text-sm font-medium text-slate-700">{label}</span>
        <div className="flex shrink-0 items-center gap-3">
          {actions.length > 0 && (
            <span className="hidden rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-600 ring-1 ring-violet-200 sm:inline">
              {actions.length} action{actions.length !== 1 ? "s" : ""}
            </span>
          )}
          {/* Mini score bars in row header */}
          <div className="hidden items-center gap-3 sm:flex">
            {dims.map(([, v]) => (
              <ScoreBar key={v} value={v} size="sm" />
            ))}
          </div>
          <OverallPill value={result.overall} />
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-100 bg-slate-50/60 px-5 pb-5 pt-4">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {/* Left: scores + reasoning */}
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Scores</p>
                <div className="space-y-2.5">
                  {dims.map(([lbl, val]) => (
                    <div key={lbl} className="flex items-center justify-between gap-4">
                      <span className="w-24 text-xs text-slate-500">{lbl}</span>
                      <ScoreBar value={val} />
                    </div>
                  ))}
                  <div className="mt-1 border-t border-slate-100 pt-2.5">
                    <div className="flex items-center justify-between gap-4">
                      <span className="w-24 text-xs font-semibold text-slate-600">Overall</span>
                      <ScoreBar value={result.overall} />
                    </div>
                  </div>
                </div>
              </div>

              {result.reasoning && (
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Judge reasoning</p>
                  <p className="text-xs leading-relaxed text-slate-600 italic">{result.reasoning}</p>
                </div>
              )}

              {actions.length > 0 && (
                <div className="rounded-xl border border-violet-100 bg-violet-50/40 p-4 shadow-sm">
                  <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-violet-500">Proposed actions</p>
                  <div className="flex flex-wrap gap-1.5">
                    {actions.map((action, i) => <ActionBadge key={i} action={action} />)}
                  </div>
                </div>
              )}
            </div>

            {/* Right: emails */}
            <div className="space-y-3">
              {result.ticket_body && (
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 select-none">
                    <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                    Customer email
                  </summary>
                  <div className="mt-2 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-700">{result.ticket_body}</p>
                  </div>
                </details>
              )}

              {result.draft_content && (
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 select-none">
                    <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                    Sona draft
                  </summary>
                  <div className="mt-2 rounded-xl border border-blue-100 bg-blue-50/40 p-3.5 shadow-sm">
                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-700">{result.draft_content}</p>
                  </div>
                </details>
              )}

              {result.human_reply && (
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 select-none">
                    <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                    <span className="flex items-center gap-1.5">
                      Human reply
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200">Zendesk</span>
                    </span>
                  </summary>
                  <div className="mt-2 rounded-xl border border-amber-100 bg-amber-50/40 p-3.5 shadow-sm">
                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-700">{result.human_reply}</p>
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

function RunCard({ run, expanded, onToggle }) {
  const avgs = run.averages;
  const overall = avgs.overall;
  const overallColor =
    overall >= 4 ? "from-emerald-500 to-emerald-400" :
    overall === 3 ? "from-amber-400 to-amber-300" :
    "from-red-400 to-red-300";

  const date = run.created_at
    ? new Date(run.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    : null;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-4 px-5 py-4 text-left"
      >
        {/* Overall score ring */}
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${overallColor} shadow-sm`}>
          <span className="text-sm font-bold text-white">{overall}</span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-sm font-semibold text-slate-800">{run.run_label}</span>
            {date && <span className="shrink-0 text-xs text-slate-400">{date}</span>}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400">
            <span>{run.count} ticket{run.count !== 1 ? "s" : ""}</span>
            <span>·</span>
            <span className="font-mono">{run.model}</span>
          </div>
        </div>

        {/* Mini dim scores */}
        <div className="hidden shrink-0 grid-cols-2 gap-x-4 gap-y-1.5 sm:grid">
          {[["Corr", avgs.correctness], ["Comp", avgs.completeness], ["Tone", avgs.tone], ["Act", avgs.actionability]].map(([abbr, val]) => (
            <div key={abbr} className="flex items-center gap-1.5">
              <span className="w-7 text-[11px] text-slate-400">{abbr}</span>
              <ScoreBar value={val} size="sm" />
            </div>
          ))}
        </div>

        <span className="ml-2 shrink-0 text-slate-300 transition-transform" style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}>
          <ChevronRight className="h-4 w-4" />
        </span>
      </button>

      {expanded && (
        <div className="border-t border-slate-100">
          {run.results.map((r) => <EvalResultRow key={r.id} result={r} />)}
        </div>
      )}
    </div>
  );
}

// ─── Tab toggle ───────────────────────────────────────────────────────────────

function TabToggle({ value, onChange, options }) {
  return (
    <div className="flex items-center gap-0.5 rounded-xl border border-slate-200 bg-slate-50 p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`rounded-lg px-4 py-1.5 text-xs font-medium transition-all ${
            value === opt.value
              ? "bg-white text-slate-800 shadow-sm"
              : "text-slate-400 hover:text-slate-600"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ─── Main EvalPanel ──────────────────────────────────────────────────────────

const EMPTY_EMAIL = () => ({ id: Math.random().toString(36).slice(2), subject: "", body: "" });
const MODELS = ["gpt-4o", "gpt-4o-mini"];

export function EvalPanel({ fullPage = false }) {
  const [mode, setMode] = useState("zendesk");
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
    if (mode === "manual" && !emails.some((e) => e.body.trim())) return;
    if (mode === "zendesk" && selectedZendesk.size === 0) return;

    setRunning(true);
    setRunError(null);
    try {
      const payload = mode === "zendesk"
        ? { zendesk_tickets: zendeskTickets.filter((t) => selectedZendesk.has(t.id)), run_label: runLabel.trim(), model }
        : { emails: emails.filter((e) => e.body.trim()).map((e) => ({ subject: e.subject, body: e.body })), run_label: runLabel.trim(), model };

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

  // ── Input section ──────────────────────────────────────────────────────────
  const inputSection = (
    <div className="space-y-4">
      {mode === "manual" ? (
        <div className="space-y-3">
          {emails.map((email, idx) => (
            <div key={email.id} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">Email {idx + 1}</span>
                {emails.length > 1 && (
                  <button type="button" onClick={() => removeEmail(email.id)} className="text-xs text-slate-400 hover:text-red-500 transition-colors">Remove</button>
                )}
              </div>
              <input
                type="text"
                value={email.subject}
                onChange={(e) => updateEmail(email.id, "subject", e.target.value)}
                placeholder="Subject (optional)"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300"
              />
              <textarea
                value={email.body}
                onChange={(e) => updateEmail(email.id, "body", e.target.value)}
                placeholder="Paste the customer's email here…"
                rows={fullPage ? 7 : 5}
                className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-sm placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300"
              />
            </div>
          ))}
          <button
            type="button"
            onClick={addEmail}
            className="text-xs font-medium text-blue-500 hover:text-blue-600 transition-colors"
          >
            + Add another email
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {loadingZendesk && (
            <div className="flex items-center gap-2 py-4 text-xs text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Fetching tickets from Zendesk…
            </div>
          )}
          {zendeskError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-600">{zendeskError}</div>
          )}
          {!loadingZendesk && !zendeskError && zendeskTickets.length === 0 && (
            <p className="py-4 text-center text-xs text-slate-400">No solved Zendesk tickets found.</p>
          )}
          {zendeskTickets.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">{selectedZendesk.size} of {zendeskTickets.length} selected</span>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setSelectedZendesk(new Set(zendeskTickets.map((t) => t.id)))} className="text-xs font-medium text-blue-500 hover:text-blue-600">All</button>
                  <button type="button" onClick={() => setSelectedZendesk(new Set())} className="text-xs text-slate-400 hover:text-slate-600">None</button>
                  <button type="button" onClick={fetchZendeskTickets} className="text-xs text-slate-400 hover:text-slate-600">Refresh</button>
                </div>
              </div>
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                {zendeskTickets.map((ticket) => (
                  <label key={ticket.id} className="flex cursor-pointer items-start gap-3 border-b border-slate-50 px-4 py-3 last:border-0 hover:bg-slate-50/80 transition-colors">
                    <input
                      type="checkbox"
                      checked={selectedZendesk.has(ticket.id)}
                      onChange={() => toggleZendesk(ticket.id)}
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-blue-500 accent-blue-500"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-slate-700">{ticket.subject || "(no subject)"}</p>
                      <p className="mt-0.5 truncate text-[11px] text-slate-400">{ticket.customer_body?.slice(0, 90)}…</p>
                    </div>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Label + model + run button */}
      <div className="space-y-2.5">
        <div className="flex gap-2">
          <input
            type="text"
            value={runLabel}
            onChange={(e) => setRunLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && canRun && !running && handleRun()}
            placeholder='Label, e.g. "gpt-4o baseline"'
            className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-sm placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300"
          />
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <button
          type="button"
          onClick={handleRun}
          disabled={running || !canRun}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-40"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {running ? "Running eval…" : "Run eval"}
        </button>
        {runError && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{runError}</p>
        )}
      </div>
    </div>
  );

  // ── Results section ────────────────────────────────────────────────────────
  const resultsSection = loadingRuns ? (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-slate-100" />)}
    </div>
  ) : runs.length === 0 ? (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 py-16 text-center">
      <FlaskConical className="mb-3 h-8 w-8 text-slate-200" />
      <p className="text-sm font-medium text-slate-400">No runs yet</p>
      <p className="mt-1 text-xs text-slate-300">Run an eval to see results here</p>
    </div>
  ) : (
    <div className="space-y-3">
      {runs.map((run) => (
        <RunCard
          key={run.run_label}
          run={run}
          expanded={expandedRun === run.run_label}
          onToggle={() => setExpandedRun(expandedRun === run.run_label ? null : run.run_label)}
        />
      ))}
    </div>
  );

  // ── Full page layout ───────────────────────────────────────────────────────
  if (fullPage) {
    return (
      <div className="min-h-screen bg-slate-50/50">
        {/* Page header */}
        <div className="border-b border-slate-200 bg-white px-8 py-5">
          <div className="mx-auto flex max-w-6xl items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100">
                <FlaskConical className="h-4.5 w-4.5 text-slate-500" />
              </div>
              <div>
                <h1 className="text-base font-bold text-slate-900">Draft Quality Eval</h1>
                <p className="text-xs text-slate-400">Full agent pipeline · knowledge retrieval · actions</p>
              </div>
            </div>
            <button
              type="button"
              onClick={fetchRuns}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-500 shadow-sm transition hover:bg-slate-50 hover:text-slate-700"
            >
              <RefreshCw className="h-3 w-3" />
              Refresh
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="mx-auto max-w-6xl px-8 py-8">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[380px_1fr]">

            {/* Left: config panel */}
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-700">New run</p>
                  <TabToggle
                    value={mode}
                    onChange={handleModeChange}
                    options={[{ value: "zendesk", label: "Zendesk" }, { value: "manual", label: "Manual" }]}
                  />
                </div>
                {inputSection}
              </div>
            </div>

            {/* Right: results */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-700">
                  Runs
                  {runs.length > 0 && (
                    <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">{runs.length}</span>
                  )}
                </p>
              </div>
              {resultsSection}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Embedded (FineTuningPanel) ─────────────────────────────────────────────
  return (
    <div className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
        <div className="flex items-center gap-2.5">
          <FlaskConical className="h-4 w-4 text-slate-400" />
          <div>
            <p className="text-sm font-semibold text-slate-800">Draft quality eval</p>
            <p className="text-xs text-slate-400">Score drafts against real tickets using the full pipeline.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <TabToggle
            value={mode}
            onChange={handleModeChange}
            options={[{ value: "zendesk", label: "Zendesk" }, { value: "manual", label: "Manual" }]}
          />
          <Link
            href="/eval"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 shadow-sm transition hover:bg-slate-50 hover:text-slate-700"
          >
            <ExternalLink className="h-3 w-3" />
            Full page
          </Link>
        </div>
      </div>

      {/* Body */}
      <div className="space-y-6 p-6">
        {inputSection}
        {resultsSection}
      </div>
    </div>
  );
}
