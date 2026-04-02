"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

const SIMULATION_PRESETS = [
  {
    id: "shopify-address-change",
    label: "Address update (Shopify action)",
    from: "Maja Jensen <maja.jensen@example.com>",
    subject: "Can you update my delivery address?",
    body:
      "Hi team,\n\nI just placed order #19428, but I entered the wrong apartment number.\nCan you update the shipping address to:\nNørrebrogade 18, 4. th\n2200 Copenhagen N\n\nThanks!",
    language: "English",
    status: "Open",
    shopifyAction: {
      tool: "shopify_update_order_shipping_address",
      details: "Order #19428 updated with corrected apartment number.",
      duration: "412ms",
    },
  },
  {
    id: "refund-policy",
    label: "Refund policy question",
    from: "Lucas Madsen <lucas.madsen@example.com>",
    subject: "What is your return window?",
    body:
      "Hey,\n\nBefore I place an order, can you confirm how many days I have to return an item?\n\nBest,\nLucas",
    language: "English",
    status: "Open",
    shopifyAction: null,
  },
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
  const [brandDescription, setBrandDescription] = useState("");
  const [supportIdentity, setSupportIdentity] = useState("");
  const [shopContextModalOpen, setShopContextModalOpen] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Generated email state
  const [generatedEmail, setGeneratedEmail] = useState(null);
  const [generatingEmail, setGeneratingEmail] = useState(false);
  const [generateError, setGenerateError] = useState(null);
  const [selectedSimulationId, setSelectedSimulationId] = useState("shopify-address-change");
  const [simulationVariant, setSimulationVariant] = useState("Simulation 3");
  const [selectedModel, setSelectedModel] = useState("gpt-4o-mini");
  const [actionMode, setActionMode] = useState("automatic");
  const [approvalDecision, setApprovalDecision] = useState(null);

  const testErrorMessage = useMemo(() => {
    if (!test?.error) return null;
    return test.error instanceof Error ? test.error.message : String(test.error);
  }, [test?.error]);

  useEffect(() => {
    setInstructions(persona?.instructions ?? "");
    setBrandDescription(persona?.brand_description ?? "");
    setSupportIdentity(persona?.support_identity ?? "");
    setDirty(false);
  }, [persona?.instructions, persona?.brand_description, persona?.support_identity]);


  const handleChange = (event) => {
    setInstructions(event.target.value);
    setDirty(true);
  };

  const handleSave = useCallback(() => {
    save({ instructions, brand_description: brandDescription, support_identity: supportIdentity })
      .then(() => setDirty(false))
      .catch(() => null);
  }, [instructions, brandDescription, supportIdentity, save]);

  const handleRefresh = useCallback(() => refresh().catch(() => null), [refresh]);

  const handleGenerateEmail = async () => {
    setGeneratingEmail(true);
    setGenerateError(null);
    try {
      const response = await fetch("/api/fine-tuning/generate-email", {
        method: "POST",
        credentials: "include",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Could not generate email.");
      }
      setGeneratedEmail(data);
      setSelectedSimulationId("generated");
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Could not generate email.");
    } finally {
      setGeneratingEmail(false);
    }
  };

  const activeSimulation = useMemo(() => {
    if (selectedSimulationId === "generated") {
      if (!generatedEmail?.body) return null;
      return {
        id: "generated",
        label: "Generated ticket",
        from: generatedEmail.from || "Customer",
        subject: generatedEmail.subject || "Customer request",
        body: generatedEmail.body || "",
        language: generatedEmail.language || null,
        status: "Open",
        shopifyAction: null,
      };
    }
    return SIMULATION_PRESETS.find((item) => item.id === selectedSimulationId) || null;
  }, [selectedSimulationId, generatedEmail]);

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
    if (requiresApproval && approvalDecision === null) return "";
    if (requiresApproval && approvalDecision === "declined") {
      return "Simulation outcome: Shopify action was declined, so the assistant keeps the ticket open and asks for manual follow-up.";
    }
    return test?.result || "";
  }, [requiresApproval, approvalDecision, test?.result]);

  const handleRunTest = () => {
    if (!activeSimulation?.body) return;
    setApprovalDecision(null);
    testPersona({
      scenario: activeSimulation.body,
      ticketSubject: activeSimulation.subject,
      customerFrom: activeSimulation.from,
      instructions,
      signature: "",
      model: selectedModel,
      emailLanguage: activeSimulation.language ?? null,
    }).catch(() => null);
  };

  const contextValue = useMemo(
    () => ({
      refresh: handleRefresh,
      save: handleSave,
      loading,
      saving,
      dirty,
      openShopContext: () => setShopContextModalOpen(true),
      shopName: persona?.shop_name || "",
    }),
    [handleRefresh, handleSave, loading, saving, dirty, persona?.shop_name]
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
              </div>

              <div className="flex items-center gap-2 border-b border-gray-100 bg-sidebar px-4 py-3">
                <div className="relative flex-1 min-w-[190px]">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <select
                    value={selectedSimulationId}
                    onChange={(event) => setSelectedSimulationId(event.target.value)}
                    className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  >
                    {SIMULATION_PRESETS.map((simulation) => (
                      <option key={simulation.id} value={simulation.id}>
                        {simulation.label}
                      </option>
                    ))}
                    <option value="generated" disabled={!generatedEmail?.body}>
                      {generatedEmail?.body ? "Generated ticket" : "Generated ticket (create first)"}
                    </option>
                  </select>
                </div>
                <select
                  value={simulationVariant}
                  onChange={(event) => setSimulationVariant(event.target.value)}
                  className="h-9 rounded-lg border border-input bg-background px-3 text-xs font-medium text-slate-600 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  <option>Simulation 1</option>
                  <option>Simulation 2</option>
                  <option>Simulation 3</option>
                </select>
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
                  disabled={test?.loading || !activeSimulation?.body}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white transition hover:bg-black disabled:opacity-50"
                >
                  {test?.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {test?.loading ? "Simulating" : "Simulate"}
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-[900px] space-y-4 px-4 pb-4 pt-3">
                {generateError ? <p className="text-xs text-destructive">{generateError}</p> : null}
                {testErrorMessage ? <p className="text-xs text-destructive">{testErrorMessage}</p> : null}
                <button
                  type="button"
                  onClick={handleGenerateEmail}
                  disabled={generatingEmail}
                  className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-500 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  {generatingEmail ? "Generating ticket…" : "Generate ticket from shop data"}
                </button>

                {activeSimulation ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-3xl font-semibold tracking-tight text-slate-900">{activeSimulation.subject}</h3>
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                          Open
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">
                          <User className="h-3 w-3" />
                          Unassigned
                        </span>
                      </div>
                    </div>

                    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_0_rgba(0,0,0,0.05),0_4px_6px_-1px_rgba(0,0,0,0.02)]">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                          {getInitials(activeSimulation.from)}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-700">{extractSenderName(activeSimulation.from)}</p>
                          <p className="text-xs text-muted-foreground">2d ago</p>
                        </div>
                      </div>
                      <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{activeSimulation.body}</p>
                    </div>

                    {requiresApproval && hasSimulationRun ? (
                      <div className="rounded-xl border border-slate-200 bg-white p-4">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Shopify approval
                        </p>
                        <p className="mt-2 text-sm text-slate-700">
                          Sona proposes: <code>{shopifyActionCall?.tool}</code>
                        </p>
                        <p className="mt-1 text-xs text-slate-500">{shopifyActionCall?.details}</p>
                        {approvalDecision === null ? (
                          <div className="mt-3 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setApprovalDecision("approved")}
                              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => setApprovalDecision("declined")}
                              className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              Decline
                            </button>
                          </div>
                        ) : (
                          <div className="mt-3 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium text-slate-700">
                            {approvalDecision === "approved" ? (
                              <>
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                                Approved in simulation
                              </>
                            ) : (
                              <>
                                <XCircle className="h-3.5 w-3.5 text-red-600" />
                                Declined in simulation
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    ) : null}

                    <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4 shadow-[0_1px_2px_0_rgba(0,0,0,0.05),0_4px_6px_-1px_rgba(0,0,0,0.02)]">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-indigo-700">
                          <Bot className="h-4 w-4" />
                        </div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-indigo-700">Sona</p>
                          <span className="text-xs text-muted-foreground">Just now</span>
                        </div>
                      </div>
                      <div className="mt-3 min-h-[120px] text-sm text-slate-700">
                        {test?.loading ? (
                          <div className="space-y-2">
                            <div className="h-3.5 w-2/3 animate-pulse rounded bg-slate-200" />
                            <div className="h-3.5 w-full animate-pulse rounded bg-slate-200" />
                            <div className="h-3.5 w-11/12 animate-pulse rounded bg-slate-200" />
                          </div>
                        ) : displayedReply ? (
                          <p className="whitespace-pre-wrap">{displayedReply}</p>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            {requiresApproval && hasSimulationRun
                              ? "Approve or decline the Shopify action to continue the simulated flow."
                              : "Click \"Simulate\" to run this ticket with your current instructions."}
                          </p>
                        )}
                      </div>
                    </div>

                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Select a preset ticket or generate one from your shop context to start simulation.
                  </p>
                )}
                </div>
              </div>
            </aside>
          </div>
        </CardContent>
      </Card>
      <Dialog open={shopContextModalOpen} onOpenChange={setShopContextModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Shop Context</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Used as background context for tone and brand consistency. Keep it concise.
            </p>
            {persona?.shop_name && (
              <div>
                <p className="mb-0.5 text-xs font-medium text-muted-foreground">Shop name</p>
                <p className="text-sm font-semibold text-slate-800">{persona.shop_name}</p>
              </div>
            )}
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Brand description</p>
              <textarea
                value={brandDescription}
                onChange={(e) => { setBrandDescription(e.target.value); setDirty(true); }}
                rows={3}
                placeholder={persona?.shop_name ? `${persona.shop_name} er en dansk webshop...` : "Beskriv hvad jeres shop sælger og til hvem."}
                className="w-full resize-y rounded-lg border border-input bg-white px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Support identity</p>
              <textarea
                value={supportIdentity}
                onChange={(e) => { setSupportIdentity(e.target.value); setDirty(true); }}
                rows={4}
                placeholder={`Du er en del af ${persona?.shop_name || "[shop]"}'s supportteam. Du ER supporten — henvis aldrig kunden videre.`}
                className="w-full resize-y rounded-lg border border-input bg-white px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
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
      {false && <EvalSection />}
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
  const [emails, setEmails] = useState([EMPTY_EMAIL()]);
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

  const addEmail = () => setEmails((prev) => [...prev, EMPTY_EMAIL()]);
  const removeEmail = (id) => setEmails((prev) => prev.filter((e) => e.id !== id));
  const updateEmail = (id, field, value) =>
    setEmails((prev) => prev.map((e) => e.id === id ? { ...e, [field]: value } : e));

  const handleRun = async () => {
    const validEmails = emails.filter((e) => e.body.trim());
    if (!runLabel.trim() || validEmails.length === 0) return;
    setRunning(true);
    setRunError(null);
    try {
      const res = await fetch("/api/eval/run", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emails: validEmails.map((e) => ({ subject: e.subject, body: e.body })),
          run_label: runLabel.trim(),
          model,
        }),
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

  const hasValidEmails = emails.some((e) => e.body.trim());

  return (
    <Card className="mt-8 overflow-hidden border bg-white shadow-sm">
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-semibold text-foreground">Draft quality eval</p>
            <p className="text-xs text-muted-foreground">Paste customer emails, run them through the AI, and get a quality score (1–5) on correctness, completeness, tone and actionability.</p>
          </div>
        </div>
      </div>

      <CardContent className="space-y-6 pt-5">
        {/* Email inputs */}
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
            disabled={running || !runLabel.trim() || !hasValidEmails}
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
