"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Inbox,
  Loader2,
  MessageSquare,
  PencilLine,
  Search,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { buildKnowledgeDocumentPreviewPayload } from "@/lib/knowledge/knowledge-doc-preview-actions";

function formatRelative(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return date.toLocaleDateString();
}

function DraftCard({ title, badge, badgeTone, run, isLoading }) {
  const text = run?.draft_text;
  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-border bg-card ">
      <div className="flex items-center justify-between border-b border-border px-3 py-2 ">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-foreground ">{title}</p>
          {badge && (
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-xs font-medium",
                badgeTone === "indigo" && "bg-accent text-primary  ",
                badgeTone === "gray" && "bg-muted text-muted-foreground  "
              )}
            >
              {badge}
            </span>
          )}
        </div>
        {run?.latency_ms != null && !isLoading && (
          <span className="text-xs text-muted-foreground ">{run.latency_ms} ms</span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-xs leading-relaxed text-foreground ">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-4/6" />
          </div>
        ) : run?.error ? (
          <div className="rounded-md bg-danger px-2.5 py-2 text-xs text-danger-foreground  ">
            {run.error}
          </div>
        ) : text ? (
          <p className="whitespace-pre-wrap">{text}</p>
        ) : (
          <p className="italic text-muted-foreground ">No draft generated.</p>
        )}
      </div>
      {!isLoading && Array.isArray(run?.sources) && run.sources.length > 0 && (
        <div className="border-t border-border px-3 py-2 ">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground ">
            Top sources
          </p>
          <ul className="space-y-0.5">
            {run.sources.slice(0, 4).map((s, i) => (
              <li key={i} className="truncate text-xs text-muted-foreground ">
                · {s.source_label || s.kind || "knowledge"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CustomMessageForm({ onSubmit }) {
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");

  const canSubmit = body.trim().length >= 5;

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      body: body.trim(),
      subject: subject.trim() || undefined,
      customer_email: customerEmail.trim() || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground ">
            Customer message <span className="text-danger-foreground">*</span>
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Paste or type the customer's message here — write it the way a customer would actually phrase it."
            rows={9}
            className="w-full resize-none rounded-md border border-border bg-card px-3 py-2.5 text-input md:text-sm leading-relaxed text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/30 focus:ring-2 focus:ring-ring      "
            autoFocus
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground ">
              Subject <span className="text-muted-foreground">(optional)</span>
            </label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Cannot pair AirPods"
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-input md:text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/30 focus:ring-2 focus:ring-ring     "
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground ">
              Customer email <span className="text-muted-foreground">(optional)</span>
            </label>
            <input
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              type="email"
              placeholder="customer@example.com"
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-input md:text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/30 focus:ring-2 focus:ring-ring     "
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground ">
          The test runs against a single message — no order context or conversation history. Use this for quick iteration; pick a real ticket when you need full context.
        </p>
      </div>
      <div className="flex justify-end border-t border-border pt-3 ">
        <Button type="submit" size="sm" disabled={!canSubmit}>
          <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          Run preview
        </Button>
      </div>
    </form>
  );
}

function ThreadPicker({ threads, loading, onSelect, query, onQueryChange }) {
  // The server already filters by `query` (so older tickets are found too).
  // We keep a light client-side filter for instant narrowing between the
  // debounced server fetches.
  const filtered = useMemo(() => {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) =>
      `${t.subject} ${t.preview} ${t.customer_email || ""}`
        .toLowerCase()
        .includes(q)
    );
  }, [threads, query]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-1 pb-3 ">
        <Search className="h-3.5 w-3.5 text-muted-foreground " />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search all tickets by subject, customer, or preview..."
          className="flex-1 bg-transparent text-input md:text-sm text-foreground placeholder:text-muted-foreground outline-none  "
        />
      </div>
      <div className="-mx-1 flex-1 overflow-y-auto">
        {loading ? (
          <div className="space-y-1.5 p-1.5">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-md" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs text-muted-foreground ">
            {query ? "No tickets match your search." : "No tickets found for this shop."}
          </p>
        ) : (
          <ul className="divide-y divide-border ">
            {filtered.map((thread) => (
              <li key={thread.thread_id}>
                <button
                  type="button"
                  onClick={() => onSelect(thread)}
                  className="group flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition-colors hover:bg-muted "
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-xs font-medium text-foreground ">
                      {thread.subject}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground ">
                      {formatRelative(thread.last_message_at)}
                    </span>
                  </div>
                  {thread.customer_email && (
                    <span className="truncate text-xs text-muted-foreground ">
                      {thread.customer_email}
                    </span>
                  )}
                  {thread.preview && (
                    <span className="truncate text-xs text-muted-foreground ">
                      {thread.preview}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function SnippetPreviewModal({ open, onOpenChange, snippetId, snippetTitle, previewDocumentId, previewTitle }) {
  const [threads, setThreads] = useState([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadQuery, setThreadQuery] = useState("");
  const [pickerMode, setPickerMode] = useState("inbox"); // "inbox" | "custom"
  // Tracks whether a preview is in progress / has a result. Holds either a
  // selected-thread object or { custom: true } so we know to show the result
  // panel rather than the picker.
  const [previewSource, setPreviewSource] = useState(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const isDocumentPreview = Boolean(previewDocumentId);

  useEffect(() => {
    if (!open) return;
    setPickerMode("inbox");
    setPreviewSource(null);
    setResult(null);
    setThreadQuery("");
  }, [open]);

  // Load threads — server-side search so ANY ticket is findable, not just the
  // most recent ones. Debounced while typing; aborts stale requests.
  useEffect(() => {
    if (!open) return;
    const q = threadQuery.trim();
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setThreadsLoading(true);
      fetch(
        `/api/knowledge/snippets/preview/threads?limit=50${q ? `&search=${encodeURIComponent(q)}` : ""}`,
        { credentials: "include", signal: controller.signal },
      )
        .then((r) => r.json())
        .then((data) => {
          setThreads(Array.isArray(data?.threads) ? data.threads : []);
        })
        .catch((err) => {
          if (err?.name !== "AbortError") setThreads([]);
        })
        .finally(() => setThreadsLoading(false));
    }, q ? 250 : 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, threadQuery]);

  const runPreview = useCallback(
    async (thread) => {
      setPreviewSource(thread);
      setRunning(true);
      setResult(null);
      try {
        const res = await fetch("/api/knowledge/snippets/preview", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(isDocumentPreview
            ? buildKnowledgeDocumentPreviewPayload({
              documentId: previewDocumentId,
              threadId: thread.thread_id,
            })
            : {
              snippet_id: snippetId,
              thread_id: thread.thread_id,
            }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Preview failed");
        setResult(data);
      } catch (err) {
        toast.error(err.message);
        setPreviewSource(null);
      } finally {
        setRunning(false);
      }
    },
    [isDocumentPreview, previewDocumentId, snippetId]
  );

  const runCustomPreview = useCallback(
    async (customMessage) => {
      setPreviewSource({ custom: true });
      setRunning(true);
      setResult(null);
      try {
        const res = await fetch("/api/knowledge/snippets/preview", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(isDocumentPreview
            ? buildKnowledgeDocumentPreviewPayload({
              documentId: previewDocumentId,
              customMessage,
            })
            : {
              snippet_id: snippetId,
              custom_message: customMessage,
            }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Preview failed");
        setResult(data);
      } catch (err) {
        toast.error(err.message);
        setPreviewSource(null);
      } finally {
        setRunning(false);
      }
    },
    [isDocumentPreview, previewDocumentId, snippetId]
  );

  const handleBack = () => {
    setPreviewSource(null);
    setResult(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[min(96vw,1100px)] max-w-none overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="border-b border-border px-5 py-3.5 ">
          <DialogTitle className="flex items-center gap-2 text-page-heading font-semibold">
            {previewSource && (
              <button
                type="button"
                onClick={handleBack}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-muted-foreground   "
              >
                <ArrowLeft className="h-3.5 w-3.5" />
              </button>
            )}
            <span>
              {previewSource
                ? isDocumentPreview
                  ? "Knowledge document preview"
                  : "Snippet preview — A/B comparison"
                : isDocumentPreview
                ? "Test your draft document"
                : "Test your snippet"}
            </span>
            {(previewTitle || snippetTitle) && !previewSource && (
              <span className="ml-2 truncate rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground  ">
                {previewTitle || snippetTitle}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="h-[min(80vh,720px)] overflow-hidden">
          {!previewSource ? (
            <div className="flex h-full flex-col px-5 py-3">
              <p className="mb-3 text-xs text-muted-foreground ">
                {isDocumentPreview
                  ? "We'll run the AI pipeline twice — once with your draft document preview, once without — so you can see exactly what it adds."
                  : "We'll run the AI pipeline twice — once with your snippet present, once without — so you can see exactly what it adds."}
              </p>
              <div className="mb-3 inline-flex w-fit gap-0.5 rounded-md border border-border bg-muted p-0.5  ">
                <button
                  type="button"
                  onClick={() => setPickerMode("inbox")}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
                    pickerMode === "inbox"
                      ? "bg-card text-foreground shadow-sm   dark:shadow-none"
                      : "text-muted-foreground hover:text-foreground  "
                  )}
                >
                  <Inbox className="h-3 w-3" />
                  Pick from inbox
                </button>
                <button
                  type="button"
                  onClick={() => setPickerMode("custom")}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
                    pickerMode === "custom"
                      ? "bg-card text-foreground shadow-sm   dark:shadow-none"
                      : "text-muted-foreground hover:text-foreground  "
                  )}
                >
                  <PencilLine className="h-3 w-3" />
                  Write your own
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                {pickerMode === "inbox" ? (
                  <ThreadPicker
                    threads={threads}
                    loading={threadsLoading}
                    onSelect={runPreview}
                    query={threadQuery}
                    onQueryChange={setThreadQuery}
                  />
                ) : (
                  <CustomMessageForm onSubmit={runCustomPreview} />
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col">
              {/* Customer message panel */}
              <div className="border-b border-border bg-muted/50 px-5 py-3  ">
                <div className="flex items-start gap-2">
                  <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground " />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <p className="text-xs font-semibold text-muted-foreground ">
                        Customer wrote
                      </p>
                      {result?.customer_email && (
                        <p className="truncate text-xs text-muted-foreground ">
                          {result.customer_email}
                        </p>
                      )}
                    </div>
                    {result?.subject && (
                      <p className="mt-0.5 text-xs font-medium text-foreground ">
                        {result.subject}
                      </p>
                    )}
                    {result?.customer_message ? (
                      <p className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground ">
                        {result.customer_message}
                      </p>
                    ) : running ? (
                      <div className="mt-1 space-y-1.5">
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-4/5" />
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Retrieval banner */}
              {result && (
                <div
                  className={cn(
                    "flex items-center gap-2 border-b px-5 py-2 text-xs",
                    result.preview_clarification
                      ? "border-primary/30 bg-accent text-accent-foreground   "
                      : result.snippet_was_retrieved
                      ? "border-success-border bg-success text-success-foreground   "
                      : "border-warning-border bg-warning text-warning-foreground   "
                  )}
                >
                  {result.preview_clarification || result.snippet_was_retrieved ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5" />
                  )}
                  <p>
                    {result.preview_clarification
                      ? "No document section matched this issue, so the preview asked the customer a focused clarification question — the expected behaviour for an unclear message."
                      : result.snippet_was_retrieved
                      ? isDocumentPreview
                        ? "Your draft document preview was used for this ticket. The drafts below show what changes when it's removed."
                        : "Your snippet was retrieved for this ticket. The drafts below show what changes when it's removed."
                      : isDocumentPreview
                      ? "Your draft document preview was not used for this ticket. Try a question that matches one of the document sections."
                      : "Your snippet was NOT retrieved for this ticket — try rephrasing the question to match the customer's wording, or add more relevant issue tags."}
                  </p>
                </div>
              )}

              {/* A/B drafts */}
              <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-hidden px-5 py-3">
                <DraftCard
                  title={isDocumentPreview ? "With draft document" : "With your snippet"}
                  badge={isDocumentPreview ? "Preview" : "Baseline"}
                  badgeTone="indigo"
                  run={result?.with_snippet}
                  isLoading={running}
                />
                <DraftCard
                  title={isDocumentPreview ? "Without draft document" : "Without your snippet"}
                  badge="Excluded"
                  badgeTone="gray"
                  run={result?.without_snippet}
                  isLoading={running}
                />
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-2.5 ">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground ">
                  {running && (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Running both drafts...
                    </>
                  )}
                  {!running && result && (
                    <>Excluded {result.excluded_chunk_count} chunk{result.excluded_chunk_count === 1 ? "" : "s"} for the &ldquo;without&rdquo; run.</>
                  )}
                </p>
                <Button size="sm" variant="outline" onClick={handleBack}>
                  Try another
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
