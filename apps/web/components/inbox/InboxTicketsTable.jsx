"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { ArrowLeft, Clock3, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  formatTicketReference,
  ticketReferenceSearchTerms,
} from "@/lib/tickets/reference";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "waiting", label: "Waiting" },
  { value: "resolved", label: "Resolved" },
  { value: "unassigned", label: "Unassigned" },
];

function formatAssignee(member = null) {
  if (!member) return "Unassigned";
  const name = [member.first_name, member.last_name].filter(Boolean).join(" ").trim();
  return name || member.email || "Unassigned";
}

function formatCreated(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatRelativeTime(value) {
  const time = getTime(value);
  if (!time) return "No activity";

  const elapsed = Math.max(0, Date.now() - time);
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatCreated(value);
}

function getInitials(value) {
  const parts = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "—";
  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function getTime(value) {
  if (!value) return 0;
  const date = new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? 0 : time;
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
  if (status === "Resolved") return "border-green-200 bg-green-50 text-green-700";
  if (status === "Pending") return "border-orange-200 bg-orange-50 text-orange-700";
  if (status === "Waiting") return "border-violet-200 bg-violet-50 text-violet-700";
  if (status === "New") return "border-green-200 bg-green-50 text-green-700";
  return "border-blue-200 bg-blue-50 text-blue-700";
}

export function InboxTicketsTable({ threads = [], members = [] }) {
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const deferredQuery = useDeferredValue(query);

  const membersById = useMemo(() => {
    const map = new Map();
    (members || []).forEach((member) => {
      const userId = String(member?.user_id || "").trim();
      if (userId) map.set(userId, member);
    });
    return map;
  }, [members]);

  const allRows = useMemo(() => {
    return (threads || [])
      .map((thread) => {
        const assigneeId = String(thread?.assignee_id || "").trim();
        const assignee = assigneeId ? membersById.get(assigneeId) || null : null;
        const subject = String(thread?.subject || "").trim() || "Untitled ticket";
        const status = normalizeStatusLabel(thread?.status);
        const createdAt = thread?.created_at || null;
        const lastActivity = thread?.last_message_at || thread?.updated_at || createdAt || null;
        const ticketRef = formatTicketReference(thread?.ticket_number);
        const ticketRefSearchTerms = ticketReferenceSearchTerms(thread?.ticket_number);
        const customerName = String(thread?.customer_name || "").trim();
        const customerEmail = String(thread?.customer_email || "").trim();
        const assigneeLabel = formatAssignee(assignee);
        return {
          id: String(thread?.id || ""),
          ticketRef,
          ticketRefSearchTerms,
          subject,
          snippet: String(thread?.snippet || "").trim(),
          customerName,
          customerEmail,
          status,
          assigneeLabel,
          unread: thread?.is_read === false || Number(thread?.unread_count || 0) > 0,
          priority: String(thread?.priority || "").trim().toLowerCase(),
          createdAt,
          lastActivity,
        };
      })
      .sort((a, b) => getTime(b.lastActivity) - getTime(a.lastActivity));
  }, [membersById, threads]);

  const filterCounts = useMemo(() => {
    return {
      all: allRows.length,
      open: allRows.filter((row) => row.status !== "Resolved").length,
      waiting: allRows.filter((row) => row.status === "Waiting" || row.status === "Pending").length,
      resolved: allRows.filter((row) => row.status === "Resolved").length,
      unassigned: allRows.filter((row) => row.assigneeLabel === "Unassigned").length,
    };
  }, [allRows]);

  const assigneeOptions = useMemo(() => {
    return Array.from(new Set(allRows.map((row) => row.assigneeLabel))).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [allRows]);

  const rows = useMemo(() => {
    const normalizedQuery = String(deferredQuery || "").trim().toLowerCase();
    return allRows
      .filter((row) => {
        if (activeFilter === "open") return row.status !== "Resolved";
        if (activeFilter === "waiting") return row.status === "Waiting" || row.status === "Pending";
        if (activeFilter === "resolved") return row.status === "Resolved";
        if (activeFilter === "unassigned") return row.assigneeLabel === "Unassigned";
        return true;
      })
      .filter((row) => assigneeFilter === "all" || row.assigneeLabel === assigneeFilter)
      .filter((row) => {
        if (!normalizedQuery) return true;
        const ticketMatch = normalizedQuery.startsWith("t-")
          ? row.ticketRef.toLowerCase().includes(normalizedQuery) ||
            row.ticketRefSearchTerms.some((term) => term.includes(normalizedQuery))
          : false;
        return (
          ticketMatch ||
          [row.subject, row.snippet, row.customerName, row.customerEmail, row.assigneeLabel]
            .join(" ")
            .toLowerCase()
            .includes(normalizedQuery)
        );
      });
  }, [activeFilter, allRows, assigneeFilter, deferredQuery]);

  const visibleRowIds = useMemo(() => rows.map((row) => row.id).filter(Boolean), [rows]);
  const selectedVisibleCount = visibleRowIds.filter((id) => selectedIds.has(id)).length;
  const allVisibleSelected = visibleRowIds.length > 0 && selectedVisibleCount === visibleRowIds.length;
  const selectedCount = selectedIds.size;
  const firstSelectedId = selectedIds.values().next().value || "";

  function setAllVisibleSelected(checked) {
    setSelectedIds((current) => {
      const next = new Set(current);
      visibleRowIds.forEach((id) => {
        if (checked) next.add(id);
        else next.delete(id);
      });
      return next;
    });
  }

  function setRowSelected(id, checked) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <div className="min-h-full bg-muted/[0.18]">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col px-4 py-4 sm:px-6 lg:px-10">
        <Card className="overflow-hidden rounded-2xl border-border/80 shadow-none">
          <CardHeader className="gap-3 p-3 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <Link
                  href="/inbox"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-muted hover:text-foreground active:scale-[0.98]"
                >
                  <ArrowLeft className="size-4" />
                  <span className="hidden sm:inline">Back to inbox</span>
                </Link>
                <span className="h-5 w-px bg-border" aria-hidden="true" />
                <h1 className="truncate text-base font-semibold text-foreground">All tickets</h1>
              </div>

              <div className="text-sm text-muted-foreground" aria-live="polite">
                {rows.length === allRows.length ? (
                  <span className="font-medium text-foreground">{allRows.length} tickets</span>
                ) : (
                  <>
                    Showing <span className="font-medium text-foreground">{rows.length}</span> of{" "}
                    <span className="font-medium text-foreground">{allRows.length}</span>
                  </>
                )}
              </div>
            </div>

            <Separator />

            <div className="grid min-w-0 grid-cols-1 gap-2 xl:grid-cols-[auto_minmax(0,1fr)_auto]">
              <Tabs value={activeFilter} onValueChange={setActiveFilter} className="min-w-0 overflow-x-auto">
                <TabsList className="h-10 justify-start">
                  {FILTERS.map((filter) => (
                    <TabsTrigger key={filter.value} value={filter.value} className="gap-2">
                      {filter.label}
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {filterCounts[filter.value]}
                      </span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>

              <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_220px]">
                <div className="relative min-w-0">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search by subject, ticket ID, assignee..."
                    className="h-10 pl-9"
                  />
                </div>

                <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="Assigned to" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="all">All assignees</SelectItem>
                      {assigneeOptions.map((assignee) => (
                        <SelectItem key={assignee} value={assignee}>
                          {assignee}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              <Button
                type="button"
                variant="outline"
                className="h-10 justify-start gap-2"
                disabled={!query && activeFilter === "all" && assigneeFilter === "all"}
                onClick={() => {
                  setQuery("");
                  setActiveFilter("all");
                  setAssigneeFilter("all");
                }}
              >
                <X className="size-4" />
                Clear filters
              </Button>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {selectedCount > 0 ? (
              <div className="flex flex-col gap-2 border-t bg-muted/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm font-medium">
                  {selectedCount} ticket{selectedCount === 1 ? "" : "s"} selected
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button type="button" variant="outline" size="sm" onClick={() => setSelectedIds(new Set())}>
                    Clear selection
                  </Button>
                  <Button asChild size="sm">
                    <Link href={`/inbox?thread=${encodeURIComponent(firstSelectedId)}`}>Open selected</Link>
                  </Button>
                </div>
              </div>
            ) : null}

            <Table className="table-fixed">
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow className="border-b border-border/80 bg-muted/25 hover:bg-muted/25">
                  <TableHead className="w-12 px-4 py-2 sm:px-5">
                    <Checkbox
                      checked={allVisibleSelected ? true : selectedVisibleCount > 0 ? "indeterminate" : false}
                      onCheckedChange={(checked) => setAllVisibleSelected(checked === true)}
                      aria-label="Select visible tickets"
                    />
                  </TableHead>
                  <TableHead className="w-[51%] px-4 py-2 text-[11px] uppercase tracking-[0.08em] sm:px-5">Conversation</TableHead>
                  <TableHead className="w-[13%] px-4 py-2 text-[11px] uppercase tracking-[0.08em] sm:px-5">Status</TableHead>
                  <TableHead className="w-[20%] px-4 py-2 text-[11px] uppercase tracking-[0.08em] sm:px-5">Owner</TableHead>
                  <TableHead className="w-[16%] px-4 py-2 text-[11px] uppercase tracking-[0.08em] sm:px-5">Last activity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length ? (
                  rows.map((row) => (
                    <TableRow
                      key={row.id}
                      className={cn(
                        "group border-b border-border/70 transition-colors hover:bg-muted/35",
                        selectedIds.has(row.id) && "bg-primary/[0.03]"
                      )}
                    >
                      <TableCell className="px-4 py-3 align-middle sm:px-5">
                        <Checkbox
                          checked={selectedIds.has(row.id)}
                          onCheckedChange={(checked) => setRowSelected(row.id, checked === true)}
                          aria-label={`Select ${row.ticketRef}`}
                        />
                      </TableCell>
                      <TableCell className="px-4 py-3 align-middle sm:px-5">
                        <Link href={`/inbox?thread=${encodeURIComponent(row.id)}`} className="block min-w-0">
                          <div className="flex min-w-0 items-center gap-2">
                            <div className="max-w-[180px] shrink-0 truncate text-xs font-medium text-muted-foreground">
                              {row.customerName || row.customerEmail || "Unknown customer"}
                            </div>
                            <span className="text-muted-foreground/60" aria-hidden="true">—</span>
                            <div
                              className={cn(
                                "max-w-[320px] shrink truncate font-semibold text-foreground",
                                row.unread && "font-bold"
                              )}
                            >
                              {row.subject}
                            </div>
                            {row.snippet ? (
                              <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground lg:inline">
                                — {row.snippet}
                              </span>
                            ) : null}
                            <span
                              className={cn(
                                "shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold tracking-[0.04em]",
                                row.ticketRef !== "No ticket ID"
                                  ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                                  : "border-border bg-muted text-muted-foreground"
                              )}
                            >
                              {row.ticketRef}
                            </span>
                            {row.unread ? (
                              <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />
                            ) : null}
                          </div>
                        </Link>
                      </TableCell>
                      <TableCell className="px-4 py-3 align-middle sm:px-5">
                        <Badge
                          variant="outline"
                          className={`mt-1 rounded-full px-2.5 py-1 text-xs font-semibold ${statusClasses(row.status)}`}
                        >
                          {row.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-4 py-3 align-middle text-sm sm:px-5">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span
                            className={cn(
                              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                              row.assigneeLabel === "Unassigned"
                                ? "bg-orange-500/10 text-orange-700"
                                : "bg-muted text-muted-foreground"
                            )}
                          >
                            {row.assigneeLabel === "Unassigned" ? "—" : getInitials(row.assigneeLabel)}
                          </span>
                          <span
                            className={cn(
                              "min-w-0 truncate font-medium",
                              row.assigneeLabel === "Unassigned" ? "text-orange-700" : "text-foreground"
                            )}
                          >
                            {row.assigneeLabel}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="px-4 py-3 align-middle text-sm sm:px-5">
                        <div className="flex items-center gap-1.5 font-medium text-foreground">
                          <Clock3 className="size-3.5 text-muted-foreground" />
                          {formatRelativeTime(row.lastActivity)}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">Created {formatCreated(row.createdAt)}</div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="h-32 text-center text-sm text-muted-foreground">
                      No tickets match this view.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
