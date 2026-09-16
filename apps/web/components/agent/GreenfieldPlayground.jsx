"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Loader2,
  Search,
  Send,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SonaLogo } from "@/components/ui/SonaLogo";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const STARTER_MESSAGES = [
  "Where is my order?",
  "Can I return this item?",
  "Is this product compatible with my setup?",
];

function formatTime(value) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function actionLabel(value) {
  return String(value || "Action")
    .split("_")
    .map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : part)
    .join(" ");
}

function humanize(value) {
  return String(value || "unknown")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function toolLabel(value) {
  const labels = {
    search_policy: "Merchant policy",
    search_product_knowledge: "Product knowledge",
    search_historical_cases: "Previous support cases",
    get_brand_guidance: "Brand guidance",
    get_procedure: "Merchant procedure",
    get_order: "Order details",
    get_order_history: "Order history",
    get_customer: "Customer details",
    get_product: "Live product details",
    get_fulfillment: "Fulfillment details",
    get_tracking: "Tracking details",
    get_shipment: "Shipment details",
  };
  return labels[value] || humanize(value);
}

function resultForTool(trace, event) {
  return (trace?.events || []).find((candidate) => (
    candidate?.type === "tool_result" &&
    ((event?.call_id && candidate.call_id === event.call_id) || candidate.name === event?.name)
  ));
}

function buildReasoningSteps(trace) {
  const events = Array.isArray(trace?.events) ? trace.events : [];
  const toolCalls = events.filter((event) => event?.type === "tool_call");
  const sources = Array.isArray(trace?.evidence_sources) ? trace.evidence_sources : [];
  const providerResults = Array.isArray(trace?.provider_results) ? trace.provider_results : [];
  const simulatedActions = Array.isArray(trace?.simulated_actions) ? trace.simulated_actions : [];
  const steps = toolCalls.slice(0, 5).map((event) => {
    const result = resultForTool(trace, event);
    const resultData = result?.result?.data;
    const resultCount = Array.isArray(resultData?.results) ? resultData.results.length : 0;
    const status = result?.result?.status;
    const detail = resultCount
      ? `${resultCount} relevant result${resultCount === 1 ? "" : "s"} returned.`
      : status && status !== "ok"
        ? `Result: ${humanize(status)}.`
        : "Checked and continued with the available result.";
    return { title: toolLabel(event.name), detail, status: status === "ok" || resultCount > 0 ? "complete" : "neutral" };
  });

  if (!steps.length && sources.length) {
    steps.push({ title: "Supporting knowledge", detail: `${sources.length} source${sources.length === 1 ? "" : "s"} was attached to the response.`, status: "complete" });
  }
  if (!steps.length) {
    steps.push({ title: "Safe fallback", detail: "No supporting tool result was recorded, so the response stayed within the verified information available.", status: "neutral" });
  }
  providerResults.slice(0, Math.max(0, 5 - steps.length)).forEach((result) => {
    steps.push({
      title: `Checked ${toolLabel(result?.tool)}`,
      detail: `${result?.provider || "Provider"} · ${humanize(result?.status || "not recorded")}.`,
      status: result?.status === "ok" || result?.status === "success" ? "complete" : "neutral",
    });
  });
  simulatedActions.slice(0, Math.max(0, 5 - steps.length)).forEach((action) => {
    steps.push({
      title: `Prepared ${actionLabel(action?.action)}`,
      detail: `Dry run · ${action?.validation_status || "validation not recorded"}.`,
      status: "neutral",
    });
  });
  steps.push({
    title: "Composed the reply",
    detail: sources.length ? "The answer was written from the evidence and checks shown below." : "The answer was written without inventing an unsupported fact.",
    status: "complete",
  });
  return steps;
}

function AgentActivity({ trace, working = false }) {
  const [manualOpen, setManualOpen] = useState(null);
  const steps = working
    ? [
        { title: "Reviewing your message", detail: "Understanding the request and intent." },
        { title: "Preparing a verified reply", detail: "Checking the context Sona can safely use." },
      ]
    : buildReasoningSteps(trace);
  const sources = Array.isArray(trace?.evidence_sources) ? trace.evidence_sources : [];
  const isOpen = manualOpen ?? working;
  const seconds = trace?.latency_ms == null ? null : Math.max(1, Math.round(trace.latency_ms / 1000));
  const completeLabel = seconds
    ? `Thought for ${seconds} second${seconds === 1 ? "" : "s"}`
    : `Thought through ${steps.length} steps`;

  useEffect(() => {
    if (working) setManualOpen(null);
  }, [working]);

  return (
    <section className="mt-3 ml-auto w-full max-w-[31rem]" aria-label="Sona activity">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setManualOpen((current) => !(current ?? working))}
        className="group -mx-2 flex w-fit items-center gap-2 rounded-md px-2 py-1.5 text-left text-violet-700 transition-[background-color,transform,color] duration-150 ease-out hover:bg-violet-50/80 hover:text-violet-800 active:scale-[0.985] dark:text-violet-300 dark:hover:bg-violet-950/30 dark:hover:text-violet-200"
      >
        {working ? (
          <SonaLogo size={17} mode="sharp" speed="working" className="shrink-0" />
        ) : (
          <Sparkles className="size-[17px] shrink-0 text-violet-500 dark:text-violet-300" />
        )}
        {working ? (
          <span className="text-sm font-medium animate-[pulse_1.8s_ease-in-out_infinite]">Thinking</span>
        ) : (
          <span className="text-sm font-medium text-muted-foreground">{completeLabel}</span>
        )}
        <ChevronDown className={`size-4 text-muted-foreground transition-transform duration-200 ease-out ${isOpen ? "rotate-180" : ""}`} />
      </button>

      <div className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
        <div className="overflow-hidden">
          <div className="relative ml-2.5 mt-1.5 border-l border-violet-200/80 pl-4 dark:border-violet-400/25">
            {steps.map((step, index) => {
              const active = working && index === steps.length - 1;
              return (
                <div key={`${step.title}-${index}`} className="flex min-h-9 items-start gap-2.5 rounded-md px-2 py-1.5">
                  {active ? (
                    <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-violet-500" />
                  ) : (
                    <Check className="mt-0.5 size-4 shrink-0 text-violet-500 dark:text-violet-300" strokeWidth={2.5} />
                  )}
                  <span className="min-w-0">
                    <span className={`block text-[13px] ${active ? "font-medium text-violet-900 dark:text-violet-100" : "font-medium text-foreground"}`}>{step.title}</span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">{step.detail}</span>
                  </span>
                </div>
              );
            })}

            {sources.length ? (
              <div className="mt-1 border-t border-violet-100/80 px-2 pb-1 pt-2 dark:border-violet-400/15">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Sources used</p>
                <div className="mt-1 flex flex-col gap-1">
                  {sources.slice(0, 4).map((source, index) => (
                    <p key={`${source?.title || "source"}-${index}`} className="truncate text-[11px] text-muted-foreground">
                      {source?.title || source?.provenance?.source_label || "Verified source"}
                    </p>
                  ))}
                  {sources.length > 4 ? <p className="text-[11px] text-muted-foreground">+{sources.length - 4} more</p> : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function MessageBubble({ message }) {
  const isUser = message.role === "user";
  const comparisonOnly = message.comparison_only === true;
  const hasActivity = !isUser && !comparisonOnly && message.trace;
  return (
    <div className={`flex animate-in fade-in-0 slide-in-from-bottom-2 duration-200 ${isUser ? "justify-start" : "justify-end"}`}>
      <div className={`w-full ${isUser ? "max-w-[min(78%,44rem)]" : "max-w-[min(88%,44rem)]"}`}>
        <div className={`flex items-center gap-2 ${isUser ? "" : "justify-end"}`}>
          <p className={`text-[10.5px] font-semibold tracking-wide ${isUser ? "text-muted-foreground" : "text-right text-violet-700 dark:text-violet-300"}`}>
            {isUser ? "Customer" : comparisonOnly ? "Previous response · comparison only" : "Sona"}
            {message.created_at ? <span className="ml-2 font-normal text-muted-foreground/60">{formatTime(message.created_at)}</span> : null}
          </p>
        </div>
        <p className={`mt-1 whitespace-pre-wrap rounded-[16px] px-4 py-3 text-[13px] leading-[1.55] ${isUser ? "rounded-tl-md bg-muted/80 text-foreground" : "rounded-tr-md bg-violet-50/75 text-foreground dark:bg-violet-950/25"}`}>
          {message.content}
        </p>
        {hasActivity ? <AgentActivity trace={message.trace} /> : null}
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
          <DialogTitle className="text-[14px] font-semibold">{productionMode ? "Choose a production ticket" : "Choose a previous ticket"}</DialogTitle>
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
                      {loadingTicketId === ticket.thread_id ? <span className="mt-1 inline-flex items-center gap-1 text-[10.5px] text-slate-600"><Loader2 className="h-3 w-3 animate-spin" /> Loading ticket...</span> : null}
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
  const scrollRef = useRef(null);
  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [context, setContext] = useState(null);
  const [customerEmail, setCustomerEmail] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [pendingUserMessage, setPendingUserMessage] = useState(null);
  const [error, setError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [ticketRequired, setTicketRequired] = useState(true);

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
    setTicketRequired(payload.ticket_required === true);
    setSelectedSession(payload.selected_session || null);
    setMessages(Array.isArray(payload.messages) ? payload.messages : []);
    setPendingUserMessage(null);
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
    setPendingUserMessage(null);
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
      const responseMessages = Array.isArray(payload.messages) ? payload.messages : [];
      setMessages((current) => [...current, ...responseMessages]);
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
    setPendingUserMessage(null);
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
    setPendingUserMessage({
      id: `pending-${Date.now()}`,
      role: "user",
      content: message,
      created_at: new Date().toISOString(),
    });
    setDraft("");
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
      const responseMessages = Array.isArray(payload.messages) ? payload.messages : [];
      setMessages((current) => [...current, ...responseMessages]);
      setContext(payload.context || null);
      setPendingUserMessage(null);
    } catch (sendError) {
      setPendingUserMessage(null);
      setDraft(message);
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
  const displayedMessages = pendingUserMessage ? [...messages, pendingUserMessage] : messages;
  const hasMessages = displayedMessages.length > 0;
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: "smooth",
        });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, pendingUserMessage, sending]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <div className="flex shrink-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] font-semibold tracking-[-0.025em] text-foreground">Playground</h1>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-gray-500 dark:text-gray-400">
            {ticketRequired ? "Test how Sona would handle a real support ticket in a safe, read-only workspace." : "Test a customer conversation with Sona in a safe, read-only workspace."}
          </p>
        </div>
        <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2 sm:justify-end">
          <span className="text-[11px] font-medium text-muted-foreground">Read-only</span>
          <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)} className="gap-1.5 rounded-lg transition-transform active:scale-[0.97]">
            {ticketRequired ? "Choose ticket" : "Load previous ticket"}
          </Button>
          {(!ticketRequired || selectedSession) ? (
            <Button
              type="button"
              variant={!ticketRequired ? "default" : "outline"}
              size="sm"
              onClick={ticketRequired ? deleteSession : newConversation}
              disabled={sending}
              className={!ticketRequired ? "gap-1.5 rounded-lg bg-slate-900 text-white shadow-[0_4px_12px_rgba(15,23,42,0.12)] transition-[transform,background-color] duration-150 ease-out hover:bg-slate-800 active:scale-[0.98] dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white" : "gap-1.5 rounded-lg transition-transform active:scale-[0.97]"}
            >
              New conversation
            </Button>
          ) : null}
        </div>
      </div>

      {error ? <div role="alert" className="shrink-0 rounded-xl bg-red-50/80 px-3.5 py-2.5 text-[12px] text-red-700 dark:bg-red-950/30 dark:text-red-400">{error}</div> : null}

      <details className="group shrink-0 overflow-hidden rounded-lg bg-muted/35">
        <summary className="flex cursor-pointer list-none items-center justify-between px-3.5 py-2.5 text-[11.5px] font-medium text-foreground transition-colors hover:bg-muted/55">
          <span>Previous conversations <span className="font-normal text-muted-foreground">({sessions.length})</span></span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform duration-150 group-open:rotate-180" />
        </summary>
        <div className="px-2 pb-2">
          {sessions.length ? (
            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {sessions.map((session) => (
                <button
                  type="button"
                  key={session.id}
                  className={`flex min-w-0 flex-col gap-0.5 rounded-lg px-3 py-2 text-left text-xs transition-[background-color,transform] duration-150 ease-out hover:bg-muted/45 active:scale-[0.995] ${selectedSession?.id === session.id ? "bg-sky-50/70 dark:bg-sky-950/25" : ""}`}
                  onClick={() => load(session.id)}
                >
                  <span className="truncate font-medium text-foreground">{session.title}</span>
                  <span className="truncate text-muted-foreground">{session.customer_email || "No email"}</span>
                </button>
              ))}
            </div>
          ) : <p className="px-2 py-2 text-[11.5px] text-muted-foreground">No saved conversations yet.</p>}
        </div>
      </details>

      <div className="flex min-h-0 flex-1 overflow-hidden bg-card">
        <section className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 flex-col gap-3 border-b border-border/50 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-foreground">{selectedSession?.title || "New conversation"}</p>
              <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground">{selectedSession?.source_thread_id ? "Imported support ticket" : "Customer conversation"}</p>
            </div>
            {!ticketRequired ? (
              <label className="flex min-w-0 items-center gap-2 rounded-lg bg-muted/45 px-2.5 py-1.5 sm:max-w-[240px]">
                <span className="shrink-0 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Customer</span>
                <input
                  id="playground-customer-email"
                  type="email"
                  value={customerEmail}
                  onChange={(event) => setCustomerEmail(event.target.value)}
                  placeholder="Optional email"
                  disabled={sending}
                  className="min-w-0 flex-1 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground/60 disabled:opacity-50"
                />
              </label>
            ) : null}
          </div>

          <div ref={scrollRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-muted/[0.12] px-5 py-5 sm:px-8">
            {loading ? <p className="text-[12px] text-muted-foreground">Loading playground…</p> : null}
            {!loading && !hasMessages ? (
              <div className="flex h-full min-h-[240px] flex-col items-center justify-center py-12 text-center animate-in fade-in-0 duration-300">
                <div className="max-w-[30rem] space-y-1.5">
                  <p className="text-[15px] font-semibold text-foreground">{ticketRequired ? "Choose a ticket to begin" : "Write the first message"}</p>
                  <p className="text-[12px] leading-relaxed text-muted-foreground">{ticketRequired ? "Sona will create a candidate reply here without sending anything to the customer." : "Your messages and Sona's replies will appear here as a conversation."}</p>
                  {!ticketRequired ? (
                    <div className="mt-5 flex flex-wrap justify-center gap-2">
                      {STARTER_MESSAGES.map((starterMessage) => (
                        <button
                          key={starterMessage}
                          type="button"
                          onClick={() => setDraft(starterMessage)}
                          className="rounded-lg bg-background px-3 py-2 text-[11px] text-muted-foreground shadow-[0_1px_3px_rgba(15,23,42,0.04)] transition-[background-color,color,transform] duration-150 ease-out hover:bg-slate-900 hover:text-white active:scale-[0.98] dark:hover:bg-slate-100 dark:hover:text-slate-900"
                        >
                          {starterMessage}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)} className="mt-5 rounded-lg bg-background text-[11px] shadow-[0_1px_4px_rgba(15,23,42,0.04)] transition-transform active:scale-[0.98]">
                      Choose ticket
                    </Button>
                  )}
                </div>
              </div>
            ) : null}
            {displayedMessages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
              />
            ))}
            {sending ? (
              <div className="flex justify-end animate-in fade-in-0 slide-in-from-bottom-1 duration-200" role="status" aria-live="polite">
                <div className="w-full max-w-[min(88%,42rem)]">
                  <p className="text-right text-[10.5px] font-semibold tracking-wide text-violet-700 dark:text-violet-300">Sona</p>
                  <div className="ml-auto mt-1 flex justify-end"><AgentActivity working /></div>
                </div>
              </div>
            ) : null}
          </div>

          <form className="shrink-0 bg-background px-4 pb-4 pt-3 sm:px-5" onSubmit={send}>
            <div className="mx-auto flex w-full flex-col overflow-hidden rounded-xl bg-muted/[0.42] transition-[background-color,box-shadow] duration-150 ease-out focus-within:bg-muted/55 focus-within:shadow-[0_0_0_2px_hsl(var(--foreground)/0.08)]">
              <div className="flex items-center justify-between gap-3 px-4 pb-0 pt-3">
                <span className="text-[11px] font-medium text-foreground/70">Customer message</span>
                <span className="hidden text-[10px] text-muted-foreground/70 sm:inline">⌘ Enter to send</span>
              </div>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && draft.trim()) {
                    event.preventDefault();
                    send(event);
                  }
                }}
                placeholder={sending ? "Sona is thinking…" : ticketRequired && !selectedSession ? "Choose a ticket first..." : hasMessages ? "Write the customer's next message..." : "Write the customer's first message..."}
                rows={3}
                maxLength={12000}
                disabled={sending || (ticketRequired && !selectedSession)}
                aria-label="Customer message"
                className="min-h-[68px] w-full resize-none border-0 bg-transparent px-4 py-2 text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground/60 outline-none disabled:opacity-50"
              />
              <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-0.5">
                <p className="truncate text-[10.5px] text-muted-foreground">{sending ? "Sona is replying…" : `Turn ${currentTurn} · read-only · nothing will be sent`}</p>
                <Button
                  type="submit"
                  disabled={!draft.trim() || sending || (ticketRequired && !selectedSession)}
                  aria-label={sending ? "Thinking" : "Send message"}
                  title={sending ? "Thinking…" : "Send message (⌘↵ / Ctrl+↵)"}
                  aria-busy={sending}
                  aria-keyshortcuts="Meta+Enter Control+Enter"
                  className="h-9 w-9 shrink-0 rounded-full bg-violet-600 p-0 text-white shadow-sm transition-[background-color,box-shadow,opacity,transform] duration-150 ease-out hover:bg-violet-700 hover:shadow-md active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 focus-visible:ring-offset-2"
                >
                  {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
          </form>
        </section>

      </div>

      <TicketPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} onPick={importTicket} productionMode={ticketRequired} />
    </div>
  );
}
