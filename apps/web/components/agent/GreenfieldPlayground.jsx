"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Bot,
  ChevronDown,
  Database,
  Inbox,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function formatTime(value) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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

function actionLabel(value) {
  return String(value || "Action")
    .split("_")
    .map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : part)
    .join(" ");
}

function TraceDetails({ trace }) {
  const [open, setOpen] = useState(false);
  if (!trace) return null;
  const toolCalls = Array.isArray(trace.events) ? trace.events.filter((event) => event.type === "tool_call") : [];
  const providerResults = Array.isArray(trace.provider_results) ? trace.provider_results : [];
  const simulatedActions = Array.isArray(trace.simulated_actions) ? trace.simulated_actions : [];
  return (
    <div className="mt-2 rounded-lg border border-gray-100 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.03)] dark:border-gray-800 dark:bg-gray-900/40 dark:shadow-none">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[11px] font-medium text-gray-500 transition-colors hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800/50"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <Database className="h-3.5 w-3.5" aria-hidden="true" />
          Developer trace
          <span className="font-normal">{toolCalls.length} tool call{toolCalls.length === 1 ? "" : "s"}</span>
        </span>
        <ChevronDown className={`h-3.5 w-3.5 ${open ? "rotate-180" : ""} transition-transform`} aria-hidden="true" />
      </button>
      {open ? (
        <div className="flex flex-col gap-3 border-t border-gray-100 p-3 text-xs dark:border-gray-800">
          <div className="grid gap-2 sm:grid-cols-3">
            <TraceMetric label="Runtime" value={trace.runtime || "@openai/agents"} />
            <TraceMetric label="Latency" value={trace.latency_ms == null ? "—" : `${trace.latency_ms}ms`} />
            <TraceMetric label="Availability" value={trace.availability_state || "Not used"} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <TraceMetric label="Order focus" value={trace.order_focus?.verified_order_number || trace.order_focus?.requested_order_id || "Unbound"} />
            <TraceMetric label="Provider" value={providerResults.map((item) => item.provider).filter(Boolean).join(", ") || "Not used"} />
          </div>
          {simulatedActions.length ? (
            <div className="rounded-md border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold uppercase tracking-[0.12em] text-amber-800 dark:text-amber-300">Simulated action</p>
                <span className="rounded border border-amber-300 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:border-amber-800 dark:text-amber-300">DRY RUN</span>
              </div>
              {simulatedActions.map((action, index) => (
                <div key={`${action.action}-${index}`} className="mt-2 space-y-2 border-t border-amber-200 pt-2 text-amber-900 dark:border-amber-900/60 dark:text-amber-200">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <TraceMetric label="Action" value={actionLabel(action.action)} />
                    <TraceMetric label="Target" value={action.target?.order_id ? `#${action.target.order_id}` : "Not specified"} />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <TraceMetric label="Validation" value={action.validation_status || "—"} />
                    <TraceMetric label="Would execute" value={action.would_execute ? "Yes" : "No"} />
                    <TraceMetric label="Executed" value="NO — PLAYGROUND SIMULATION" />
                  </div>
                  <div className="rounded border border-amber-200/70 bg-white/50 p-2 dark:border-amber-900/50 dark:bg-amber-950/10">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em]">Arguments</p>
                    <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words text-[11px]">{JSON.stringify(action.arguments || {}, null, 2)}</pre>
                  </div>
                  {Array.isArray(action.validation_checks) && action.validation_checks.length ? (
                    <div className="space-y-1 text-[11px]">
                      {action.validation_checks.map((check) => (
                        <p key={`${check.name}-${check.detail}`}><span className="font-medium">{check.status === "passed" ? "✓" : "×"} {check.name}:</span> {check.detail}</p>
                      ))}
                    </div>
                  ) : null}
                  <p className="text-[11px] font-medium">{action.reason}</p>
                </div>
              ))}
            </div>
          ) : null}
          {providerResults.length ? (
            <div className="flex flex-col gap-1">
              <p className="font-medium text-foreground">Provider results</p>
              {providerResults.map((item, index) => (
                <p key={`${item.tool}-${index}`} className="text-muted-foreground">
                  <span className="font-mono text-foreground">{item.tool}</span>: {item.status || "unknown"}{item.provider ? ` · ${item.provider}` : ""}
                </p>
              ))}
            </div>
          ) : null}
          {Array.isArray(trace.evidence_sources) && trace.evidence_sources.length ? (
            <div className="flex flex-col gap-1">
              <p className="font-medium text-foreground">Evidence / sources</p>
              {trace.evidence_sources.map((source, index) => (
                <p key={`${source.provenance?.source_id || source.title}-${index}`} className="text-muted-foreground">
                  {source.title || "Untitled source"} · {source.authority || "unknown authority"} · {source.provenance?.source_label || source.provenance?.source_kind || "unknown source"}
                </p>
              ))}
            </div>
          ) : null}
          <details className="rounded-md border border-gray-100 bg-gray-50/50 dark:border-gray-800 dark:bg-gray-900/40">
            <summary className="cursor-pointer px-3 py-2 font-medium text-gray-700 dark:text-gray-200">Context before / after</summary>
            <pre className="max-h-64 overflow-auto border-t border-gray-100 p-3 text-[11px] leading-relaxed text-gray-500 dark:border-gray-800 dark:text-gray-400">{JSON.stringify({ before: trace.context_before, after: trace.context_after }, null, 2)}</pre>
          </details>
          <details className="rounded-md border border-gray-100 bg-gray-50/50 dark:border-gray-800 dark:bg-gray-900/40">
            <summary className="cursor-pointer px-3 py-2 font-medium text-gray-700 dark:text-gray-200">Sanitized events</summary>
            <pre className="max-h-80 overflow-auto border-t border-gray-100 p-3 text-[11px] leading-relaxed text-gray-500 dark:border-gray-800 dark:text-gray-400">{JSON.stringify(trace.events || [], null, 2)}</pre>
          </details>
        </div>
      ) : null}
    </div>
  );
}

function TraceMetric({ label, value }) {
  return (
    <div className="rounded-md border border-gray-100 bg-gray-50/50 px-2.5 py-2 dark:border-gray-800 dark:bg-gray-900/40">
      <p className="text-[10px] uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">{label}</p>
      <p className="mt-1 truncate font-medium text-gray-700 dark:text-gray-200" title={value}>{value}</p>
    </div>
  );
}

function MessageBubble({ message }) {
  const isUser = message.role === "user";
  const comparisonOnly = message.comparison_only === true;
  return (
    <div className={`flex animate-in fade-in-0 slide-in-from-bottom-2 duration-200 ${isUser ? "justify-start" : "justify-end"}`}>
      <div className={`flex w-full max-w-[min(88%,42rem)] gap-3 ${isUser ? "" : "flex-row-reverse"}`}>
        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${isUser ? "bg-gray-100 text-gray-500 ring-gray-200/60 dark:bg-gray-800 dark:text-gray-400 dark:ring-gray-700" : "bg-indigo-50 text-indigo-500 ring-indigo-100 dark:bg-indigo-950/40 dark:text-indigo-400 dark:ring-indigo-800/50"}`} aria-hidden="true">
          {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className={`text-[10.5px] font-semibold uppercase tracking-widest ${isUser ? "text-gray-400 dark:text-gray-500" : "text-right text-indigo-400 dark:text-indigo-500"}`}>
          {isUser ? "Customer" : comparisonOnly ? "Previous response · comparison only" : "Sona"}
          {message.created_at ? <span className="ml-2 font-normal normal-case tracking-normal text-gray-300 dark:text-gray-600">{formatTime(message.created_at)}</span> : null}
          </p>
          <p className={`mt-1 whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[12.5px] leading-relaxed ${isUser ? "rounded-tl-md bg-gray-50 text-gray-700 ring-1 ring-inset ring-gray-100/80 dark:bg-gray-800/60 dark:text-gray-200 dark:ring-gray-700/50" : "rounded-tr-md border border-indigo-100 bg-indigo-50/70 text-left text-gray-700 shadow-[0_1px_3px_rgba(79,70,229,0.08)] dark:border-indigo-900/60 dark:bg-indigo-950/30 dark:text-gray-200 dark:shadow-none"}`}>
            {message.content}
          </p>
          {!isUser && !comparisonOnly ? <TraceDetails trace={message.trace} /> : null}
        </div>
      </div>
    </div>
  );
}

function TicketPickerDialog({ open, onOpenChange, onPick, productionMode }) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [loadingTicketId, setLoadingTicketId] = useState(null);
  const [pickerError, setPickerError] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      setPickerError("");
      const params = new URLSearchParams({ view: "tickets", limit: "50" });
      if (query.trim()) params.set("search", query.trim());
      fetch(`/api/agent-playground?${params.toString()}`, { credentials: "include", cache: "no-store" })
        .then(async (response) => {
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data?.error || "Could not load previous tickets.");
          if (!cancelled) setTickets(Array.isArray(data?.tickets) ? data.tickets : []);
        })
        .catch((error) => {
          if (cancelled) return;
          setTickets([]);
          setPickerError(error instanceof Error ? error.message : "Could not load previous tickets.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, query.trim() ? 250 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  const filteredTickets = useMemo(() => tickets, [tickets]);

  const handlePick = async (ticket) => {
    setLoadingTicketId(ticket.thread_id);
    setPickerError("");
    try {
      await onPick(ticket);
      onOpenChange(false);
    } catch (error) {
      setPickerError(error instanceof Error ? error.message : "Could not import this ticket.");
    } finally {
      setLoadingTicketId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] w-[min(92vw,640px)] max-w-none overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="border-b border-gray-100 px-5 py-3.5 dark:border-gray-800">
          <DialogTitle className="flex items-center gap-2 text-[14px] font-semibold">
            <Inbox className="h-4 w-4 text-indigo-500" />
            {productionMode ? "Choose a production ticket" : "Choose a previous ticket"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Choose a scoped ticket to load its raw conversation into the read-only playground.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[65vh] flex-col">
          <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-2.5 dark:border-gray-800">
            <Search className="h-3.5 w-3.5 text-gray-300 dark:text-gray-600" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search ticket number, subject, customer..."
              className="flex-1 bg-transparent text-[12px] text-gray-700 outline-none placeholder:text-gray-300 dark:text-gray-300 dark:placeholder:text-gray-600"
              autoFocus
            />
          </div>
          {pickerError ? <p className="border-b border-red-100 bg-red-50/60 px-5 py-2.5 text-[11.5px] text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">{pickerError}</p> : null}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="space-y-1.5 p-3">
                {[1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-14 w-full rounded-md" />)}
              </div>
            ) : filteredTickets.length === 0 ? (
              <p className="px-5 py-10 text-center text-[12px] text-gray-400 dark:text-gray-500">{query ? "No tickets match your search." : "No previous tickets found."}</p>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {filteredTickets.map((ticket) => (
                  <li key={ticket.thread_id}>
                    <button
                      type="button"
                      disabled={loadingTicketId !== null}
                      onClick={() => handlePick(ticket)}
                      className="group flex w-full flex-col gap-0.5 px-5 py-2.5 text-left transition-colors hover:bg-gray-50 disabled:opacity-50 dark:hover:bg-gray-800/50"
                    >
                      <span className="truncate text-[12.5px] font-medium text-gray-800 dark:text-gray-100">{ticket.ticket_number ? `#${ticket.ticket_number} · ` : ""}{ticket.subject || "(no subject)"}</span>
                      {ticket.customer_email ? <span className="truncate text-[11px] text-gray-500 dark:text-gray-400">{ticket.customer_email}</span> : null}
                      {ticket.preview ? <span className="truncate text-[11px] text-gray-400 dark:text-gray-500">{ticket.preview}</span> : null}
                      {loadingTicketId === ticket.thread_id ? <span className="mt-1 inline-flex items-center gap-1 text-[10.5px] text-indigo-600"><Loader2 className="h-3 w-3 animate-spin" /> Loading ticket...</span> : null}
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

export function GreenfieldPlayground() {
  const router = useRouter();
  const scrollRef = useRef(null);
  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [context, setContext] = useState(null);
  const [customerEmail, setCustomerEmail] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [environment, setEnvironment] = useState("development");
  const [ticketRequired, setTicketRequired] = useState(true);
  const productionMode = environment === "production";

  const load = useCallback(async (sessionId = "") => {
    setLoading(true);
    setError("");
    const query = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : "";
    const response = await fetch(`/api/agent-playground${query}`, { cache: "no-store", credentials: "include" }).catch(() => null);
    const payload = await response?.json().catch(() => ({}));
    if (!response?.ok) {
      setError(payload?.error || "Could not load the playground.");
      setLoading(false);
      return;
    }
    setSessions(Array.isArray(payload.sessions) ? payload.sessions : []);
    setEnvironment(payload.environment === "production" ? "production" : "development");
    setTicketRequired(payload.ticket_required === true);
    setSelectedSession(payload.selected_session || null);
    setMessages(Array.isArray(payload.messages) ? payload.messages : []);
    setContext(payload.context || null);
    setCustomerEmail(payload.selected_session?.customer_email || "");
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch(() => setError("Could not load the playground."));
  }, [load]);

  const newConversation = () => {
    setSelectedSession(null);
    setMessages([]);
    setContext(null);
    setDraft("");
    setError("");
  };

  const createSession = async () => {
    const response = await fetch("/api/agent-playground", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action: "create", customer_email: customerEmail }),
    }).catch(() => null);
    const payload = await response?.json().catch(() => ({}));
    if (!response?.ok) throw new Error(payload?.error || "Could not create a playground session.");
    setSelectedSession(payload.session);
    setMessages([]);
    setContext(null);
    setSessions((current) => [payload.session, ...current.filter((item) => item.id !== payload.session.id)]);
    return payload.session;
  };

  const runImportedTicket = async (sessionToRun = selectedSession) => {
    if (!sessionToRun?.source_thread_id || sending) return;
    setSending(true);
    setError("");
    try {
      const response = await fetch("/api/agent-playground", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "run_ticket", session_id: sessionToRun.id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "The read-only agent run failed.");
      setSelectedSession(payload.session);
      setSessions((current) => [payload.session, ...current.filter((item) => item.id !== payload.session.id)]);
      setMessages((current) => [...current, ...(Array.isArray(payload.messages) ? payload.messages : [])]);
      setContext(payload.context || null);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "The read-only agent run failed.");
    } finally {
      setSending(false);
    }
  };

  const importTicket = async (ticket) => {
    const response = await fetch("/api/agent-playground", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action: "import_ticket", thread_id: ticket.thread_id }),
    }).catch(() => null);
    const payload = await response?.json().catch(() => ({}));
    if (!response?.ok) throw new Error(payload?.error || "Could not import this ticket.");
    setSelectedSession(payload.session);
    setMessages(Array.isArray(payload.messages) ? payload.messages : []);
    setContext(payload.context || null);
    setCustomerEmail(payload.session?.customer_email || "");
    setSessions((current) => [payload.session, ...current.filter((item) => item.id !== payload.session.id)]);
    setDraft("");
    setError("");
    await runImportedTicket(payload.session);
  };

  const send = async (event) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || sending) return;
    setSending(true);
    setError("");
    try {
      let session = selectedSession;
      if (!session || (customerEmail.trim().toLowerCase() !== String(session.customer_email || "").toLowerCase())) {
        session = await createSession();
      }
      const response = await fetch("/api/agent-playground", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "send", session_id: session.id, message }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "The read-only agent run failed.");
      setSelectedSession(payload.session);
      setSessions((current) => [payload.session, ...current.filter((item) => item.id !== payload.session.id)]);
      setMessages((current) => [...current, ...(Array.isArray(payload.messages) ? payload.messages : [])]);
      setContext(payload.context || null);
      setDraft("");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "The read-only agent run failed.");
    } finally {
      setSending(false);
    }
  };

  const deleteSession = async () => {
    if (!selectedSession || sending) return;
    setError("");
    const response = await fetch(`/api/agent-playground?session_id=${encodeURIComponent(selectedSession.id)}`, {
      method: "DELETE",
      credentials: "include",
    }).catch(() => null);
    const payload = await response?.json().catch(() => ({}));
    if (!response?.ok) {
      setError(payload?.error || "Could not delete the session.");
      return;
    }
    setSessions((current) => current.filter((item) => item.id !== selectedSession.id));
    newConversation();
  };

  const currentTurn = context?.turn || 0;
  const hasMessages = messages.length > 0;
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  return (
    <div className="flex h-[calc(100vh-80px)] flex-col">
      <div className="flex items-center gap-4 pb-4">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 transition-transform active:scale-[0.97]"
          onClick={() => router.push("/knowledge")}
          aria-label="Back to knowledge"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-[18px] font-semibold tracking-tight text-gray-900 dark:text-gray-100">Agent Playground</h1>
          <p className="mt-0.5 text-[12.5px] text-gray-500 dark:text-gray-400">
            {ticketRequired ? "Evaluate a real support ticket with Sona. Read-only simulation — nothing is sent or executed." : "Write a message and chat with Sona over multiple turns. This is a read-only simulation — nothing is sent or executed."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wide text-gray-400 sm:inline-flex dark:text-gray-500">
            <ShieldCheck className="h-3.5 w-3.5" /> {productionMode ? "Internal · production read-only" : "Development only"}
          </span>
          {selectedSession ? (
            <Button type="button" variant="outline" size="sm" onClick={deleteSession} disabled={sending} className="gap-1.5 transition-transform active:scale-[0.97]">
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)} className="gap-1.5 transition-transform active:scale-[0.97]">
            <Inbox className="h-3.5 w-3.5" /> {ticketRequired ? "Choose ticket" : "Load ticket"}
          </Button>
          {!ticketRequired ? (
            <Button type="button" variant="outline" size="sm" onClick={newConversation} className="gap-1.5 transition-transform active:scale-[0.97]">
              <Plus className="h-3.5 w-3.5" /> New conversation
            </Button>
          ) : null}
        </div>
      </div>

      {error ? <div role="alert" className="mb-3 rounded-lg border border-red-100 bg-red-50/60 px-3.5 py-2.5 text-[12px] text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">{error}</div> : null}

      {!ticketRequired ? <div className="mb-3 overflow-hidden rounded-lg border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900/40 dark:shadow-none">
        <div className="grid grid-cols-1 divide-y divide-gray-100 dark:divide-gray-800">
          <label className="flex items-center gap-2.5 px-3.5 py-2.5">
            <span className="shrink-0 text-[10.5px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Customer</span>
            <input
              id="playground-customer-email"
              type="email"
              value={customerEmail}
              onChange={(event) => setCustomerEmail(event.target.value)}
              placeholder="customer@example.com"
              disabled={sending}
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-gray-700 outline-none placeholder:text-gray-300 disabled:opacity-50 dark:text-gray-300 dark:placeholder:text-gray-600"
            />
          </label>
        </div>
      </div> : null}

      <details className="mb-3 rounded-lg border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900/40 dark:shadow-none">
        <summary className="flex cursor-pointer list-none items-center justify-between px-3.5 py-2.5 text-[11.5px] font-medium text-gray-600 dark:text-gray-300">
          <span className="inline-flex items-center gap-2"><Inbox className="h-3.5 w-3.5 text-gray-400" /> Saved test sessions <span className="font-normal text-gray-400">({sessions.length})</span></span>
          <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
        </summary>
        <div className="border-t border-gray-100 px-2 py-2 dark:border-gray-800">
          {sessions.length ? (
            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {sessions.map((session) => (
                <button
                  type="button"
                  key={session.id}
                  className={`flex min-w-0 flex-col gap-0.5 rounded-lg px-3 py-2 text-left text-xs transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50 ${selectedSession?.id === session.id ? "bg-indigo-50/70 dark:bg-indigo-950/30" : ""}`}
                  onClick={() => load(session.id)}
                >
                  <span className="truncate font-medium text-gray-700 dark:text-gray-200">{session.title}</span>
                  <span className="truncate text-gray-400 dark:text-gray-500">{session.customer_email || "No email"}</span>
                </button>
              ))}
            </div>
          ) : <p className="px-2 py-2 text-[11.5px] text-gray-400 dark:text-gray-500">No saved sessions yet.</p>}
        </div>
      </details>

      <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto rounded-xl border border-gray-200/60 bg-white px-5 py-5 shadow-[inset_0_1px_2px_rgba(0,0,0,0.03)] dark:border-gray-800 dark:bg-card dark:shadow-none">
        {loading ? <p className="text-[12px] text-gray-400 dark:text-gray-500">Loading playground…</p> : null}
        {!loading && !hasMessages ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 py-12 text-center animate-in fade-in-0 duration-500">
            <div className="space-y-1">
              <p className="text-[14px] font-semibold text-gray-800 dark:text-gray-100">{ticketRequired ? "Choose a production ticket" : "Start a test conversation"}</p>
          <p className="max-w-sm text-[12px] leading-relaxed text-gray-400 dark:text-gray-500">{ticketRequired ? "Choose a real ticket and Sona will generate a candidate response automatically." : "Write the customer&apos;s first message below. Sona will use the same read-only runtime used by the support agent."}</p>
            </div>
          </div>
        ) : null}
        {messages.map((message) => <MessageBubble key={message.id} message={message} />)}
        {sending ? (
          <div className="flex gap-3 animate-in fade-in-0 duration-200">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-500 ring-1 ring-inset ring-indigo-100 dark:bg-indigo-950/40 dark:text-indigo-400 dark:ring-indigo-800/50"><Bot className="h-3.5 w-3.5" /></div>
            <div className="min-w-0 flex-1 space-y-1.5"><p className="text-[10.5px] font-semibold uppercase tracking-widest text-indigo-400 dark:text-indigo-500">Sona AI</p><div className="inline-flex rounded-lg border border-gray-100 bg-white px-3 py-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:border-gray-800 dark:bg-gray-900/40"><TypingDots /></div></div>
          </div>
        ) : null}
      </div>

      <form className="mt-3 space-y-2" onSubmit={send}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && draft.trim()) {
              event.preventDefault();
              send(event);
            }
          }}
          placeholder={ticketRequired && !selectedSession ? "Choose a ticket first..." : hasMessages ? "Write the customer's next message... (Cmd+Enter to send)" : "Write the customer's first message... (Cmd+Enter to send)"}
          rows={3}
          maxLength={12000}
          disabled={sending || (ticketRequired && !selectedSession)}
          aria-label="Customer message"
          className="w-full resize-none rounded-xl border border-gray-200 bg-white px-4 py-3 text-[13px] leading-relaxed text-gray-800 placeholder:text-gray-300 outline-none transition-shadow focus:border-indigo-200 focus:ring-2 focus:ring-indigo-100/80 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-200 dark:placeholder:text-gray-600 dark:focus:border-indigo-700 dark:focus:ring-indigo-900/50"
        />
        <div className="flex items-center justify-between gap-3">
          <p className="px-1 text-[11.5px] text-gray-400 dark:text-gray-500">Turn {currentTurn} · read-only simulation · no customer message will be sent</p>
          <Button type="submit" size="sm" disabled={!draft.trim() || sending || (ticketRequired && !selectedSession)} className="gap-1.5 transition-transform active:scale-[0.97]">
            <Send className="h-3.5 w-3.5" /> {sending ? "Running…" : hasMessages ? "Send next message" : "Send & generate reply"}
          </Button>
        </div>
      </form>

      <TicketPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} onPick={importTicket} productionMode={ticketRequired} />
    </div>
  );
}
