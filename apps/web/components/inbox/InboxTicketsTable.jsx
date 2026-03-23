"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { Inbox, Search, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function formatAssignee(member = null) {
  if (!member) return "Unassigned";
  const name = [member.first_name, member.last_name].filter(Boolean).join(" ").trim();
  return name || member.email || "Unassigned";
}

function formatCreated(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("da-DK", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatLastActivity(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return "just now";
  const diffMinutes = Math.floor(diffMs / 60_000);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("da-DK", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function normalizeStatusLabel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "solved" || normalized === "resolved") return "Resolved";
  if (normalized === "pending") return "Pending";
  if (normalized === "waiting") return "Waiting";
  if (normalized === "new") return "New";
  return "Open";
}

function statusClasses(status) {
  if (status === "Resolved") return "border-red-200 bg-red-50 text-red-700";
  if (status === "Pending") return "border-orange-200 bg-orange-50 text-orange-700";
  if (status === "Waiting") return "border-violet-200 bg-violet-50 text-violet-700";
  if (status === "New") return "border-green-200 bg-green-50 text-green-700";
  return "border-blue-200 bg-blue-50 text-blue-700";
}

export function InboxTicketsTable({ threads = [], members = [] }) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  const membersById = useMemo(() => {
    const map = new Map();
    (members || []).forEach((member) => {
      const userId = String(member?.user_id || "").trim();
      if (userId) map.set(userId, member);
    });
    return map;
  }, [members]);

  const rows = useMemo(() => {
    const normalizedQuery = String(deferredQuery || "").trim().toLowerCase();
    return (threads || [])
      .map((thread, index) => {
        const assigneeId = String(thread?.assignee_id || "").trim();
        const assignee = assigneeId ? membersById.get(assigneeId) || null : null;
        const subject = String(thread?.subject || "").trim() || "Untitled ticket";
        const status = normalizeStatusLabel(thread?.status);
        const createdAt = thread?.created_at || null;
        const lastActivity = thread?.last_message_at || thread?.updated_at || createdAt || null;
        const displayNumber = String(thread?.provider_thread_id || thread?.id || "").trim();
        return {
          id: String(thread?.id || ""),
          displayNumber: displayNumber || String(index + 1),
          subject,
          snippet: String(thread?.snippet || "").trim(),
          status,
          assigneeLabel: formatAssignee(assignee),
          createdAt,
          lastActivity,
        };
      })
      .filter((row) => {
        if (!normalizedQuery) return true;
        return [row.subject, row.snippet, row.assigneeLabel]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      });
  }, [deferredQuery, membersById, threads]);

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_top_left,rgba(15,23,42,0.04),transparent_28%),linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)]">
      <div className="border-b border-slate-200 bg-white/88 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-6 py-6 lg:px-10">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                <Inbox className="h-3.5 w-3.5" />
                Inbox overview
              </div>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950">Tickets</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-500">
                Browse every conversation in one long operational view and jump back into the inbox when needed.
              </p>
            </div>
            <div className="text-sm text-slate-500">{rows.length} tickets</div>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm">
              <Inbox className="h-4 w-4" />
              Inbox
            </div>
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search tickets..."
                className="h-11 rounded-xl border-slate-200 bg-white pl-11 text-sm shadow-sm"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-11 justify-start gap-2 rounded-xl border-slate-200 bg-white px-4 text-slate-700 shadow-sm"
              disabled
            >
              <SlidersHorizontal className="h-4 w-4" />
              Filters
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1600px] px-6 py-6 lg:px-10">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_40px_-24px_rgba(15,23,42,0.18)]">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-white">
                <TableRow className="border-b border-slate-200 bg-slate-50/70 hover:bg-slate-50/70">
                  <TableHead className="min-w-[420px]">Subject</TableHead>
                  <TableHead className="w-[180px]">Status</TableHead>
                  <TableHead className="w-[260px]">Assigned</TableHead>
                  <TableHead className="w-[180px]">Created</TableHead>
                  <TableHead className="w-[180px]">Last Activity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
              {rows.length ? (
                rows.map((row) => (
                  <TableRow key={row.id} className="border-b border-slate-200/80 hover:bg-slate-50/60">
                    <TableCell className="align-top">
                      <Link href={`/inbox?thread=${encodeURIComponent(row.id)}`} className="block py-1">
                        <div className="font-medium text-slate-900">{row.subject}</div>
                          <div className="mt-1 line-clamp-2 text-sm leading-6 text-slate-500">
                            {row.snippet || "No preview available."}
                          </div>
                        </Link>
                      </TableCell>
                      <TableCell className="align-top">
                        <Badge
                          variant="outline"
                          className={`mt-1 rounded-full px-2.5 py-1 text-xs font-semibold ${statusClasses(row.status)}`}
                        >
                          {row.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="align-top text-slate-600">{row.assigneeLabel}</TableCell>
                      <TableCell className="align-top text-slate-500">{formatCreated(row.createdAt)}</TableCell>
                      <TableCell className="align-top text-slate-500">{formatLastActivity(row.lastActivity)}</TableCell>
                    </TableRow>
                  ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="h-28 text-center text-sm text-slate-500">
                    No tickets matched your search.
                  </TableCell>
                </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </div>
  );
}
