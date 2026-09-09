"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  Inbox,
  Info,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  User,
  XCircle,
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
  const steps = toolCalls.slice(0, 6).map((event) => {
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
  steps.push({
    title: "Composed the reply",
    detail: sources.length ? "The answer was written from the evidence and checks shown below." : "The answer was written without inventing an unsupported fact.",
    status: "complete",
  });
  return steps;
}

function SourceCard({ source, index }) {
  const provenance = source?.provenance || {};
  const sections = Array.isArray(source?.evidence_sections) ? source.evidence_sections : [];
  const preview = sections[0]?.content || "No excerpt captured in the trace.";
  return (
    <details className="group overflow-hidden rounded-xl border border-border/80 bg-background transition-[border-color,box-shadow] duration-150 ease-out open:border-violet-200 open:shadow-[0_8px_24px_rgba(91,33,182,0.06)]" open={index === 0}>
      <summary className="flex cursor-pointer list-none items-start gap-3 px-3.5 py-3.5 transition-colors duration-150 ease-out hover:bg-muted/35">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-violet-200/80 bg-violet-50 text-violet-700 dark:border-violet-800/60 dark:bg-violet-950/30 dark:text-violet-300">
          <FileText className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{humanize(source?.knowledge_type || "knowledge")}</span>
            {source?.authority ? <span className="rounded-md border border-border/80 bg-muted/30 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{humanize(source.authority)}</span> : null}
          </span>
          <span className="block truncate text-[13px] font-semibold text-foreground">{source?.title || "Untitled source"}</span>
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{provenance.source_label || provenance.source_kind || "Unknown provenance"}</span>
        </span>
        <ChevronDown className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-180" />
      </summary>
      <div className="border-t border-border/70 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {Number.isInteger(source?.rank) ? <span className="rounded-md bg-muted/50 px-2 py-1 text-[10px] font-medium">Rank {source.rank}</span> : null}
          {typeof source?.score === "number" ? <span className="rounded-md bg-muted/50 px-2 py-1 text-[10px] font-medium">Score {source.score.toFixed(2)}</span> : null}
          {provenance.source_kind ? <span className="rounded-md bg-muted/50 px-2 py-1 text-[10px] font-medium">{humanize(provenance.source_kind)}</span> : null}
        </div>
        <div className="flex flex-col gap-3">
          {sections.length ? sections.map((section, sectionIndex) => (
            <div key={`${section.heading || "excerpt"}-${sectionIndex}`}>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/70">{section.heading || "Excerpt used"}</p>
              <p className="whitespace-pre-wrap text-foreground/80">{section.content || "No excerpt captured."}</p>
            </div>
          )) : <p className="text-foreground/70">{preview}</p>}
        </div>
        {(provenance.source_id || provenance.source_uri) ? (
          <p className="mt-3 border-t border-border/60 pt-2 text-[10.5px] text-muted-foreground/80">
            {provenance.source_id ? `Source ID: ${provenance.source_id}` : ""}{provenance.source_id && provenance.source_uri ? " · " : ""}{provenance.source_uri ? provenance.source_uri : ""}
          </p>
        ) : null}
      </div>
    </details>
  );
}

function ProviderCheck({ result }) {
  const successful = result?.status === "ok" || result?.status === "success";
  const Icon = successful ? CheckCircle2 : result?.status ? XCircle : Info;
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5">
      <Icon className={`mt-0.5 size-3.5 shrink-0 ${successful ? "text-emerald-600" : result?.status ? "text-amber-600" : "text-muted-foreground"}`} />
      <div className="min-w-0">
        <p className="truncate text-[12px] font-medium text-foreground">{toolLabel(result?.tool)}</p>
        <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground">{result?.provider || "Provider"} · {humanize(result?.status || "not recorded")}</p>
      </div>
    </div>
  );
}

function AnswerInspector({ message }) {
  const trace = message?.trace;
  const sources = Array.isArray(trace?.evidence_sources) ? trace.evidence_sources : [];
  const providerResults = Array.isArray(trace?.provider_results) ? trace.provider_results : [];
  const toolCalls = Array.isArray(trace?.events) ? trace.events.filter((event) => event?.type === "tool_call") : [];
  const simulatedActions = Array.isArray(trace?.simulated_actions) ? trace.simulated_actions : [];
  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/80 bg-card shadow-[0_8px_30px_rgba(15,23,42,0.04)] lg:max-h-full" aria-label="Answer inspector">
      <div className="shrink-0 border-b border-border/70 px-4 py-4">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-indigo-50 text-violet-700 dark:border-violet-800/60 dark:from-violet-950/40 dark:to-indigo-950/40 dark:text-violet-300">
            <Sparkles className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Answer inspector</p>
            <h2 className="mt-1 text-[15px] font-semibold tracking-[-0.01em] text-foreground">Sources & reasoning</h2>
          </div>
          {trace ? <span className="rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-[10px] font-semibold text-violet-700 dark:border-violet-800/60 dark:bg-violet-950/30 dark:text-violet-300">{sources.length} source{sources.length === 1 ? "" : "s"}</span> : null}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          {trace ? "A compact evidence trail for the selected Sona response." : "Select a Sona response to inspect what informed it."}
        </p>
      </div>
      {!trace ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl border border-dashed border-border bg-muted/30 text-muted-foreground">
            <BookOpen className="size-5" />
          </div>
          <p className="mt-4 text-[13px] font-semibold text-foreground">Nothing to inspect yet</p>
          <p className="mt-1 max-w-[24ch] text-[11px] leading-relaxed text-muted-foreground">Send a message, then open “View answer basis” below Sona’s reply.</p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="mb-4 grid grid-cols-3 gap-1.5">
            <InspectorStat label="Checks" value={toolCalls.length} />
            <InspectorStat label="Sources" value={sources.length} />
            <InspectorStat label="Latency" value={trace.latency_ms == null ? "—" : `${trace.latency_ms}ms`} />
          </div>

          <InspectorSection title="Why this answer" icon={Sparkles}>
            <ol className="relative ml-1 flex flex-col gap-4 border-l border-violet-200 pl-4 dark:border-violet-900/60">
              {buildReasoningSteps(trace).map((step, index) => (
                <li key={`${step.title}-${index}`} className="relative">
                  <span className={`absolute -left-[21px] top-0.5 flex size-3.5 items-center justify-center rounded-full border-2 border-card ${step.status === "complete" ? "bg-violet-500" : "bg-muted-foreground/50"}`} />
                  <p className="text-[12px] font-semibold text-foreground">{step.title}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{step.detail}</p>
                </li>
              ))}
            </ol>
          </InspectorSection>

          <InspectorSection title="Knowledge sources" icon={BookOpen} count={sources.length}>
            {sources.length ? (
              <div className="flex flex-col gap-2">
                {sources.map((source, index) => <SourceCard key={`${source?.provenance?.source_id || source?.title || "source"}-${index}`} source={source} index={index} />)}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-3 text-[11px] leading-relaxed text-muted-foreground">No knowledge source was returned for this response.</div>
            )}
          </InspectorSection>

          {providerResults.length ? (
            <InspectorSection title="Live checks" icon={CheckCircle2} count={providerResults.length}>
              <div className="flex flex-col gap-2">{providerResults.map((result, index) => <ProviderCheck key={`${result?.tool || "provider"}-${index}`} result={result} />)}</div>
            </InspectorSection>
          ) : null}

          {simulatedActions.length ? (
            <InspectorSection title="Proposed actions" icon={ShieldCheck} count={simulatedActions.length}>
              <div className="flex flex-col gap-2">
                {simulatedActions.map((action, index) => (
                  <div key={`${action?.action || "action"}-${index}`} className="rounded-xl border border-amber-200/80 bg-amber-50/60 px-3 py-3 text-[11px] text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold">{actionLabel(action?.action)}</p>
                      <span className="rounded-md border border-amber-300 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em]">Dry run</span>
                    </div>
                    <p className="mt-2 leading-relaxed">Validation: {action?.validation_status || "not recorded"} · Executed: No</p>
                    {action?.reason ? <p className="mt-1 leading-relaxed text-amber-800/80 dark:text-amber-300/80">{action.reason}</p> : null}
                  </div>
                ))}
              </div>
            </InspectorSection>
          ) : null}

          <div className="mt-5 flex items-start gap-2 rounded-xl border border-border/70 bg-muted/20 px-3 py-3 text-[10.5px] leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>Only sanitized facts, provenance and high-level steps are shown. Hidden model reasoning is not exposed.</span>
          </div>
        </div>
      )}
    </aside>
  );
}

function InspectorSection({ title, icon: Icon, count, children }) {
  return (
    <section className="mb-5 last:mb-0">
      <div className="mb-2.5 flex items-center gap-2">
        <Icon className="size-3.5 text-muted-foreground" />
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</h3>
        {typeof count === "number" ? <span className="text-[10px] text-muted-foreground/70">{count}</span> : null}
      </div>
      {children}
    </section>
  );
}

function InspectorStat({ label, value }) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 px-2 py-2 text-center">
      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-[12px] font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function MessageBubble({ message, onInspect, inspected }) {
  const isUser = message.role === "user";
  const comparisonOnly = message.comparison_only === true;
  const canInspect = !isUser && !comparisonOnly && message.trace;
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
          {canInspect ? (
            <button
              type="button"
              onClick={() => onInspect?.(message.id)}
              className={`mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10.5px] font-medium transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.98] ${inspected ? "bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}
              aria-pressed={inspected}
            >
              <Sparkles className="size-3" />
              {inspected ? "Viewing answer basis" : "View answer basis"}
              <ChevronRight className="size-3" />
            </button>
          ) : null}
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
  const [inspectedMessageId, setInspectedMessageId] = useState(null);
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
    setInspectedMessageId(null);
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
    setInspectedMessageId(null);
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
      const latestResponse = [...responseMessages].reverse().find((message) => message.role === "assistant" && message.trace);
      if (latestResponse) setInspectedMessageId(latestResponse.id);
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
      const responseMessages = Array.isArray(payload.messages) ? payload.messages : [];
      setMessages((current) => [...current, ...responseMessages]);
      const latestResponse = [...responseMessages].reverse().find((item) => item.role === "assistant" && item.trace);
      if (latestResponse) setInspectedMessageId(latestResponse.id);
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
  const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant" && message.trace);
  const inspectedMessage = messages.find((message) => message.id === inspectedMessageId && message.role === "assistant" && message.trace) || latestAssistant || null;
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  return (
    <div className="flex min-h-[680px] flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-600 dark:text-violet-400">Internal workspace</p>
          <h1 className="mt-1 text-[22px] font-semibold tracking-[-0.025em] text-gray-900 dark:text-gray-100">Agent Playground</h1>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-gray-500 dark:text-gray-400">
            {ticketRequired ? "Evaluate a real support ticket with Sona. Read-only simulation — nothing is sent or executed." : "Write a message and chat with Sona over multiple turns. This is a read-only simulation — nothing is sent or executed."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/80 bg-emerald-50/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
            <ShieldCheck className="h-3.5 w-3.5" /> Read-only
          </span>
          {selectedSession ? (
            <Button type="button" variant="outline" size="sm" onClick={deleteSession} disabled={sending} className="gap-1.5 rounded-lg transition-transform active:scale-[0.97]">
              <RotateCcw className="h-3.5 w-3.5" /> New
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)} className="gap-1.5 rounded-lg transition-transform active:scale-[0.97]">
            <Inbox className="h-3.5 w-3.5" /> {ticketRequired ? "Choose ticket" : "Load ticket"}
          </Button>
          {!ticketRequired ? (
            <Button type="button" size="sm" onClick={newConversation} className="gap-1.5 rounded-lg bg-violet-600 text-white shadow-[0_4px_12px_rgba(124,58,237,0.18)] transition-[transform,background-color] duration-150 ease-out hover:bg-violet-700 active:scale-[0.98]">
              <Plus className="h-3.5 w-3.5" /> New chat
            </Button>
          ) : null}
        </div>
      </div>

      {error ? <div role="alert" className="rounded-xl border border-red-100 bg-red-50/60 px-3.5 py-2.5 text-[12px] text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">{error}</div> : null}

      <details className="shrink-0 overflow-hidden rounded-xl border border-border/80 bg-card shadow-[0_2px_10px_rgba(15,23,42,0.025)]">
        <summary className="flex cursor-pointer list-none items-center justify-between px-3.5 py-2.5 text-[11.5px] font-medium text-foreground transition-colors hover:bg-muted/30">
          <span className="inline-flex items-center gap-2"><Inbox className="h-3.5 w-3.5 text-muted-foreground" /> Previous conversations <span className="font-normal text-muted-foreground">({sessions.length})</span></span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform duration-150 group-open:rotate-180" />
        </summary>
        <div className="border-t border-border/70 px-2 py-2">
          {sessions.length ? (
            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {sessions.map((session) => (
                <button
                  type="button"
                  key={session.id}
                  className={`flex min-w-0 flex-col gap-0.5 rounded-lg px-3 py-2 text-left text-xs transition-[background-color,transform] duration-150 ease-out hover:bg-muted/45 active:scale-[0.995] ${selectedSession?.id === session.id ? "bg-violet-50/80 dark:bg-violet-950/30" : ""}`}
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

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-border/80 bg-card shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
          <div className="flex shrink-0 flex-col gap-3 border-b border-border/70 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800/60 dark:bg-violet-950/30 dark:text-violet-300"><Bot className="size-4" /></span>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-foreground">{selectedSession?.title || "New conversation"}</p>
                <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground">{selectedSession?.source_thread_id ? "Imported support ticket" : "Freeform customer conversation"}</p>
              </div>
            </div>
            {!ticketRequired ? (
              <label className="flex min-w-0 items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-2.5 py-1.5 sm:max-w-[240px]">
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

          <div ref={scrollRef} className="min-h-0 flex-1 space-y-6 overflow-y-auto bg-gradient-to-b from-muted/[0.12] to-background px-4 py-5 sm:px-6">
            {loading ? <p className="text-[12px] text-muted-foreground">Loading playground…</p> : null}
            {!loading && !hasMessages ? (
              <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-4 py-12 text-center animate-in fade-in-0 duration-300">
                <div className="flex size-14 items-center justify-center rounded-2xl border border-violet-200/80 bg-gradient-to-br from-violet-50 to-indigo-50 text-violet-600 shadow-[0_8px_24px_rgba(124,58,237,0.08)] dark:border-violet-800/60 dark:from-violet-950/40 dark:to-indigo-950/40 dark:text-violet-300">
                  <Sparkles className="size-6" />
                </div>
                <div className="space-y-1.5">
                  <p className="text-[14px] font-semibold text-foreground">{ticketRequired ? "Choose a production ticket" : "Start a conversation"}</p>
                  <p className="max-w-sm text-[12px] leading-relaxed text-muted-foreground">{ticketRequired ? "Choose a real ticket and Sona will generate a candidate response automatically." : "Write the customer&apos;s message below. Sona will respond and show the evidence behind the answer."}</p>
                </div>
              </div>
            ) : null}
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                onInspect={setInspectedMessageId}
                inspected={inspectedMessage?.id === message.id}
              />
            ))}
            {sending ? (
              <div className="flex justify-end animate-in fade-in-0 duration-200">
                <div className="flex w-full max-w-[min(88%,42rem)] flex-row-reverse gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-600 ring-1 ring-inset ring-violet-100 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-800/50"><Bot className="h-3.5 w-3.5" /></div>
                  <div className="min-w-0 flex-1 space-y-1.5"><p className="text-right text-[10.5px] font-semibold uppercase tracking-widest text-violet-500 dark:text-violet-400">Sona</p><div className="ml-auto inline-flex rounded-2xl rounded-tr-md border border-violet-100 bg-violet-50/70 px-3 py-2.5 shadow-[0_1px_3px_rgba(79,70,229,0.08)] dark:border-violet-900/60 dark:bg-violet-950/30"><TypingDots /></div></div>
                </div>
              </div>
            ) : null}
          </div>

          <form className="shrink-0 border-t border-border/70 bg-card p-3 sm:p-4" onSubmit={send}>
            <div className="rounded-xl border border-border/80 bg-background shadow-[0_2px_8px_rgba(15,23,42,0.03)] transition-[border-color,box-shadow] duration-150 ease-out focus-within:border-violet-300 focus-within:shadow-[0_0_0_3px_rgba(124,58,237,0.08)] dark:focus-within:border-violet-700">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && draft.trim()) {
                    event.preventDefault();
                    send(event);
                  }
                }}
                placeholder={ticketRequired && !selectedSession ? "Choose a ticket first..." : hasMessages ? "Write the customer's next message..." : "Write the customer's first message..."}
                rows={3}
                maxLength={12000}
                disabled={sending || (ticketRequired && !selectedSession)}
                aria-label="Customer message"
                className="w-full resize-none rounded-xl border-0 bg-transparent px-3.5 py-3 text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground/60 outline-none disabled:opacity-50"
              />
              <div className="flex items-center justify-between gap-3 border-t border-border/60 px-3 py-2">
                <p className="truncate px-1 text-[10.5px] text-muted-foreground">Turn {currentTurn} · read-only · nothing will be sent</p>
                <Button type="submit" size="sm" disabled={!draft.trim() || sending || (ticketRequired && !selectedSession)} className="shrink-0 gap-1.5 rounded-lg bg-violet-600 text-white shadow-[0_4px_12px_rgba(124,58,237,0.18)] transition-[transform,background-color] duration-150 ease-out hover:bg-violet-700 active:scale-[0.98]">
                  <Send className="h-3.5 w-3.5" /> {sending ? "Thinking…" : "Send"}
                </Button>
              </div>
            </div>
            <p className="mt-2 px-1 text-[10px] text-muted-foreground/70">⌘ Enter to send · Sona&apos;s evidence appears in the inspector</p>
          </form>
        </section>

        <AnswerInspector message={inspectedMessage} />
      </div>

      <TicketPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} onPick={importTicket} productionMode={ticketRequired} />
    </div>
  );
}
