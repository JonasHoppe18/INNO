"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Search } from "lucide-react";

function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function statusBadgeClass(status) {
  const s = String(status || "").toLowerCase();
  if (s === "solved" || s === "closed") return "bg-slate-100 text-slate-600";
  if (s === "open") return "bg-emerald-50 text-emerald-700 border border-emerald-200";
  return "bg-slate-100 text-slate-600";
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function ThreadPickerModal({ open, onOpenChange, onSelect }) {
  const [query, setQuery] = useState("");
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  const debouncedQuery = useDebounce(query, 300);

  const fetchThreads = useCallback(async (q) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "30" });
      if (q) params.set("q", q);
      const res = await fetch(`/api/fine-tuning/threads?${params}`, { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not load tickets.");
      setThreads(data.threads || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load tickets.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch when modal opens or search query changes
  useEffect(() => {
    if (!open) return;
    fetchThreads(debouncedQuery);
  }, [open, debouncedQuery, fetchThreads]);

  // Focus search input when modal opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 80);
    } else {
      setQuery("");
    }
  }, [open]);

  function handleSelect(thread) {
    onSelect({
      id: thread.id,
      from: thread.customer_email,
      subject: thread.subject,
      body: thread.latest_message || thread.subject || "",
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-hidden p-0 sm:max-w-[600px]">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="text-base font-semibold">Select ticket</DialogTitle>
        </DialogHeader>

        {/* Search */}
        <div className="border-b px-4 py-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tickets by subject or email..."
              className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
        </div>

        {/* Thread list */}
        <div className="min-h-0 flex-1 overflow-y-auto" style={{ maxHeight: "calc(80vh - 130px)" }}>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <p className="px-4 py-6 text-center text-sm text-destructive">{error}</p>
          ) : threads.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              {query ? "No tickets match your search." : "No tickets found."}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-left text-xs font-medium text-muted-foreground">
                  <th className="px-4 py-2">Subject</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Email</th>
                  <th className="px-4 py-2 whitespace-nowrap">Latest activity</th>
                </tr>
              </thead>
              <tbody>
                {threads.map((thread) => (
                  <tr
                    key={thread.id}
                    onClick={() => handleSelect(thread)}
                    className="cursor-pointer border-b last:border-0 transition-colors hover:bg-slate-50"
                  >
                    <td className="max-w-[200px] truncate px-4 py-3 font-medium text-slate-800">
                      {thread.subject}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${statusBadgeClass(thread.status)}`}
                      >
                        {thread.status}
                      </span>
                    </td>
                    <td className="max-w-[160px] truncate px-4 py-3 text-muted-foreground">
                      {thread.customer_email}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {formatDate(thread.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
