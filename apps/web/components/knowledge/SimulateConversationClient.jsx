"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  ChevronRight,
  Inbox,
  Loader2,
  Pencil,
  PlayCircle,
  RotateCcw,
  Search,
  Send,
  User,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ActionCard } from "@/components/inbox/ActionCard";

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

function humanizeActionType(actionType = "") {
  const map = {
    update_shipping_address: "Update Address",
    cancel_order: "Cancel Order",
    refund_order: "Refund Order",
    create_exchange_request: "Create Exchange",
    process_exchange_return: "Process Return",
    fulfill_exchange: "Fulfill Exchange",
    change_shipping_method: "Change Shipping",
    update_customer_contact: "Update Contact",
    send_return_instructions: "Send Return Instructions",
    initiate_return: "Initiate Return",
    forward_email: "Forward Email",
    create_return_case: "Create Return Case",
    add_note: "Add Note",
    add_tag: "Add Tag",
  };
  if (map[actionType]) return map[actionType];
  return String(actionType || "Action")
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-0.5">
      <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-300 [animation-delay:-0.3s]" />
      <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-300 [animation-delay:-0.15s]" />
      <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-300" />
    </div>
  );
}

function MetaPill({ label, value, tone = "gray" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] ring-1 ring-inset ring-black/5",
        tone === "gray" && "bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
        tone === "indigo" && "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400",
        tone === "amber" && "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
        tone === "emerald" && "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
      )}
    >
      {tone !== "gray" && (
        <span
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full",
            tone === "indigo" && "bg-indigo-400",
            tone === "amber" && "bg-amber-400",
            tone === "emerald" && "bg-emerald-400",
          )}
        />
      )}
      <span className="font-medium">{label}</span>
      <span>{value}</span>
    </span>
  );
}

function CustomerBubble({ turn, onEdit, onRemove, isLast }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(turn.text);
  useEffect(() => setDraft(turn.text), [turn.text]);
  return (
    <div className="flex gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500 ring-1 ring-inset ring-gray-200/60 dark:bg-gray-800 dark:text-gray-400 dark:ring-gray-700">
        <User className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10.5px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
            Customer
          </p>
          {!editing && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded p-0.5 text-gray-300 transition-colors hover:text-gray-500"
                title="Edit"
              >
                <Pencil className="h-3 w-3" />
              </button>
              {isLast && (
                <button
                  type="button"
                  onClick={onRemove}
                  className="rounded p-0.5 text-gray-300 transition-colors hover:text-red-400"
                  title="Remove"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
        </div>
        {editing ? (
          <div className="mt-1 space-y-1.5">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12.5px] leading-relaxed text-gray-800 outline-none transition-shadow focus:border-indigo-200 focus:ring-2 focus:ring-indigo-100 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-200 dark:focus:border-indigo-700 dark:focus:ring-indigo-900/50"
            />
            <div className="flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setDraft(turn.text);
                  setEditing(false);
                }}
                className="rounded px-2 py-1 text-[11px] text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onEdit(draft.trim());
                  setEditing(false);
                }}
                className="rounded bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white transition-all hover:bg-indigo-700 active:scale-[0.97]"
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-1 whitespace-pre-wrap rounded-lg bg-gray-50 px-3 py-2.5 text-[12.5px] leading-relaxed text-gray-700 ring-1 ring-inset ring-gray-100/80 dark:bg-gray-800/60 dark:text-gray-200 dark:ring-gray-700/50">
            {turn.text}
          </p>
        )}
      </div>
    </div>
  );
}

function AgentBubble({ turn, onEdit, onAcceptAction, isLast, contextOrderNumber, contextCustomerEmail }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(turn.text);
  useEffect(() => setDraft(turn.text), [turn.text]);
  const meta = turn.meta || {};
  const proposedActions = Array.isArray(meta.proposed_actions) ? meta.proposed_actions : [];
  const acceptedAction = turn.acceptedAction || null;
  return (
    <div className="flex gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-500 ring-1 ring-inset ring-indigo-100 dark:bg-indigo-950/40 dark:text-indigo-400 dark:ring-indigo-800/50">
        <Bot className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10.5px] font-semibold uppercase tracking-widest text-indigo-400 dark:text-indigo-500">
            Sona AI{" "}
            {turn.edited && (
              <span className="font-normal normal-case opacity-60">(edited)</span>
            )}
          </p>
          {!editing && isLast && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded p-0.5 text-gray-300 transition-colors hover:text-gray-500"
              title="Edit before continuing"
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
        </div>
        {editing ? (
          <div className="space-y-1.5">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={Math.min(12, Math.max(3, Math.ceil(draft.length / 70)))}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12.5px] leading-relaxed text-gray-800 outline-none transition-shadow focus:border-indigo-200 focus:ring-2 focus:ring-indigo-100 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-200 dark:focus:border-indigo-700 dark:focus:ring-indigo-900/50"
            />
            <p className="text-[10.5px] text-gray-400 dark:text-gray-500">
              Editing here simulates how an agent would rewrite the draft before sending. The next AI turn will see your edited version.
            </p>
            <div className="flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setDraft(turn.text);
                  setEditing(false);
                }}
                className="rounded px-2 py-1 text-[11px] text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onEdit(draft.trim());
                  setEditing(false);
                }}
                className="rounded bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white transition-all hover:bg-indigo-700 active:scale-[0.97]"
              >
                Save edit
              </button>
            </div>
          </div>
        ) : turn.text ? (
          <p className="whitespace-pre-wrap rounded-lg border border-gray-100 bg-white px-3 py-2.5 text-[12.5px] leading-relaxed text-gray-800 shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:border-gray-800 dark:bg-gray-900/40 dark:text-gray-200">
            {turn.text}
          </p>
        ) : proposedActions.length > 0 ? (
          null
        ) : (
          <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-[11.5px] italic text-gray-400 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-500">
            No draft was generated for this turn.
          </p>
        )}
        {!editing && (meta.intent || meta.routing_hint || typeof meta.confidence === "number" || typeof meta.latency_ms === "number") && (
          <details className="group text-[11px]">
            <summary className="flex cursor-pointer select-none list-none items-center gap-0.5 text-gray-400 transition-colors hover:text-gray-600">
              <ChevronRight className="h-3 w-3 transition-transform duration-150 group-open:rotate-90" />
              <span>Details</span>
            </summary>
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {meta.intent && <MetaPill label="Intent" value={meta.intent} tone="indigo" />}
              {meta.routing_hint && (
                <MetaPill label="Routing" value={meta.routing_hint} tone={meta.routing_hint === "auto" ? "emerald" : "amber"} />
              )}
              {typeof meta.confidence === "number" && (
                <MetaPill label="Confidence" value={`${Math.round(meta.confidence * 100)}%`} />
              )}
              {typeof meta.latency_ms === "number" && (
                <MetaPill label="Latency" value={`${meta.latency_ms}ms`} />
              )}
            </div>
            {Array.isArray(meta.sources) && meta.sources.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 pl-3">
                {meta.sources.slice(0, 6).map((s, i) => (
                  <li key={i} className="truncate text-[10.5px] text-gray-400">
                    · {s.source_label || s.kind || "knowledge"}
                  </li>
                ))}
              </ul>
            )}
            {Array.isArray(meta.provenance?.structured_facts) && meta.provenance.structured_facts.length > 0 && (
              <div className="mt-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600">Structured facts (confirmed)</p>
                <ul className="mt-0.5 space-y-0.5 pl-3">
                  {meta.provenance.structured_facts.slice(0, 8).map((f, i) => (
                    <li key={i} className="text-[10.5px] text-emerald-700">
                      · {f.key}: {f.value} <span className="text-emerald-500/70">({f.origin_table})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {Array.isArray(meta.provenance?.live_facts) && meta.provenance.live_facts.length > 0 && (
              <div className="mt-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-600">Live facts (verified)</p>
                <ul className="mt-0.5 space-y-0.5 pl-3">
                  {meta.provenance.live_facts.slice(0, 8).map((f, i) => (
                    <li key={i} className="text-[10.5px] text-sky-700">
                      · {f.label}: {f.value} <span className="text-sky-500/70">({f.source})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {Array.isArray(meta.provenance?.guardrails_unavailable) && meta.provenance.guardrails_unavailable.length > 0 && (
              <div className="mt-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-orange-600">Guardrails / unavailable</p>
                <ul className="mt-0.5 space-y-0.5 pl-3">
                  {meta.provenance.guardrails_unavailable.slice(0, 8).map((g, i) => (
                    <li key={i} className="text-[10.5px] text-orange-700">
                      · {g.topic}/{g.reason}: {g.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </details>
        )}
        {!editing && proposedActions.length > 0 && (
          <div className="space-y-2">
            {proposedActions.map((action, idx) => {
              const isAccepted = acceptedAction?.action_type === action.type;
              const actionName = humanizeActionType(action.type);
              return (
                <ActionCard
                  key={`${action.type}-${idx}`}
                  status={isAccepted ? "simulated" : "proposed"}
                  actionName={actionName}
                  actionType={action.type}
                  detail={action.reason || ""}
                  payload={action.params || {}}
                  fallbackOrderNumber={contextOrderNumber || ""}
                  customerEmail={contextCustomerEmail || ""}
                  testMode
                  loading={false}
                  approvedAt={isAccepted ? new Date().toISOString() : ""}
                  approvedBy={isAccepted ? "Simulator" : ""}
                  onApprove={isLast && !acceptedAction ? () => onAcceptAction(action) : undefined}
                  onDecline={isLast && !acceptedAction ? () => onAcceptAction({ type: "_declined" }) : undefined}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function TicketPickerDialog({ open, onOpenChange, onPick }) {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [loadingThreadId, setLoadingThreadId] = useState(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setQuery("");
    fetch("/api/knowledge/snippets/preview/threads?limit=30", {
      credentials: "include",
    })
      .then((r) => r.json())
      .then((data) => setThreads(Array.isArray(data?.threads) ? data.threads : []))
      .catch(() => setThreads([]))
      .finally(() => setLoading(false));
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) =>
      `${t.subject} ${t.preview} ${t.customer_email || ""}`
        .toLowerCase()
        .includes(q),
    );
  }, [threads, query]);

  const handlePick = async (thread) => {
    setLoadingThreadId(thread.thread_id);
    try {
      const res = await fetch(
        `/api/knowledge/simulate/load-thread/${encodeURIComponent(thread.thread_id)}`,
        { credentials: "include" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not load thread");
      onPick({
        conversation: Array.isArray(data.conversation) ? data.conversation : [],
        subject: data.subject || thread.subject || "",
        customer_email: data.customer_email || thread.customer_email || "",
        thread_id: thread.thread_id,
        latest_customer_message_id: data.latest_customer_message_id || null,
      });
      onOpenChange(false);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoadingThreadId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] w-[min(92vw,640px)] max-w-none overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="border-b border-gray-100 px-5 py-3.5 dark:border-gray-800">
          <DialogTitle className="flex items-center gap-2 text-[14px] font-semibold">
            <Inbox className="h-4 w-4 text-indigo-500" />
            Load a real ticket to simulate from
          </DialogTitle>
          <DialogDescription className="sr-only">
            Pick a recent inbox ticket to pre-fill the simulator with its conversation history.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[65vh] flex-col">
          <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-2.5 dark:border-gray-800">
            <Search className="h-3.5 w-3.5 text-gray-300 dark:text-gray-600" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search subject, customer, preview..."
              className="flex-1 bg-transparent text-[12px] text-gray-700 placeholder:text-gray-300 outline-none dark:text-gray-300 dark:placeholder:text-gray-600"
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="space-y-1.5 p-3">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-md" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <p className="px-5 py-10 text-center text-[12px] text-gray-400 dark:text-gray-500">
                {query ? "No tickets match your search." : "No tickets found."}
              </p>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {filtered.map((thread) => (
                  <li key={thread.thread_id}>
                    <button
                      type="button"
                      disabled={loadingThreadId !== null}
                      onClick={() => handlePick(thread)}
                      className="group flex w-full flex-col gap-0.5 px-5 py-2.5 text-left transition-colors hover:bg-gray-50 disabled:opacity-50 dark:hover:bg-gray-800/50"
                    >
                      <span className="truncate text-[12.5px] font-medium text-gray-800 dark:text-gray-100">
                        {thread.subject || "(no subject)"}
                      </span>
                      {thread.customer_email && (
                        <span className="truncate text-[11px] text-gray-500 dark:text-gray-400">
                          {thread.customer_email}
                        </span>
                      )}
                      {thread.preview && (
                        <span className="truncate text-[11px] text-gray-400 dark:text-gray-500">
                          {thread.preview}
                        </span>
                      )}
                      {loadingThreadId === thread.thread_id && (
                        <span className="mt-1 inline-flex items-center gap-1 text-[10.5px] text-indigo-600">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Loading conversation...
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SimulateConversationClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const previewDocumentId = String(searchParams.get("preview_document_id") || "").trim();
  const [turns, setTurns] = useState([]);
  const [draftCustomerMessage, setDraftCustomerMessage] = useState("");
  const [subject, setSubject] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [running, setRunning] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [lastError, setLastError] = useState(null);
  const [autoAcceptActions, setAutoAcceptActions] = useState(false);
  const [loadedThread, setLoadedThread] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns, running]);

  const generateReplyWith = useCallback(
    async (allTurns, overrides = {}) => {
      const conversationForApi = allTurns.map((t) => ({
        role: t.role,
        text: t.text,
      }));
      const lastAgentTurn = [...allTurns].reverse().find((t) => t.role === "agent");
      const acceptedAction = lastAgentTurn?.acceptedAction || null;
      const effectiveSubject = overrides.subjectOverride ?? subject;
      const effectiveCustomerEmail =
        (overrides.customerEmailOverride ?? customerEmail).trim();
      const effectiveOrderNumber =
        (overrides.orderNumberOverride ?? orderNumber).trim();
      const effectiveLoadedThread =
        overrides.loadedThreadOverride !== undefined
          ? overrides.loadedThreadOverride
          : loadedThread;
      setRunning(true);
      setLastError(null);
      try {
        console.log("[simulate] sending request", {
          turn_count: conversationForApi.length,
          last_role: conversationForApi[conversationForApi.length - 1]?.role,
          has_action_result: Boolean(acceptedAction),
          has_customer_email: Boolean(effectiveCustomerEmail),
          has_order_number: Boolean(effectiveOrderNumber),
          has_preview_document: Boolean(previewDocumentId),
        });
        const res = await fetch("/api/knowledge/simulate", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation: conversationForApi,
            subject: effectiveSubject || undefined,
            customer_email: effectiveCustomerEmail || undefined,
            order_number: effectiveOrderNumber || undefined,
            ...(previewDocumentId ? { preview_document_id: previewDocumentId } : {}),
            ...(effectiveLoadedThread
              ? {
                  thread_id: effectiveLoadedThread.thread_id,
                  message_id: effectiveLoadedThread.message_id,
                }
              : {}),
            ...(acceptedAction
              ? {
                  action_result: {
                    action_type: acceptedAction.action_type,
                    status: "executed",
                    params: acceptedAction.params || {},
                    simulated: true,
                  },
                }
              : {}),
          }),
        });
        console.log("[simulate] response status", res.status, res.statusText);

        const rawText = await res.text();
        let data;
        try {
          data = JSON.parse(rawText);
        } catch {
          throw new Error(
            `Got non-JSON response (HTTP ${res.status}). First 200 chars: ${rawText.slice(0, 200)}`
          );
        }
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
        const agentTurnId = makeId();
        const agentTurn = {
          id: agentTurnId,
          role: "agent",
          text: data.draft_text || "",
          meta: {
            intent: data.intent,
            routing_hint: data.routing_hint,
            confidence: data.confidence,
            latency_ms: data.latency_ms,
            sources: data.sources || [],
            provenance: data.provenance || null,
            proposed_actions: data.proposed_actions || [],
          },
        };
        setTurns((prev) => [...prev, agentTurn]);

        const proposedActions = Array.isArray(data.proposed_actions)
          ? data.proposed_actions
          : [];
        if (autoAcceptActions && proposedActions.length > 0) {
          const firstAction = proposedActions[0];
          const acceptedAction = {
            action_type: firstAction.type,
            params: firstAction.params || {},
            reason: firstAction.reason || "",
          };
          const turnsWithAccept = [...allTurns, { ...agentTurn, acceptedAction }];
          setTurns(turnsWithAccept);
          await generateReplyWith(turnsWithAccept, {
            ...overrides,
            loadedThreadOverride: null,
          });
        }
      } catch (err) {
        const message = err?.message || "Simulation failed";
        setLastError(message);
        toast.error(message);
      } finally {
        setRunning(false);
      }
    },
    [subject, customerEmail, orderNumber, loadedThread, autoAcceptActions, previewDocumentId]
  );

  const generateReply = useCallback(
    (allTurns) => generateReplyWith(allTurns),
    [generateReplyWith]
  );

  const handleRetry = async () => {
    setLastError(null);
    await generateReply(turns);
  };

  const handleSendCustomer = async () => {
    const text = draftCustomerMessage.trim();
    if (!text) return;
    const customerTurn = { id: makeId(), role: "customer", text };
    const nextTurns = [...turns, customerTurn];
    setTurns(nextTurns);
    setDraftCustomerMessage("");
    setLoadedThread(null);
    await generateReplyWith(nextTurns, { loadedThreadOverride: null });
  };

  const handleReset = () => {
    if (turns.length > 0 && !confirm("Reset the conversation? All turns will be cleared.")) return;
    setTurns([]);
    setDraftCustomerMessage("");
    setLoadedThread(null);
  };

  const handleEditCustomer = (id, newText) => {
    setTurns((prev) =>
      prev.map((t) => (t.id === id ? { ...t, text: newText } : t))
    );
  };

  const handleRemoveCustomer = (id) => {
    setTurns((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx === -1) return prev;
      const next = [...prev];
      next.splice(idx, prev[idx + 1]?.role === "agent" ? 2 : 1);
      return next;
    });
  };

  const handleEditAgent = (id, newText) => {
    setTurns((prev) =>
      prev.map((t) => (t.id === id ? { ...t, text: newText, edited: true } : t))
    );
  };

  const handleAcceptAction = async (id, action) => {
    if (action.type === "_declined") {
      setTurns((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, declinedAction: true } : t,
        ),
      );
      toast.success("Action declined");
      return;
    }

    const acceptedAction = {
      action_type: action.type,
      params: action.params || {},
      reason: action.reason || "",
    };
    const nextTurns = turns.map((t) =>
      t.id === id ? { ...t, acceptedAction } : t,
    );
    setTurns(nextTurns);
    toast.success(`Action "${action.type}" accepted (test mode — nothing executed). Generating follow-up draft...`);

    setLoadedThread(null);
    await generateReplyWith(nextTurns, { loadedThreadOverride: null });
  };

  const handleLoadTicket = async ({
    conversation,
    subject: pickedSubject,
    customer_email: pickedEmail,
    thread_id: pickedThreadId,
    latest_customer_message_id: pickedMessageId,
  }) => {
    if (!Array.isArray(conversation) || conversation.length === 0) {
      toast.error("This ticket has no usable messages.");
      return;
    }
    const seeded = conversation.map((t) => ({
      id: makeId(),
      role: t.role === "agent" ? "agent" : "customer",
      text: t.text,
      ...(t.role === "agent" ? { edited: true, meta: {} } : {}),
    }));
    setTurns(seeded);
    if (pickedSubject) setSubject(pickedSubject);
    const nextEmail = pickedEmail || "";
    if (nextEmail) setCustomerEmail(nextEmail);

    const nextLoadedThread =
      pickedThreadId && pickedMessageId
        ? { thread_id: pickedThreadId, message_id: pickedMessageId }
        : null;
    setLoadedThread(nextLoadedThread);

    toast.success(
      `Loaded ${conversation.length} message${conversation.length === 1 ? "" : "s"} from the ticket.`,
    );
    if (seeded[seeded.length - 1]?.role === "customer") {
      await generateReplyWith(seeded, {
        customerEmailOverride: nextEmail,
        loadedThreadOverride: nextLoadedThread,
      });
    }
  };

  const hasTurns = turns.length > 0;
  const lastTurn = turns[turns.length - 1];
  const waitingForCustomer = lastTurn?.role === "agent" || !hasTurns;

  const effectiveOrderNumberForCard = useMemo(() => {
    const trimmed = orderNumber.trim();
    if (trimmed) return trimmed;
    const match = subject.match(/(?:order|ordre|#)\s*#?\s*(\d{3,10})/i);
    return match ? match[1] : "";
  }, [orderNumber, subject]);

  return (
    <div className="flex h-[calc(100vh-80px)] flex-col">
      {/* Header */}
      <div className="flex items-center gap-4 pb-4">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 transition-transform active:scale-[0.97]"
          onClick={() => router.push("/knowledge")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-[18px] font-semibold tracking-tight text-gray-900 dark:text-gray-100">
            Simulate a conversation
          </h1>
          <p className="mt-0.5 text-[12.5px] text-gray-500 dark:text-gray-400">
            Test how Sona answers as a ticket grows over multiple turns. Edit any reply before continuing to simulate how an agent would intervene.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!hasTurns && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPickerOpen(true)}
              className="gap-1.5 transition-transform active:scale-[0.97]"
            >
              <Inbox className="h-3.5 w-3.5" />
              Load real ticket
            </Button>
          )}
          {hasTurns && (
            <Button variant="outline" size="sm" onClick={handleReset} className="gap-1.5 transition-transform active:scale-[0.97]">
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
          )}
        </div>
      </div>

      {previewDocumentId && (
        <div className="mb-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3.5 py-2 text-[12px] text-indigo-700 dark:border-indigo-800/70 dark:bg-indigo-950/30 dark:text-indigo-300">
          Draft knowledge document preview is active for this simulation only.
        </div>
      )}

      {/* Context strip */}
      <div className="mb-3 overflow-hidden rounded-lg border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900/40 dark:shadow-none">
        <div className="grid grid-cols-1 divide-y divide-gray-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0 dark:divide-gray-800">
          <label className="flex items-center gap-2.5 px-3.5 py-2.5">
            <span className="shrink-0 text-[10.5px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
              Subject
            </span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="(simulated ticket)"
              className="flex-1 bg-transparent text-[12.5px] text-gray-700 placeholder:text-gray-300 outline-none disabled:opacity-50 dark:text-gray-300 dark:placeholder:text-gray-600"
              disabled={hasTurns}
            />
          </label>
          <label className="flex items-center gap-2.5 px-3.5 py-2.5">
            <span className="shrink-0 text-[10.5px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
              Customer
            </span>
            <input
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              placeholder="customer@example.com"
              type="email"
              className="flex-1 bg-transparent text-[12.5px] text-gray-700 placeholder:text-gray-300 outline-none disabled:opacity-50 dark:text-gray-300 dark:placeholder:text-gray-600"
              disabled={hasTurns}
            />
          </label>
          <label className="flex items-center gap-2.5 px-3.5 py-2.5">
            <span className="shrink-0 text-[10.5px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
              Order #
            </span>
            <input
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              placeholder="e.g. 1048 (optional)"
              className="flex-1 bg-transparent text-[12.5px] text-gray-700 placeholder:text-gray-300 outline-none disabled:opacity-50 dark:text-gray-300 dark:placeholder:text-gray-600"
              disabled={hasTurns}
            />
          </label>
        </div>
      </div>

      {/* Options row */}
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <label className="inline-flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={autoAcceptActions}
            onChange={(e) => setAutoAcceptActions(e.target.checked)}
            className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300 text-indigo-600 focus:ring-1 focus:ring-indigo-300 dark:border-gray-600"
          />
          <span className="text-[11.5px] text-gray-600 dark:text-gray-400">
            Auto-accept proposed actions
          </span>
          <span className="text-[10.5px] text-gray-400 dark:text-gray-500">
            (test mode — nothing executes)
          </span>
        </label>
        {!hasTurns && (
          <p className="text-[10.5px] text-gray-400 dark:text-gray-500">
            Tip: provide customer email or order # for accurate Shopify lookups.
          </p>
        )}
      </div>

      {/* Transcript */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-5 overflow-y-auto rounded-xl border border-gray-200/60 bg-white px-5 py-5 shadow-[inset_0_1px_2px_rgba(0,0,0,0.03)] dark:border-gray-800 dark:bg-card dark:shadow-none"
      >
        {!hasTurns && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center animate-in fade-in-0 duration-500">
            <div className="space-y-1">
              <p className="text-[14px] font-semibold text-gray-800 dark:text-gray-100">
                Start a simulated conversation
              </p>
              <p className="max-w-sm text-[12px] leading-relaxed text-gray-400 dark:text-gray-500">
                Write the customer&apos;s first message below, or load a real ticket to replay and extend.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPickerOpen(true)}
              className="mt-1 gap-1.5 transition-transform active:scale-[0.97]"
            >
              <Inbox className="h-3.5 w-3.5" />
              Load a real ticket
            </Button>
          </div>
        )}

        {turns.map((turn, idx) => {
          const isLast = idx === turns.length - 1;
          return (
            <div
              key={turn.id}
              className="animate-in fade-in-0 slide-in-from-bottom-2 duration-200"
            >
              {turn.role === "customer" ? (
                <CustomerBubble
                  turn={turn}
                  isLast={isLast}
                  onEdit={(t) => handleEditCustomer(turn.id, t)}
                  onRemove={() => handleRemoveCustomer(turn.id)}
                />
              ) : (
                <AgentBubble
                  turn={turn}
                  isLast={isLast}
                  contextOrderNumber={effectiveOrderNumberForCard}
                  contextCustomerEmail={customerEmail}
                  onEdit={(t) => handleEditAgent(turn.id, t)}
                  onAcceptAction={(action) => handleAcceptAction(turn.id, action)}
                />
              )}
            </div>
          );
        })}

        {running && (
          <div className="flex gap-3 animate-in fade-in-0 duration-200">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-500 ring-1 ring-inset ring-indigo-100 dark:bg-indigo-950/40 dark:text-indigo-400 dark:ring-indigo-800/50">
              <Bot className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="text-[10.5px] font-semibold uppercase tracking-widest text-indigo-400 dark:text-indigo-500">
                Sona AI
              </p>
              <div className="inline-flex rounded-lg border border-gray-100 bg-white px-3 py-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:border-gray-800 dark:bg-gray-900/40">
                <TypingDots />
              </div>
            </div>
          </div>
        )}

        {!running && lastError && (
          <div className="flex gap-3 animate-in fade-in-0 duration-200">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-500 ring-1 ring-inset ring-red-100 dark:bg-red-950/40 dark:text-red-400 dark:ring-red-800/50">
              <X className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="text-[10.5px] font-semibold uppercase tracking-widest text-red-500 dark:text-red-400">
                Simulation failed
              </p>
              <div className="rounded-lg border border-red-100 bg-red-50/60 px-3 py-2.5 dark:border-red-900/50 dark:bg-red-950/30">
                <p className="text-[12px] text-red-700 dark:text-red-400">{lastError}</p>
                <div className="mt-2 flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={handleRetry} className="gap-1.5 transition-transform active:scale-[0.97]">
                    <RotateCcw className="h-3 w-3" />
                    Retry
                  </Button>
                  <p className="text-[10.5px] text-red-500">
                    If you keep seeing this, restart the dev server: <code className="rounded bg-white px-1 py-0.5">rm -rf .next &amp;&amp; npm run dev</code>
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="mt-3">
        {waitingForCustomer ? (
          <div className="space-y-2">
            <textarea
              value={draftCustomerMessage}
              onChange={(e) => setDraftCustomerMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && draftCustomerMessage.trim()) {
                  e.preventDefault();
                  handleSendCustomer();
                }
              }}
              placeholder={
                hasTurns
                  ? "Write the customer's next message... (Cmd+Enter to send)"
                  : "Write the customer's first message... (Cmd+Enter to send)"
              }
              rows={3}
              className="w-full resize-none rounded-xl border border-gray-200 bg-white px-4 py-3 text-[13px] leading-relaxed text-gray-800 placeholder:text-gray-300 outline-none transition-shadow focus:border-indigo-200 focus:ring-2 focus:ring-indigo-100/80 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-200 dark:placeholder:text-gray-600 dark:focus:border-indigo-700 dark:focus:ring-indigo-900/50"
              disabled={running}
              autoFocus
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={handleSendCustomer}
                disabled={running || !draftCustomerMessage.trim()}
                className="gap-1.5 transition-transform active:scale-[0.97]"
              >
                <Send className="h-3.5 w-3.5" />
                {hasTurns ? "Send next message" : "Send & generate reply"}
              </Button>
            </div>
          </div>
        ) : running ? (
          <p className="px-2 text-[11.5px] text-gray-400">
            Sona is thinking...
          </p>
        ) : (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-indigo-100 bg-indigo-50/40 px-4 py-3 dark:border-indigo-800/50 dark:bg-indigo-950/30">
            <p className="text-[11.5px] text-indigo-700 dark:text-indigo-400">
              The conversation ends on a customer message. Generate Sona&apos;s reply to continue.
            </p>
            <Button
              size="sm"
              onClick={() => generateReply(turns)}
              className="gap-1.5 transition-transform active:scale-[0.97]"
            >
              Generate AI reply
            </Button>
          </div>
        )}
      </div>

      <TicketPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={handleLoadTicket}
      />
    </div>
  );
}

export default SimulateConversationClient;
