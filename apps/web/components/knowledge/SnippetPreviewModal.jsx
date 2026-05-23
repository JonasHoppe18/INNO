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
    <div className="flex h-full flex-col rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
        <div className="flex items-center gap-2">
          <p className="text-[12px] font-semibold text-gray-700">{title}</p>
          {badge && (
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                badgeTone === "indigo" && "bg-indigo-50 text-indigo-600",
                badgeTone === "gray" && "bg-gray-100 text-gray-500"
              )}
            >
              {badge}
            </span>
          )}
        </div>
        {run?.latency_ms != null && !isLoading && (
          <span className="text-[10px] text-gray-400">{run.latency_ms} ms</span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 text-[12.5px] leading-relaxed text-gray-700">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-4/6" />
          </div>
        ) : run?.error ? (
          <div className="rounded-md bg-red-50 px-2.5 py-2 text-[11.5px] text-red-700">
            {run.error}
          </div>
        ) : text ? (
          <p className="whitespace-pre-wrap">{text}</p>
        ) : (
          <p className="text-gray-300 italic">No draft generated.</p>
        )}
      </div>
      {!isLoading && Array.isArray(run?.sources) && run.sources.length > 0 && (
        <div className="border-t border-gray-100 px-3 py-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            Top sources
          </p>
          <ul className="space-y-0.5">
            {run.sources.slice(0, 4).map((s, i) => (
              <li key={i} className="truncate text-[10.5px] text-gray-500">
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
          <label className="text-[11px] font-medium text-gray-600">
            Customer message <span className="text-red-500">*</span>
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Paste or type the customer's message here — write it the way a customer would actually phrase it."
            rows={9}
            className="w-full resize-none rounded-md border border-gray-200 bg-white px-3 py-2.5 text-[12.5px] leading-relaxed text-gray-700 placeholder:text-gray-300 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            autoFocus
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-gray-600">
              Subject <span className="text-gray-400">(optional)</span>
            </label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Cannot pair AirPods"
              className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 placeholder:text-gray-300 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-gray-600">
              Customer email <span className="text-gray-400">(optional)</span>
            </label>
            <input
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              type="email"
              placeholder="customer@example.com"
              className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 placeholder:text-gray-300 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
        </div>
        <p className="text-[11px] text-gray-400">
          The test runs against a single message — no order context or conversation history. Use this for quick iteration; pick a real ticket when you need full context.
        </p>
      </div>
      <div className="flex justify-end border-t border-gray-100 pt-3">
        <Button type="submit" size="sm" disabled={!canSubmit}>
          <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          Run preview
        </Button>
      </div>
    </form>
  );
}

function ThreadPicker({ threads, loading, onSelect }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) =>
      `${t.subject} ${t.preview} ${t.customer_email || ""}`
        .toLowerCase()
        .includes(q)
    );
  }, [threads, query]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-gray-100 px-1 pb-3">
        <Search className="h-3.5 w-3.5 text-gray-300" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by subject, customer, or preview..."
          className="flex-1 bg-transparent text-[12px] text-gray-700 placeholder:text-gray-300 outline-none"
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
          <p className="px-2 py-8 text-center text-[12px] text-gray-400">
            {query ? "No tickets match your search." : "No tickets found for this shop."}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {filtered.map((thread) => (
              <li key={thread.thread_id}>
                <button
                  type="button"
                  onClick={() => onSelect(thread)}
                  className="group flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition-colors hover:bg-gray-50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-[12.5px] font-medium text-gray-800">
                      {thread.subject}
                    </span>
                    <span className="shrink-0 text-[10.5px] text-gray-400">
                      {formatRelative(thread.last_message_at)}
                    </span>
                  </div>
                  {thread.customer_email && (
                    <span className="truncate text-[11px] text-gray-500">
                      {thread.customer_email}
                    </span>
                  )}
                  {thread.preview && (
                    <span className="truncate text-[11px] text-gray-400">
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

export function SnippetPreviewModal({ open, onOpenChange, snippetId, snippetTitle }) {
  const [threads, setThreads] = useState([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [pickerMode, setPickerMode] = useState("inbox"); // "inbox" | "custom"
  // Tracks whether a preview is in progress / has a result. Holds either a
  // selected-thread object or { custom: true } so we know to show the result
  // panel rather than the picker.
  const [previewSource, setPreviewSource] = useState(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!open) return;
    setPickerMode("inbox");
    setPreviewSource(null);
    setResult(null);
    setThreadsLoading(true);
    fetch("/api/knowledge/snippets/preview/threads?limit=30", {
      credentials: "include",
    })
      .then((r) => r.json())
      .then((data) => {
        setThreads(Array.isArray(data?.threads) ? data.threads : []);
      })
      .catch(() => setThreads([]))
      .finally(() => setThreadsLoading(false));
  }, [open]);

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
          body: JSON.stringify({
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
    [snippetId]
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
          body: JSON.stringify({
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
    [snippetId]
  );

  const handleBack = () => {
    setPreviewSource(null);
    setResult(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[min(96vw,1100px)] max-w-none overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="border-b border-gray-100 px-5 py-3.5">
          <DialogTitle className="flex items-center gap-2 text-[14px] font-semibold">
            {previewSource && (
              <button
                type="button"
                onClick={handleBack}
                className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
              </button>
            )}
            <Sparkles className="h-4 w-4 text-indigo-500" />
            <span>
              {previewSource
                ? "Snippet preview — A/B comparison"
                : "Test your snippet"}
            </span>
            {snippetTitle && !previewSource && (
              <span className="ml-2 truncate rounded-full bg-gray-100 px-2 py-0.5 text-[10.5px] font-normal text-gray-500">
                {snippetTitle}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="h-[min(80vh,720px)] overflow-hidden">
          {!previewSource ? (
            <div className="flex h-full flex-col px-5 py-3">
              <p className="mb-3 text-[11.5px] text-gray-500">
                We&apos;ll run the AI pipeline twice — once with your snippet present, once without — so you can see exactly what it adds.
              </p>
              <div className="mb-3 inline-flex w-fit gap-0.5 rounded-md border border-gray-200 bg-gray-50 p-0.5">
                <button
                  type="button"
                  onClick={() => setPickerMode("inbox")}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                    pickerMode === "inbox"
                      ? "bg-white text-gray-800 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  )}
                >
                  <Inbox className="h-3 w-3" />
                  Pick from inbox
                </button>
                <button
                  type="button"
                  onClick={() => setPickerMode("custom")}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                    pickerMode === "custom"
                      ? "bg-white text-gray-800 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
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
                  />
                ) : (
                  <CustomMessageForm onSubmit={runCustomPreview} />
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col">
              {/* Customer message panel */}
              <div className="border-b border-gray-100 bg-gray-50/50 px-5 py-3">
                <div className="flex items-start gap-2">
                  <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <p className="text-[11.5px] font-semibold text-gray-600">
                        Customer wrote
                      </p>
                      {result?.customer_email && (
                        <p className="truncate text-[11px] text-gray-400">
                          {result.customer_email}
                        </p>
                      )}
                    </div>
                    {result?.subject && (
                      <p className="mt-0.5 text-[12px] font-medium text-gray-700">
                        {result.subject}
                      </p>
                    )}
                    {result?.customer_message ? (
                      <p className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap text-[11.5px] leading-relaxed text-gray-600">
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
                    "flex items-center gap-2 border-b px-5 py-2 text-[11.5px]",
                    result.snippet_was_retrieved
                      ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                      : "border-amber-100 bg-amber-50 text-amber-700"
                  )}
                >
                  {result.snippet_was_retrieved ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5" />
                  )}
                  <p>
                    {result.snippet_was_retrieved
                      ? "Your snippet was retrieved for this ticket. The drafts below show what changes when it's removed."
                      : "Your snippet was NOT retrieved for this ticket — try rephrasing the question to match the customer's wording, or add more relevant issue tags."}
                  </p>
                </div>
              )}

              {/* A/B drafts */}
              <div className="grid flex-1 grid-cols-2 gap-3 overflow-hidden px-5 py-3">
                <DraftCard
                  title="With your snippet"
                  badge="Baseline"
                  badgeTone="indigo"
                  run={result?.with_snippet}
                  isLoading={running}
                />
                <DraftCard
                  title="Without your snippet"
                  badge="Excluded"
                  badgeTone="gray"
                  run={result?.without_snippet}
                  isLoading={running}
                />
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-5 py-2.5">
                <p className="flex items-center gap-1.5 text-[11px] text-gray-400">
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
