"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";
import { useAgentPersonaConfig } from "@/hooks/useAgentPersonaConfig";
import {
  AlertTriangle,
  BookOpen,
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock,
  Loader2,
  Search,
  Settings2,
  Shield,
  User,
  XCircle,
} from "lucide-react";
import { ThreadPickerModal } from "./ThreadPickerModal";
import { EvalPanel } from "./EvalPanel";

const ACTION_MODES = [
  { value: "automatic", label: "Automatic" },
  { value: "approval", label: "Approval flow" },
];

const SHOPIFY_SIGNAL_REGEX =
  /\b(order|adresse|address|refund|return|exchange|cancel|tracking|shipment|shipping)\b/i;

function toDurationLabel(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "—";
  return `${Math.round(numeric)}ms`;
}

function extractSenderName(value) {
  const from = String(value || "").trim();
  if (!from) return "Customer";
  if (from.includes("<")) return from.split("<")[0].trim();
  return from;
}

function getInitials(value) {
  const name = extractSenderName(value);
  const parts = name.split(/\s+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((item) => item[0]?.toUpperCase() || "").join("");
  return initials || "CU";
}

const PlaygroundPanelContext = createContext(null);

export function usePlaygroundPanelActions() {
  const ctx = useContext(PlaygroundPanelContext);
  if (!ctx) {
    throw new Error("usePlaygroundPanelActions must be used inside PlaygroundPanel");
  }
  return ctx;
}

export function PlaygroundPanel({ children }) {
  const { persona, loading, error, refresh, test, testPersona } =
    useAgentPersonaConfig();

  const [actionMode, setActionMode] = useState("automatic");
  const [approvalDecision, setApprovalDecision] = useState(null);
  // Simulation fields — editable, filled by "Pick from inbox" or typed manually
  const [simFrom, setSimFrom] = useState("");
  const [simSubject, setSimSubject] = useState("");
  const [simBody, setSimBody] = useState("");
  const [simThreadId, setSimThreadId] = useState(null); // set when a real ticket is selected
  const [threadPickerOpen, setThreadPickerOpen] = useState(false);
  // Draft result from real pipeline or simplified persona-test
  const [simDraft, setSimDraft] = useState(null);
  const [simPipelineDebug, setSimPipelineDebug] = useState(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState(null);

  const bodyTextareaRef = useRef(null);

  // Auto-resize body textarea whenever content changes
  useEffect(() => {
    const el = bodyTextareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [simBody]);

  const testErrorMessage = useMemo(() => {
    if (!test?.error) return null;
    return test.error instanceof Error ? test.error.message : String(test.error);
  }, [test?.error]);

  const handleRefresh = useCallback(() => refresh().catch(() => null), [refresh]);

  const activeSimulation = useMemo(() => {
    if (!simBody.trim() && !simSubject.trim()) return null;
    return {
      from: simFrom || "customer@example.com",
      subject: simSubject || "(no subject)",
      body: simBody,
      language: null,
      shopifyAction: null,
    };
  }, [simFrom, simSubject, simBody]);

  const simulationToolCalls = useMemo(() => {
    if (Array.isArray(test?.trace?.actions) && test.trace.actions.length > 0) {
      return test.trace.actions
        .map((action) => ({
          tool: String(action?.tool || "").trim(),
          details: String(action?.detail || "Simulation action").trim(),
          durationLabel: toDurationLabel(action?.duration_ms),
        }))
        .filter((action) => action.tool.length > 0);
    }
    if (!activeSimulation?.body) return [];
    const fallback = [
      {
        tool: "write_email_draft_response",
        details: "Draft generated from your saved master prompt.",
        durationLabel: "239ms",
      },
    ];
    const needsShopify =
      Boolean(activeSimulation.shopifyAction) ||
      SHOPIFY_SIGNAL_REGEX.test(`${activeSimulation.subject} ${activeSimulation.body}`);
    if (needsShopify) {
      fallback.push({
        tool: activeSimulation.shopifyAction?.tool || "shopify_update_order_by_id",
        details:
          activeSimulation.shopifyAction?.details || "Order metadata/status changed in Shopify.",
        durationLabel: activeSimulation.shopifyAction?.duration || "384ms",
      });
    }
    fallback.push({
      tool: "update_ticket_by_id",
      details: "Ticket status synced after simulation run.",
      durationLabel: "71ms",
    });
    return fallback;
  }, [activeSimulation, test?.trace?.actions]);

  const traceThought = useMemo(() => {
    const raw = typeof test?.trace?.thought === "string" ? test.trace.thought.trim() : "";
    return raw || "Thought for a few seconds";
  }, [test?.trace?.thought]);

  const toolCallsBeforeReply = useMemo(
    () => simulationToolCalls.filter((call) => call.tool !== "update_ticket_by_id"),
    [simulationToolCalls]
  );

  const finalTicketAction = useMemo(
    () => simulationToolCalls.find((call) => call.tool === "update_ticket_by_id") || null,
    [simulationToolCalls]
  );

  const hasSimulationRun = Boolean(test?.result || simulationToolCalls.length > 0);
  const shopifyActionCall = useMemo(
    () => simulationToolCalls.find((call) => String(call.tool || "").startsWith("shopify_")) || null,
    [simulationToolCalls]
  );
  const requiresApproval = actionMode === "approval" && Boolean(shopifyActionCall);

  const visibleToolCallsBeforeReply = useMemo(() => {
    if (!requiresApproval) return toolCallsBeforeReply;
    return toolCallsBeforeReply.filter((call) => {
      if (call.tool === shopifyActionCall?.tool) return approvalDecision === "approved";
      if (call.tool === "send_email_response") return approvalDecision !== null;
      return true;
    });
  }, [requiresApproval, toolCallsBeforeReply, shopifyActionCall?.tool, approvalDecision]);

  const displayedReply = useMemo(() => {
    // Real pipeline result takes precedence when a real ticket is selected
    if (simThreadId) return simDraft || "";
    if (requiresApproval && approvalDecision === null) return "";
    if (requiresApproval && approvalDecision === "declined") {
      return "Simulation outcome: Shopify action was declined, so the assistant keeps the ticket open and asks for manual follow-up.";
    }
    return test?.result || "";
  }, [simThreadId, simDraft, requiresApproval, approvalDecision, test?.result]);

  const isSimLoading = simThreadId ? simLoading : Boolean(test?.loading);

  const handleRunTest = async () => {
    if (!activeSimulation?.body) return;
    setApprovalDecision(null);
    setSimDraft(null);
    setSimPipelineDebug(null);
    setSimError(null);

    // If a real inbox ticket is selected, use the full v2 pipeline via preview-v2
    if (simThreadId) {
      setSimLoading(true);
      try {
        // Always use eval_mode so the gate is bypassed — the playground is
        // for testing only and should work on any ticket regardless of its state.
        const res = await fetch(`/api/draft/preview-v2`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            thread_id: simThreadId,
            eval_mode: true,
            email_data: {
              subject: simSubject,
              body: simBody,
              from_email: simFrom || undefined,
            },
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Draft generation failed.");
        const text =
          data?.draft_text ||
          (data?.skipped ? `Skipped: ${data?.skip_reason || "no reason given"}` : "");
        setSimDraft(text || "No draft was generated.");
        setSimPipelineDebug({
          sources: data?.sources || [],
          confidence: data?.confidence ?? null,
          routing_hint: data?.routing_hint || null,
          intent: data?.intent || null,
          knowledge_gaps: data?.knowledge_gaps || [],
          latency_ms: data?.latency_ms || null,
        });
      } catch (err) {
        setSimError(err instanceof Error ? err.message : "Draft generation failed.");
      } finally {
        setSimLoading(false);
      }
      return;
    }

    testPersona({
      scenario: activeSimulation.body,
      ticketSubject: activeSimulation.subject,
      customerFrom: activeSimulation.from,
      instructions: persona?.instructions || "",
      signature: "",
      emailLanguage: null,
    }).catch(() => null);
  };

  const contextValue = useMemo(
    () => ({
      refresh: handleRefresh,
      loading,
    }),
    [handleRefresh, loading]
  );

  return (
    <PlaygroundPanelContext.Provider value={contextValue}>
      {children || null}
      <Card className="overflow-hidden border-0 bg-white shadow-none">
        <CardContent className="bg-white">
          <div className="space-y-5">
            {/* The playground tests the saved master prompt; editing happens in the agent settings */}
            <div className="flex flex-col gap-2 rounded-2xl border border-slate-100 bg-slate-50/60 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-foreground">Playground</p>
                <p className="text-xs text-muted-foreground">
                  Test how the agent responds to a real or made-up ticket using your saved configuration. Editing the prompt happens in the agent settings.
                </p>
              </div>
              <Link
                href="/persona"
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-input bg-background px-3 text-xs font-medium text-slate-600 shadow-sm transition hover:bg-slate-50"
              >
                <Settings2 className="h-3.5 w-3.5" />
                Edit master prompt
              </Link>
            </div>
            {error && (
              <p className="text-sm text-destructive">
                {error.message ?? "Could not load configuration."}
              </p>
            )}

            {/* Ticket simulation */}
            <aside className="overflow-hidden rounded-2xl border border-gray-200 bg-sidebar shadow-sm">
              <div className="flex items-center gap-2 border-b border-gray-100 bg-sidebar px-4 py-2 text-xs font-medium text-slate-600">
                <Shield className="h-3.5 w-3.5 text-slate-500" />
                Simulation mode — no real-world impact. The AI will not send emails or update live orders.
              </div>

              <div className="flex items-center gap-2 border-b border-gray-100 bg-sidebar px-4 py-3">
                <button
                  type="button"
                  onClick={() => setThreadPickerOpen(true)}
                  className="inline-flex h-9 flex-1 items-center gap-2 rounded-lg border border-input bg-background px-3 text-xs font-medium text-slate-500 shadow-sm transition hover:bg-slate-50"
                >
                  <Search className="h-3.5 w-3.5 text-muted-foreground" />
                  {activeSimulation?.subject
                    ? <span className="truncate text-slate-800">{activeSimulation.subject}</span>
                    : <span>Pick a ticket from your inbox…</span>}
                </button>
                <select
                  value={actionMode}
                  onChange={(event) => {
                    setActionMode(event.target.value);
                    setApprovalDecision(null);
                  }}
                  className="h-9 rounded-lg border border-input bg-background px-3 text-xs font-medium text-slate-600 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  {ACTION_MODES.map((mode) => (
                    <option key={mode.value} value={mode.value}>
                      {mode.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleRunTest}
                  disabled={isSimLoading || !activeSimulation?.body}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white transition hover:bg-black disabled:opacity-50"
                >
                  {isSimLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {isSimLoading ? "Simulating" : "Simulate"}
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {(testErrorMessage || simError) && (
                  <div className="px-4 pt-3">
                    <p className="text-xs text-destructive">{simError || testErrorMessage}</p>
                  </div>
                )}

                <div className="flex flex-col">
                    {/* Thread header — editable subject */}
                    <div className="border-b border-gray-100 px-5 py-4">
                      <input
                        type="text"
                        value={simSubject}
                        onChange={(e) => { setSimSubject(e.target.value); setSimDraft(null); setSimPipelineDebug(null); setSimThreadId(null); }}
                        placeholder="Subject line..."
                        className="w-full bg-transparent text-xl font-semibold tracking-tight text-slate-900 placeholder:text-slate-300 focus:outline-none"
                      />
                      <div className="mt-2 flex items-center gap-2">
                        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                          Open
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-500">
                          <User className="h-3 w-3" />
                          Unassigned
                        </span>
                      </div>
                    </div>

                    {/* Messages feed */}
                    <div className="space-y-3 px-5 py-4">

                      {/* Customer message bubble — editable body */}
                      <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">
                            {simFrom ? getInitials(simFrom) : "C"}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-800">{extractSenderName(simFrom) || "Customer"}</p>
                            <p className="text-xs text-muted-foreground">{simFrom || ""}</p>
                          </div>
                        </div>
                        <textarea
                          ref={bodyTextareaRef}
                          value={simBody}
                          onChange={(e) => { setSimBody(e.target.value); setSimDraft(null); setSimPipelineDebug(null); setSimThreadId(null); }}
                          placeholder="Write the customer's message here, or pick a ticket from your inbox…"
                          style={{ minHeight: "80px", overflow: "hidden" }}
                          className="mt-3 w-full resize-none bg-transparent text-sm leading-relaxed text-slate-700 placeholder:text-slate-300 focus:outline-none"
                        />
                      </div>

                      {/* Shopify approval card (if applicable) */}
                      {requiresApproval && hasSimulationRun ? (
                        <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
                          <p className="text-xs font-semibold text-amber-700">Awaiting approval</p>
                          <p className="mt-1 text-sm text-slate-700">
                            Sona proposes: <code className="rounded bg-amber-100 px-1 text-xs">{shopifyActionCall?.tool}</code>
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">{shopifyActionCall?.details}</p>
                          {approvalDecision === null ? (
                            <div className="mt-3 flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setApprovalDecision("approved")}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => setApprovalDecision("declined")}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-100"
                              >
                                <XCircle className="h-3.5 w-3.5" />
                                Decline
                              </button>
                            </div>
                          ) : (
                            <div className="mt-3 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium text-slate-600">
                              {approvalDecision === "approved" ? (
                                <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />Approved in simulation</>
                              ) : (
                                <><XCircle className="h-3.5 w-3.5 text-red-600" />Declined in simulation</>
                              )}
                            </div>
                          )}
                        </div>
                      ) : null}

                      {/* Sona reply bubble — matches the outbound draft style in inbox */}
                      <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 px-4 py-3 shadow-sm">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100">
                            <Bot className="h-3.5 w-3.5 text-indigo-600" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-indigo-700">Sona</p>
                            <p className="text-xs text-muted-foreground">Draft</p>
                          </div>
                        </div>
                        <div className="mt-3 min-h-[100px] text-sm leading-relaxed text-slate-700">
                          {isSimLoading ? (
                            <div className="space-y-2">
                              <div className="h-3.5 w-3/4 animate-pulse rounded bg-indigo-100" />
                              <div className="h-3.5 w-full animate-pulse rounded bg-indigo-100" />
                              <div className="h-3.5 w-11/12 animate-pulse rounded bg-indigo-100" />
                              <div className="h-3.5 w-1/2 animate-pulse rounded bg-indigo-100" />
                            </div>
                          ) : displayedReply ? (
                            <p className="whitespace-pre-wrap">{displayedReply}</p>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              {requiresApproval && hasSimulationRun
                                ? "Approve or decline the action above to continue."
                                : "Press Simulate to generate a draft response."}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Pipeline trace — shown after a real v2 run */}
                      {simPipelineDebug && !isSimLoading && (
                        <PipelineTrace debug={simPipelineDebug} />
                      )}

                    </div>
                  </div>
              </div>
            </aside>
          </div>
        </CardContent>
      </Card>
      <EvalPanel />
      <ThreadPickerModal
        open={threadPickerOpen}
        onOpenChange={setThreadPickerOpen}
        onSelect={(ticket) => {
          setSimFrom(ticket.from || "");
          setSimSubject(ticket.subject || "");
          setSimBody(ticket.body || "");
          setSimThreadId(ticket.id || null);
          setApprovalDecision(null);
          setSimDraft(null);
          setSimPipelineDebug(null);
          setSimError(null);
        }}
      />
    </PlaygroundPanelContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const USABLE_AS_META = {
  policy:       { label: "Policy",           color: "bg-red-50 text-red-700 border-red-200" },
  procedure:    { label: "Procedure",        color: "bg-blue-50 text-blue-700 border-blue-200" },
  fact:         { label: "FAQ / Product info", color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  tone_example: { label: "Tone example",     color: "bg-purple-50 text-purple-700 border-purple-200" },
  background:   { label: "Background",       color: "bg-slate-100 text-slate-600 border-slate-200" },
  saved_reply:  { label: "Saved reply",      color: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  ignore:       { label: "Ignored",          color: "bg-slate-100 text-slate-400 border-slate-200" },
};

const INTENT_LABELS = {
  return: "Return",
  refund: "Refund",
  exchange: "Exchange",
  tracking: "Tracking",
  cancel: "Cancel",
  warranty: "Warranty",
  complaint: "Complaint",
  technical_support: "Tech support",
  product_question: "Product question",
  address_change: "Address change",
  thanks: "Thanks",
  other: "Other",
};

function PipelineTrace({ debug }) {
  const { sources = [], confidence, routing_hint, intent, knowledge_gaps = [], latency_ms } = debug;
  const [expanded, setExpanded] = useState(new Set());

  function toggle(i) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  const confidencePct = confidence != null ? Math.round(confidence * 100) : null;
  const confidenceColor =
    confidencePct == null ? "text-slate-400" :
    confidencePct >= 80 ? "text-emerald-600" :
    confidencePct >= 60 ? "text-amber-600" :
    "text-red-600";

  const routingStyle =
    routing_hint === "auto"   ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
    routing_hint === "review" ? "bg-amber-50 text-amber-700 border-amber-200" :
    routing_hint === "block"  ? "bg-red-50 text-red-700 border-red-200" :
    "bg-slate-100 text-slate-600 border-slate-200";

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500">Pipeline trace</span>
          {intent && (
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-700">
              {INTENT_LABELS[intent] ?? intent}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {confidencePct != null && (
            <span className={`text-xs font-semibold ${confidenceColor}`}>
              {confidencePct}% confidence
            </span>
          )}
          {routing_hint && (
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${routingStyle}`}>
              {routing_hint}
            </span>
          )}
          {latency_ms != null && (
            <span className="flex items-center gap-1 text-xs text-slate-400">
              <Clock className="h-3 w-3" />
              {(latency_ms / 1000).toFixed(1)}s
            </span>
          )}
        </div>
      </div>

      {/* Sources */}
      <div className="p-3">
        <p className="mb-2 flex items-center gap-1 text-xs font-medium text-slate-500">
          <BookOpen className="h-3.5 w-3.5" />
          Sources retrieved ({sources.length})
        </p>
        {sources.length === 0 ? (
          <p className="text-xs text-slate-400 italic">No knowledge chunks retrieved for this ticket.</p>
        ) : (
          <div className="space-y-1.5">
            {sources.map((src, i) => {
              const tag = USABLE_AS_META[src.usable_as] ?? { label: src.usable_as || "—", color: "bg-slate-100 text-slate-500 border-slate-200" };
              const isOpen = expanded.has(i);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => toggle(i)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left shadow-sm transition hover:border-slate-300 hover:shadow-none"
                >
                  <div className="flex items-center gap-2">
                    <ChevronRight
                      className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${isOpen ? "rotate-90" : ""}`}
                    />
                    <p className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700">
                      {src.source_label || "Unknown source"}
                    </p>
                    <span className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${tag.color}`}>
                      {tag.label}
                    </span>
                  </div>
                  {isOpen && src.content && (
                    <p className="mt-2 border-t border-slate-100 pt-2 text-xs leading-relaxed text-slate-500">
                      {src.content}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Knowledge gaps */}
      {knowledge_gaps.length > 0 && (
        <div className="border-t border-slate-200 p-3">
          <p className="mb-2 flex items-center gap-1 text-xs font-medium text-amber-600">
            <AlertTriangle className="h-3.5 w-3.5" />
            Knowledge gaps ({knowledge_gaps.length})
          </p>
          <div className="space-y-1.5">
            {knowledge_gaps.map((gap, i) => (
              <div key={i} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-xs font-semibold text-amber-800">{gap.suggested_title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-amber-700">{gap.suggested_content_hint}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

