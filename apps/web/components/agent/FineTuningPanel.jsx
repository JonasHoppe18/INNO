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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useAgentPersonaConfig } from "@/hooks/useAgentPersonaConfig";
import {
  Bold,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Heading1,
  Heading2,
  Heading3,
  Inbox,
  Italic,
  Link2,
  List,
  Loader2,
  Play,
  Quote,
  RefreshCw,
  Search,
  Shield,
  Underline,
  User,
  XCircle,
} from "lucide-react";
import { ThreadPickerModal } from "./ThreadPickerModal";

const TOOLBAR_BUTTONS = [
  { icon: Bold, label: "Bold" },
  { icon: Italic, label: "Italic" },
  { icon: Underline, label: "Underline" },
  { icon: List, label: "List" },
  { icon: Heading1, label: "H1" },
  { icon: Heading2, label: "H2" },
  { icon: Heading3, label: "H3" },
  { icon: Link2, label: "Link" },
  { icon: Quote, label: "Quote" },
];
const MODEL_OPTIONS = ["gpt-4o-mini", "gpt-4o"];
const ACTION_MODES = [
  { value: "automatic", label: "Automatic" },
  { value: "approval", label: "Approval flow" },
];

const SHOPIFY_SIGNAL_REGEX =
  /\b(order|adresse|address|refund|return|exchange|cancel|tracking|shipment|shipping)\b/i;

const DEFAULT_INSTRUCTIONS = `TONE OG STIL — gælder på alle sprog:

Åbning (kun første svar i en tråd):
Start altid med en kort, varm indledning på kundens sprog. Tak kunden for at henvende sig og vis empati for problemet. Eksempel på dansk: "Tak fordi du kontakter os. Vi er kede af at høre, at du oplever problemer med [produkt]." — tilpas til kundens sprog og skriv altid indledningen på samme sprog som kunden.
Gå direkte til løsning efter indledningen — skriv aldrig kundens problem om med egne ord.

Opfølgningssvar (kunden har allerede skrevet):
Spring indledningen over — gå direkte til sagen.

Afslutning — vurdér altid situationen og skriv på kundens sprog:
- Konkrete trin givet, afventer resultat: "Jeg ser frem til at høre fra dig."
- Problemet løst eller ombytning aftalt: "God dag!"
- Frustreret kunde eller lang ventetid: "Undskyld for ulejligheden og tak for din tålmodighed."

Kontekstbevidsthed:
Læs altid kundens besked grundigt igennem, inden du beder om yderligere information. Bed aldrig kunden om noget, de allerede har givet — hvis de skriver at de har vedhæftet billeder, skal du ikke bede om billeder. Hvis de allerede har beskrevet problemet i detaljer, skal du ikke bede dem om at uddybe.`;

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

const FineTuningPanelContext = createContext(null);

export function useFineTuningPanelActions() {
  const ctx = useContext(FineTuningPanelContext);
  if (!ctx) {
    throw new Error("useFineTuningPanelActions must be used inside FineTuningPanel");
  }
  return ctx;
}

export function FineTuningPanel({ children }) {
  const { persona, loading, saving, error, save, refresh, test, testPersona } =
    useAgentPersonaConfig();

  const [instructions, setInstructions] = useState("");
  const [dirty, setDirty] = useState(false);

  const [selectedModel, setSelectedModel] = useState("gpt-4o-mini");
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

  useEffect(() => {
    setInstructions(persona?.instructions || DEFAULT_INSTRUCTIONS);
    setDirty(false);
  }, [persona?.instructions]);


  const handleChange = (event) => {
    setInstructions(event.target.value);
    setDirty(true);
  };

  const handleSave = useCallback(() => {
    save({ instructions })
      .then(() => setDirty(false))
      .catch(() => null);
  }, [instructions, save]);

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
        details: "Draft generated from current fine-tuning instructions.",
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
    setSimError(null);

    // If a real inbox ticket is selected, use the full generate-draft pipeline
    if (simThreadId) {
      setSimLoading(true);
      try {
        const res = await fetch(`/api/threads/${simThreadId}/generate-draft`, {
          method: "POST",
          credentials: "include",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Draft generation failed.");
        const text =
          data?.draft?.rendered_body_text ||
          data?.draft?.body_text ||
          (data?.skipped ? `Skipped: ${data?.reason || "no reason given"}` : "");
        setSimDraft(text || "No draft was generated.");
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
      instructions,
      signature: "",
      model: selectedModel,
      emailLanguage: null,
    }).catch(() => null);
  };

  const contextValue = useMemo(
    () => ({
      refresh: handleRefresh,
      save: handleSave,
      loading,
      saving,
      dirty,
    }),
    [handleRefresh, handleSave, loading, saving, dirty]
  );

  return (
    <FineTuningPanelContext.Provider value={contextValue}>
      {children || null}
      <Card className="overflow-hidden border-0 bg-white shadow-none">
        <CardContent className="bg-white">
          <div className="grid items-stretch gap-8 lg:grid-cols-2">
            {/* Left column: Instructions first, advanced shop context second */}
            <div className="space-y-5">
              <EditorField
                label="Instructions"
                description="Describe how the AI should behave, open and close its replies, and what it can promise. The AI understands context — you can write conditional rules."
                value={instructions}
                onChange={handleChange}
                selectedModel={selectedModel}
                onSelectedModelChange={setSelectedModel}
                placeholder={`Examples:
- Start first replies by thanking the customer for reaching out and showing empathy for their issue.
- Close with "I look forward to hearing from you" when the issue is still being troubleshot, and "Have a great day!" when a solution has been given.
- Never promise a refund without first checking the order date.
- Always sign off with the agent's first name only.`}
                rows={24}
              />
              {error && (
                <p className="text-sm text-destructive">
                  {error.message ?? "Could not load or save instructions."}
                </p>
              )}
            </div>

            {/* Right column: Ticket simulation */}
            <aside className="overflow-hidden rounded-2xl border border-gray-200 bg-sidebar shadow-sm lg:sticky lg:top-6 lg:min-h-[760px]">
              <div className="flex items-center gap-2 border-b border-gray-100 bg-sidebar px-4 py-2 text-xs font-medium text-slate-600">
                <Shield className="h-3.5 w-3.5 text-slate-500" />
                Simulation mode — no real-world impact. The AI will not send emails or update live orders.
                {dirty && (
                  <span className="ml-auto text-amber-600">Save instructions first to include changes in simulation.</span>
                )}
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
                        onChange={(e) => { setSimSubject(e.target.value); setSimDraft(null); setSimThreadId(null); }}
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
                          onChange={(e) => { setSimBody(e.target.value); setSimDraft(null); setSimThreadId(null); }}
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

                    </div>
                  </div>
              </div>
            </aside>
          </div>
        </CardContent>
      </Card>
      {dirty ? (
        <div className="fixed bottom-4 right-6 z-50 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-lg">
          <span className="text-xs text-slate-600">Unsaved changes</span>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-black disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      ) : null}
      <EvalSection />
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
          setSimError(null);
        }}
      />
    </FineTuningPanelContext.Provider>
  );
}

// ─── Eval Panel ──────────────────────────────────────────────────────────────

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

function EvalResultRow({ result }) {
  const [open, setOpen] = useState(false);
  const label = result.ticket_subject || (result.thread_id ? result.thread_id.slice(0, 8) + "…" : "Email");
  return (
    <div className="border-b last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-xs hover:bg-slate-50 transition-colors"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <span className="flex-1 truncate font-medium text-slate-700">{label}</span>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="text-muted-foreground">Overall</span>
          <ScoreBadge value={result.overall} />
        </div>
      </button>
      {open && (
        <div className="bg-slate-50 px-4 pb-3 pt-1 text-xs space-y-2">
          <div className="flex flex-wrap gap-3">
            {[["Correctness", result.correctness], ["Completeness", result.completeness], ["Tone", result.tone], ["Actionability", result.actionability]].map(([lbl, val]) => (
              <div key={lbl} className="flex items-center gap-1.5">
                <span className="text-muted-foreground">{lbl}</span>
                <ScoreBadge value={val} />
              </div>
            ))}
          </div>
          {result.reasoning && <p className="text-slate-600 italic">{result.reasoning}</p>}
          {result.ticket_body && (
            <details>
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Customer email</summary>
              <p className="mt-1 whitespace-pre-wrap rounded border bg-white p-2 text-slate-700">{result.ticket_body}</p>
            </details>
          )}
          {result.draft_content && (
            <details>
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Draft</summary>
              <p className="mt-1 whitespace-pre-wrap rounded border bg-white p-2 text-slate-700">{result.draft_content}</p>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

const EMPTY_EMAIL = () => ({ id: Math.random().toString(36).slice(2), subject: "", body: "" });
const MODELS = ["gpt-4o", "gpt-4o-mini"];

function EvalSection() {
  const [mode, setMode] = useState("manual"); // "manual" | "zendesk"
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

  return (
    <Card className="mt-8 overflow-hidden border bg-white shadow-sm">
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-semibold text-foreground">Draft quality eval</p>
            <p className="text-xs text-muted-foreground">Score Sona's drafts against real Zendesk tickets or pasted emails.</p>
          </div>
        </div>
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

      <CardContent className="space-y-6 pt-5">
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
                rows={4}
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
        <div className="flex gap-2">
          <input
            type="text"
            value={runLabel}
            onChange={(e) => setRunLabel(e.target.value)}
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

        {/* Results */}
        {loadingRuns ? (
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
                  <div className="flex items-center gap-2">
                    {expandedRun === run.run_label ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                    <span className="text-sm font-semibold text-slate-800">{run.run_label}</span>
                    <span className="text-xs text-muted-foreground">{run.count} email{run.count !== 1 ? "s" : ""} · {run.model}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
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
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function EditorField({
  label,
  description,
  value,
  onChange,
  placeholder,
  rows = 5,
  selectedModel,
  onSelectedModelChange,
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      {(label || description) && (
        <div className="border-b border-gray-200 px-4 py-3">
          {label ? <p className="text-sm font-semibold text-foreground">{label}</p> : null}
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
      )}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {TOOLBAR_BUTTONS.map(({ icon: Icon, label: buttonLabel }) => (
              <span
                key={buttonLabel}
                className="inline-flex h-7 min-w-7 items-center justify-center rounded-md border border-transparent px-1.5 text-muted-foreground"
                role="presentation"
                aria-hidden="true"
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
            ))}
          </div>
          <select
            value={selectedModel}
            onChange={(event) => onSelectedModelChange(event.target.value)}
            className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs font-medium text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            {MODEL_OPTIONS.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </div>
        <Textarea
          value={value}
          onChange={onChange}
          rows={rows}
          className="min-h-[760px] resize-y border-0 bg-transparent px-4 py-4 text-sm leading-relaxed text-slate-800 focus-visible:ring-2 focus-visible:ring-blue-500/30 focus-visible:ring-offset-2"
          placeholder={placeholder}
        />
      </div>
    </div>
  );
}
