"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronRight,
  ExternalLink,
  FlaskConical,
  Loader2,
  Play,
  Trash2,
  Zap,
  CheckCircle2,
  XCircle,
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
    value >= 9 ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
    value >= 7 ? "bg-amber-50 text-amber-700 border-amber-200" :
    "bg-red-50 text-red-600 border-red-200";
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-semibold tabular-nums ${variant}`}>
      {value}/10
    </span>
  );
}

function ScoreBar({ label, value }) {
  if (value == null) return null;
  const pct = Math.round((value / 10) * 100);
  const color =
    value >= 9 ? "bg-emerald-500" :
    value >= 7 ? "bg-amber-400" :
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

function scoreTone(value) {
  if (value == null) {
    return {
      border: "border-border",
      bg: "bg-muted/30",
      text: "text-muted-foreground",
      label: "Not scored",
    };
  }
  if (value >= 9) {
    return {
      border: "border-emerald-200",
      bg: "bg-emerald-50",
      text: "text-emerald-700",
      label: "Send-ready",
    };
  }
  if (value >= 7) {
    return {
      border: "border-amber-200",
      bg: "bg-amber-50",
      text: "text-amber-700",
      label: "Needs polish",
    };
  }
  return {
    border: "border-red-200",
    bg: "bg-red-50",
    text: "text-red-600",
    label: "Needs work",
  };
}

function QualitySummary({ dims, overall }) {
  const tone = scoreTone(overall);
  return (
    <div className={`rounded-xl border ${tone.border} ${tone.bg} p-3`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quality</p>
          <p className={`mt-1 text-3xl font-semibold tabular-nums ${tone.text}`}>{overall ?? "—"}</p>
        </div>
        <Badge variant="outline" className={`bg-background text-[10px] ${tone.text}`}>
          {tone.label}
        </Badge>
      </div>
      <div className="space-y-2 rounded-lg border bg-background/80 p-3">
        {dims.map(([lbl, val]) => (
          <ScoreBar key={lbl} label={lbl} value={val} />
        ))}
      </div>
    </div>
  );
}

// ─── Action badge ─────────────────────────────────────────────────────────────

const ACTION_LABELS = {
  cancel_order:             "Cancel order",
  refund:                   "Refund",
  refund_order:             "Refund order",
  update_shipping_address:  "Update address",
  send_return_instructions: "Return instructions",
  create_exchange_request:  "Create exchange",
  exchange:                 "Exchange",
  hold_fulfillment:         "Hold fulfillment",
  initiate_return:          "Initiate return",
  add_note:                 "Add note",
  add_tag:                  "Add tag",
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

function score10(result, key) {
  if (key === "overall" && typeof result.overall_10 === "number") {
    return result.overall_10;
  }
  const value = result[key];
  if (typeof value !== "number") return null;
  return Math.max(1, Math.min(10, Math.round(value * 2)));
}

function persistedActionDecision(result) {
  const stored = result?.action_decision && typeof result.action_decision === "object"
    ? result.action_decision
    : null;
  const decision = String(stored?.decision || "").toLowerCase();
  if (decision !== "approved" && decision !== "rejected") return null;
  return stored;
}

function EvalActionPreview({ action, result, onQualityUpdate }) {
  const initialDecision = persistedActionDecision(result);
  const [decisionState, setDecisionState] = useState(initialDecision?.decision || "proposed");
  const [decisionLoading, setDecisionLoading] = useState(false);
  const [decisionError, setDecisionError] = useState(null);
  const [postActionReply, setPostActionReply] = useState(String(result?.post_action_reply || "").trim());
  const [simulationNote, setSimulationNote] = useState(String(initialDecision?.simulated_internal_note || "").trim());
  const actionType = String(action?.type || "");
  const actionName = ACTION_LABELS[actionType] || "Review action";
  const payload = action?.params && typeof action.params === "object" ? action.params : {};
  const orderName = payload.order_name || payload.order_number || payload.orderNumber || "";
  const isApproved = decisionState === "approved";
  const isRejected = decisionState === "rejected";
  const resultId = result?.id;
  const resultActionDecision = result?.action_decision;
  const resultPostActionReply = result?.post_action_reply;
  const resultPostActionDecidedAt = result?.post_action_decided_at;

  useEffect(() => {
    const stored = persistedActionDecision({
      action_decision: resultActionDecision,
      post_action_reply: resultPostActionReply,
    });
    setDecisionState(stored?.decision || "proposed");
    setPostActionReply(String(resultPostActionReply || "").trim());
    setSimulationNote(String(stored?.simulated_internal_note || "").trim());
  }, [resultId, resultActionDecision, resultPostActionDecidedAt, resultPostActionReply]);

  const decide = async (nextDecision) => {
    setDecisionLoading(true);
    setDecisionError(null);
    try {
      const res = await fetch("/api/eval/action-decision", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eval_result_id: resultId || "",
          decision: nextDecision,
          action,
          subject: result?.ticket_subject || "",
          ticket_body: result?.ticket_body || "",
          human_reply: result?.human_reply || "",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not simulate action decision");
      const storedDecision = data?.action_decision && typeof data.action_decision === "object"
        ? data.action_decision
        : {
          decision: nextDecision,
          action,
          test_mode: true,
          simulated_internal_note: data?.simulated_internal_note || "",
          decided_at: data?.decided_at || new Date().toISOString(),
        };
      const reply = String(data?.reply || "").trim();
      const note = String(storedDecision?.simulated_internal_note || data?.simulated_internal_note || "").trim();
      setDecisionState(storedDecision?.decision || nextDecision);
      setPostActionReply(reply);
      setSimulationNote(note);
      onQualityUpdate?.({
        ...(data?.quality ? {
          ...data.quality,
          reasoning: data.quality.reasoning || `Scored after ${nextDecision} action preview.`,
        } : {}),
        action_decision: storedDecision,
        post_action_reply: reply,
        post_action_quality: data?.quality || null,
        post_action_decided_at: data?.decided_at || storedDecision?.decided_at || null,
      });
    } catch (err) {
      setDecisionError(err.message);
    } finally {
      setDecisionLoading(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border bg-background shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b bg-muted/25 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          {isApproved ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          ) : isRejected ? (
            <XCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <Zap className="h-4 w-4 shrink-0 text-violet-600" />
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{actionName}</p>
            <p className="text-xs text-muted-foreground">
              Test simulation · {action?.requires_approval ? "approval required" : "no approval required"}
            </p>
          </div>
        </div>
        <Badge variant={isApproved ? "default" : isRejected ? "secondary" : "outline"} className="shrink-0 text-[10px]">
          {isApproved ? "Approved test" : isRejected ? "Rejected" : "Awaiting review"}
        </Badge>
      </div>
      <div className="space-y-3 p-3">
        <div className={`rounded-lg border p-3 ${
          isApproved
            ? "border-emerald-200 bg-emerald-50/60"
            : isRejected
              ? "border-border bg-muted/40"
              : "border-violet-200 bg-violet-50/40"
        }`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{actionName}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {action?.reason || "Review the proposed action before generating the final customer reply."}
              </p>
            </div>
            {orderName ? (
              <Badge variant="outline" className="shrink-0 bg-background text-[10px]">
                {String(orderName).startsWith("#") ? orderName : `#${orderName}`}
              </Badge>
            ) : null}
          </div>
          {!isApproved && !isRejected ? (
            <div className="mt-3 flex justify-end gap-2 border-t pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => decide("rejected")}
                disabled={decisionLoading}
              >
                Reject
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => decide("approved")}
                disabled={decisionLoading}
                className="bg-violet-600 text-white hover:bg-violet-700"
              >
                {decisionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                Approve
              </Button>
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
              {isApproved ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <XCircle className="h-3.5 w-3.5" />}
              {isApproved ? "Approved in eval. Shopify was not mutated." : "Rejected in eval. No action was taken."}
            </div>
          )}
        </div>

        <div className="grid gap-2 rounded-lg border bg-muted/20 p-2 text-xs sm:grid-cols-3">
          <div>
            <p className="text-muted-foreground">Confidence</p>
            <p className="font-medium">{action?.confidence || "unknown"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Approval</p>
            <p className="font-medium">{action?.requires_approval ? "Required" : "Not required"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Action type</p>
            <p className="font-mono text-[11px]">{actionType}</p>
          </div>
        </div>
        {decisionError && <p className="text-xs text-destructive">{decisionError}</p>}
        {postActionReply && (
          <div className="rounded-xl border bg-card p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Customer reply preview
              </p>
              <Badge variant="outline" className="text-[10px]">
                after {isRejected ? "reject" : "approve"}
              </Badge>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{postActionReply}</p>
            {simulationNote && (
              <p className="mt-3 rounded-md bg-muted/70 px-2 py-1.5 text-xs text-muted-foreground">
                {simulationNote}
              </p>
            )}
          </div>
        )}
        {Object.keys(payload).length > 0 && (
          <details className="rounded-md border bg-card p-2 text-xs">
            <summary className="cursor-pointer select-none font-medium text-muted-foreground">
              Action payload
            </summary>
            <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 font-mono text-[11px] text-muted-foreground">
              {JSON.stringify(payload, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}

// ─── Result row ───────────────────────────────────────────────────────────────

function EvalResultRow({ result }) {
  const [open, setOpen] = useState(false);
  const [displayResult, setDisplayResult] = useState(result);
  const label = displayResult.ticket_subject || (displayResult.thread_id ? `Thread ${displayResult.thread_id.slice(0, 8)}…` : "Email");
  const actions = Array.isArray(displayResult.proposed_actions) ? displayResult.proposed_actions : [];
  const sources = Array.isArray(displayResult.sources) ? displayResult.sources : [];
  const confidence = typeof displayResult.verifier_confidence === "number" ? displayResult.verifier_confidence : null;
  const dims = [
    ["Correctness",   score10(displayResult, "correctness")],
    ["Completeness",  score10(displayResult, "completeness")],
    ["Tone",          score10(displayResult, "tone")],
    ["Actionability", score10(displayResult, "actionability")],
    ["Overall",       score10(displayResult, "overall")],
  ];
  const missingFor10 = Array.isArray(displayResult.missing_for_10) ? displayResult.missing_for_10 : [];
  const overall10 = score10(displayResult, "overall");

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
        {confidence != null && (
          <Badge variant="outline" className="shrink-0 text-[10px]">
            {Math.round(confidence * 100)}%
          </Badge>
        )}
        {displayResult.send_ready === true && (
          <Badge className="shrink-0 bg-emerald-600 text-[10px] text-white hover:bg-emerald-600">
            Send-ready
          </Badge>
        )}
        <ScoreBadge value={overall10} />
      </div>

      {open && (
        <div className="border-t bg-muted/20 px-4 pb-4 pt-3">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,720px)_minmax(320px,1fr)]">
            {/* Left: scores */}
            <div className="space-y-3">
              <QualitySummary dims={dims} overall={overall10} />

              {displayResult.reasoning && (
                <div className="rounded-xl border bg-card p-3">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Judge note</p>
                  <p className="text-sm leading-relaxed text-foreground">{displayResult.reasoning}</p>
                </div>
              )}

              {(displayResult.primary_gap || displayResult.likely_root_cause || missingFor10.length > 0) && (
                <div className="rounded-xl border bg-card p-3 text-xs">
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    {displayResult.likely_root_cause && (
                      <Badge variant="outline" className="text-[10px]">
                        root: {displayResult.likely_root_cause}
                      </Badge>
                    )}
                    {displayResult.primary_gap && (
                      <Badge variant="secondary" className="text-[10px]">
                        gap: {displayResult.primary_gap}
                      </Badge>
                    )}
                  </div>
                  {missingFor10.length > 0 && (
                    <div className="space-y-1">
                      <p className="font-semibold text-foreground">Missing for 10/10</p>
                      {missingFor10.map((item, index) => (
                        <p key={`${item}-${index}`} className="text-muted-foreground">- {item}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {actions.length > 0 && (
                <div className="space-y-2 rounded-xl border bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">Action simulation</p>
                      <p className="text-xs text-muted-foreground">Approve or reject in eval without changing Shopify.</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {actions.map((a, i) => <ActionBadge key={i} action={a} />)}
                    </div>
                  </div>
                  {actions.map((action, index) => (
                    <EvalActionPreview
                      key={`${action.type || "action"}-${index}`}
                      action={action}
                      result={displayResult}
                      onQualityUpdate={(quality) =>
                        setDisplayResult((current) => ({
                          ...current,
                          ...quality,
                        }))
                      }
                    />
                  ))}
                </div>
              )}

              {(confidence != null || displayResult.routing_hint || displayResult.latency_ms) && (
                <div className="grid grid-cols-3 gap-2 text-xs">
                  {confidence != null && (
                    <div className="rounded-md border bg-card p-2">
                      <p className="text-muted-foreground">Verifier</p>
                      <p className="font-medium tabular-nums">{Math.round(confidence * 100)}%</p>
                    </div>
                  )}
                  {displayResult.routing_hint && (
                    <div className="rounded-md border bg-card p-2">
                      <p className="text-muted-foreground">Routing</p>
                      <p className="font-medium">{displayResult.routing_hint}</p>
                    </div>
                  )}
                  {displayResult.latency_ms != null && (
                    <div className="rounded-md border bg-card p-2">
                      <p className="text-muted-foreground">Latency</p>
                      <p className="font-medium tabular-nums">{Math.round(displayResult.latency_ms / 100) / 10}s</p>
                    </div>
                  )}
                </div>
              )}

              {sources.length > 0 && (
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground select-none">
                    <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                    Sources used
                  </summary>
                  <div className="mt-1.5 space-y-1.5">
                    {sources.map((source, i) => (
                      <div key={`${source.source_label || "source"}-${i}`} className="rounded-md border bg-card p-2">
                        <div className="mb-1 flex items-center gap-1.5">
                          <Badge variant="outline" className="text-[10px] py-0">{source.kind || "source"}</Badge>
                          <p className="truncate text-xs font-medium">{source.source_label || `Source ${i + 1}`}</p>
                        </div>
                        <p className="line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                          {source.content}
                        </p>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>

            {/* Right: content */}
            <div className="space-y-2">
              {displayResult.ticket_body && (
                <details className="group rounded-xl border bg-card p-3" open>
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground select-none">
                    <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                    Customer email
                  </summary>
                  <div className="mt-2 max-h-60 overflow-auto rounded-lg bg-muted/30 p-3">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{displayResult.ticket_body}</p>
                  </div>
                </details>
              )}

              {displayResult.draft_content && (
                <details className="group rounded-xl border bg-card p-3">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground select-none">
                    <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                    Sona draft
                  </summary>
                  <div className="mt-2 max-h-60 overflow-auto rounded-lg bg-muted/30 p-3">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{displayResult.draft_content}</p>
                  </div>
                </details>
              )}

              {displayResult.human_reply && (
                <details className="group rounded-xl border bg-card p-3">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground select-none">
                    <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                    <span className="flex items-center gap-1.5">
                      Human reply
                      <Badge variant="outline" className="text-[10px] py-0">Zendesk</Badge>
                    </span>
                  </summary>
                  <div className="mt-2 max-h-60 overflow-auto rounded-lg bg-muted/30 p-3">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{displayResult.human_reply}</p>
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

  const overall = typeof run.averages.overall_10 === "number"
    ? run.averages.overall_10
    : Math.round((run.averages.overall || 0) * 2);
  const scoreColor =
    overall >= 9 ? "text-emerald-700 bg-emerald-50 border-emerald-200" :
    overall >= 7 ? "text-amber-700 bg-amber-50 border-amber-200" :
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
              {run.count} ticket{run.count !== 1 ? "s" : ""} · {run.send_ready_count ?? 0} send-ready · <span className="font-mono">{run.model}</span>
              {run.pipeline_version === "v2" && (
                <span className="inline-flex items-center rounded border border-violet-200 bg-violet-50 px-1.5 py-0 text-[10px] font-semibold text-violet-700">V2</span>
              )}
              {run.created_at && ` · ${new Date(run.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
            </p>
          </div>
          <div className="hidden shrink-0 items-center gap-4 sm:flex">
            {[
              ["Corr", (run.averages.correctness || 0) * 2],
              ["Comp", (run.averages.completeness || 0) * 2],
              ["Tone", (run.averages.tone || 0) * 2],
              ["Act", (run.averages.actionability || 0) * 2],
            ].map(([abbr, val]) => (
              <div key={abbr} className="text-center">
                <p className="text-xs font-medium tabular-nums">{Math.round(val * 10) / 10}</p>
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
const MODEL_OPTIONS = [
  { value: "gpt-4o-mini", label: "GPT-4o Mini" },
  { value: "gpt-4o", label: "GPT-4o" },
  { value: "gpt-5-mini", label: "GPT-5 Mini" },
  { value: "gpt-5-nano", label: "GPT-5 Nano" },
];
const EVAL_BATCH_SIZE = 5;
const modelLabel = (value) => MODEL_OPTIONS.find((item) => item.value === value)?.label || value;
const chunkArray = (items, size) => {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
};

export function EvalPanel({ fullPage = false }) {
  const [mode, setMode] = useState("examples");
  const [emails, setEmails] = useState([EMPTY_EMAIL()]);
  const [ticketExamples, setTicketExamples] = useState([]);
  const [selectedExamples, setSelectedExamples] = useState(new Set());
  const [loadingExamples, setLoadingExamples] = useState(false);
  const [examplesError, setExamplesError] = useState(null);
  const [zendeskTickets, setZendeskTickets] = useState([]);
  const [selectedZendesk, setSelectedZendesk] = useState(new Set());
  const [loadingZendesk, setLoadingZendesk] = useState(false);
  const [zendeskError, setZendeskError] = useState(null);
  const [runLabel, setRunLabel] = useState("");
  const [model, setModel] = useState("gpt-4o-mini");
  const [disableEscalation, setDisableEscalation] = useState(false);
  const [running, setRunning] = useState(false);
  const [runProgress, setRunProgress] = useState(null);
  const [runError, setRunError] = useState(null);
  const [runErrors, setRunErrors] = useState([]);
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

  const fetchTicketExamples = async () => {
    setLoadingExamples(true);
    setExamplesError(null);
    try {
      const res = await fetch("/api/eval/ticket-examples?limit=120", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to fetch ticket examples");
      setTicketExamples(data?.examples ?? []);
      setSelectedExamples(new Set((data?.examples ?? []).map((t) => t.id)));
    } catch (err) {
      setExamplesError(err.message);
    } finally {
      setLoadingExamples(false);
    }
  };

  useEffect(() => {
    fetchTicketExamples();
  }, []);

  const fetchZendeskTickets = async () => {
    setLoadingZendesk(true);
    setZendeskError(null);
    try {
      const res = await fetch("/api/eval/zendesk-tickets?limit=120", { credentials: "include" });
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
    if (next === "examples" && ticketExamples.length === 0) fetchTicketExamples();
  };

  const toggleExample = (id) => setSelectedExamples((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

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
    setRunProgress(null);
    setRunError(null);
    setRunErrors([]);
    const currentRunLabel = runLabel.trim();
    try {
      const basePayload = {
        run_label: currentRunLabel,
        model,
        strong_model: "gpt-5",
        judge_model: "gpt-4o-mini",
        disable_escalation: disableEscalation,
        pipeline: "v2",
      };
      const selectedItems = mode === "zendesk"
        ? zendeskTickets.filter((t) => selectedZendesk.has(t.id))
        : mode === "examples"
          ? ticketExamples.filter((t) => selectedExamples.has(t.id))
          : emails.filter((e) => e.body.trim()).map((e) => ({ subject: e.subject, body: e.body }));
      const chunks = chunkArray(selectedItems, EVAL_BATCH_SIZE);
      let totalScored = 0;
      const allErrors = [];

      for (let index = 0; index < chunks.length; index += 1) {
        setRunProgress({ current: index + 1, total: chunks.length, scored: totalScored });
        const payload = mode === "manual"
          ? { ...basePayload, emails: chunks[index] }
          : { ...basePayload, zendesk_tickets: chunks[index] };
        const res = await fetch("/api/eval/run", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || `Eval failed on batch ${index + 1}/${chunks.length}`);
        }
        totalScored += Number(data?.scored || 0);
        if (Array.isArray(data?.errors) && data.errors.length > 0) {
          allErrors.push(...data.errors);
        }
      }
      setRunProgress({ current: chunks.length, total: chunks.length, scored: totalScored });
      await fetchRuns();
      setExpandedRun(currentRunLabel);
      setRunLabel("");
      if (allErrors.length > 0) {
        setRunErrors(allErrors);
        const firstError = allErrors[0];
        const firstLabel = firstError?.subject || firstError?.thread_id || "Ticket";
        setRunError(`${allErrors.length} ticket${allErrors.length === 1 ? "" : "s"} failed, ${totalScored} were scored. First error: ${firstLabel}: ${firstError?.error || "Unknown error"}`);
      }
    } catch (err) {
      setRunError(err.message);
    } finally {
      setRunning(false);
      setRunProgress(null);
    }
  };

  const canRun = runLabel.trim() && (
    (mode === "manual" && emails.some((e) => e.body.trim())) ||
    (mode === "examples" && selectedExamples.size > 0) ||
    (mode === "zendesk" && selectedZendesk.size > 0)
  );

  // ── Input section ────────────────────────────────────────────────────────
  const inputSection = (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div className="flex rounded-lg border bg-muted p-1 text-xs">
        {[["examples", "Examples"], ["zendesk", "Zendesk"], ["manual", "Manual"]].map(([val, label]) => (
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
      ) : mode === "examples" ? (
        <div className="space-y-2">
          {loadingExamples && (
            <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Fetching ticket examples…
            </div>
          )}
          {examplesError && <p className="text-xs text-destructive">{examplesError}</p>}
          {!loadingExamples && !examplesError && ticketExamples.length === 0 && (
            <p className="py-3 text-xs text-muted-foreground">No ticket examples found.</p>
          )}
          {ticketExamples.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{selectedExamples.size} of {ticketExamples.length} selected</span>
                <div className="flex gap-2 text-xs">
                  <button type="button" onClick={() => setSelectedExamples(new Set(ticketExamples.map((t) => t.id)))} className="text-muted-foreground hover:text-foreground">All</button>
                  <button type="button" onClick={() => setSelectedExamples(new Set())} className="text-muted-foreground hover:text-foreground">None</button>
                  <button type="button" onClick={fetchTicketExamples} className="text-muted-foreground hover:text-foreground">Refresh</button>
                </div>
              </div>
              <div className="max-h-[420px] overflow-y-auto rounded-lg border divide-y">
                {ticketExamples.map((ticket) => (
                  <label key={ticket.id} className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-muted/40 transition-colors">
                    <input
                      type="checkbox"
                      checked={selectedExamples.has(ticket.id)}
                      onChange={() => toggleExample(ticket.id)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary cursor-pointer"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <p className="truncate text-xs font-medium">{ticket.subject || "(no subject)"}</p>
                        {ticket.intent && <Badge variant="outline" className="shrink-0 text-[10px] py-0">{ticket.intent}</Badge>}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{ticket.customer_body?.slice(0, 90)}…</p>
                    </div>
                  </label>
                ))}
              </div>
            </>
          )}
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
        <div className="space-y-2">
          <Input
            value={runLabel}
            onChange={(e) => setRunLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && canRun && !running && handleRun()}
            placeholder={`Label, e.g. "${modelLabel(model)} smoke"`}
            className="flex-1 text-sm"
          />
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODEL_OPTIONS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <label className="flex items-start gap-2 rounded-lg border bg-muted/20 p-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={!disableEscalation}
              onChange={(e) => setDisableEscalation(!e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
            />
            <span>
              <span className="block font-medium text-foreground">Use production retry</span>
              <span>Runs the same strong-model fallback as the ticket flow when verifier confidence is low.</span>
            </span>
          </label>
        </div>
        <Button
          onClick={handleRun}
          disabled={running || !canRun}
          className="w-full"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {running && runProgress
            ? `Running batch ${runProgress.current}/${runProgress.total}…`
            : running
              ? "Running…"
              : "Run ticket simulation"}
        </Button>
        {running && runProgress && (
          <p className="text-xs text-muted-foreground">
            {runProgress.scored} scored so far. Large runs are processed in batches of {EVAL_BATCH_SIZE}.
          </p>
        )}
        {runError && <p className="text-xs text-destructive">{runError}</p>}
        {runErrors.length > 0 && (
          <div className="max-h-48 overflow-auto rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
            {runErrors.map((item, index) => (
              <div key={`${item.subject || item.thread_id || "error"}-${index}`} className="border-b border-destructive/10 py-1 last:border-0">
                <p className="font-medium text-destructive">{item.subject || item.thread_id || `Ticket ${index + 1}`}</p>
                <p className="break-words text-destructive/80">{item.error || "Unknown error"}</p>
              </div>
            ))}
          </div>
        )}
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
      <div className="flex h-screen flex-col overflow-hidden bg-muted/10">
        {/* Body — two panes that fill remaining height */}
        <div className="flex min-h-0 flex-1">
          {/* Left: results */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-5">
            <div className="mx-auto flex w-full max-w-[1180px] flex-col">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-base font-semibold">Eval runs</p>
                <p className="text-xs text-muted-foreground">Review model quality, proposed actions, and post-approval replies.</p>
              </div>
              {runs.length > 0 && (
                <span className="rounded-full border bg-background px-2 py-0.5 text-xs text-muted-foreground">{runs.length}</span>
              )}
            </div>
            {resultsSection}
            </div>
          </div>

          {/* Right: config sidebar */}
          <div className="hidden w-[390px] shrink-0 overflow-y-auto border-l bg-background px-5 py-5 lg:block">
            <div className="mb-4">
              <p className="text-base font-semibold">New run</p>
              <p className="text-xs text-muted-foreground">Select tickets, choose model, run simulation.</p>
            </div>
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
