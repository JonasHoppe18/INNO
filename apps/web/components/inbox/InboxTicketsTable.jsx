"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { CheckCircle2, Inbox, Search, Ticket, UserRound, X } from "lucide-react";
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
  return date.toLocaleDateString("da-DK", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatLastActivity(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("da-DK", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
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
        const ticketNumber = Number(thread?.ticket_number);
        const hasTicketNumber = Number.isFinite(ticketNumber) && ticketNumber > 0;
        const ticketRef = hasTicketNumber
          ? `T-${String(ticketNumber).padStart(6, "0")}`
          : "No ticket ID";
        const ticketRefRaw = hasTicketNumber ? `t-${ticketNumber}` : "";
        return {
          id: String(thread?.id || ""),
          ticketRef,
          ticketRefRaw,
          subject,
          snippet: String(thread?.snippet || "").trim(),
          status,
          assigneeLabel: formatAssignee(assignee),
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
            row.ticketRefRaw.includes(normalizedQuery)
          : false;
        return (
          ticketMatch ||
          [row.subject, row.snippet, row.assigneeLabel]
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
    <div className="min-h-full bg-muted/30">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 px-5 py-5 lg:px-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Inbox className="size-4" />
              Inbox overview
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Tickets</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Search, filter, and jump into customer conversations.
            </p>
          </div>
          <Button asChild className="w-full justify-center lg:w-auto">
            <Link href="/inbox">
              Open inbox
              <Inbox className="size-4" />
            </Link>
          </Button>
        </div>

        <Card className="overflow-hidden rounded-lg border-border shadow-sm">
          <CardHeader className="gap-4 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-lg border bg-background px-3 py-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <Ticket className="size-3.5" />
                    Total
                  </div>
                  <div className="mt-1 text-xl font-semibold">{filterCounts.all}</div>
                </div>
                <div className="rounded-lg border bg-background px-3 py-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <Inbox className="size-3.5" />
                    Open
                  </div>
                  <div className="mt-1 text-xl font-semibold">{filterCounts.open}</div>
                </div>
                <div className="rounded-lg border bg-background px-3 py-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <UserRound className="size-3.5" />
                    Unassigned
                  </div>
                  <div className="mt-1 text-xl font-semibold">{filterCounts.unassigned}</div>
                </div>
                <div className="rounded-lg border bg-background px-3 py-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <CheckCircle2 className="size-3.5" />
                    Resolved
                  </div>
                  <div className="mt-1 text-xl font-semibold">{filterCounts.resolved}</div>
                </div>
              </div>

              <div className="text-sm text-muted-foreground">
                Showing <span className="font-medium text-foreground">{rows.length}</span> of{" "}
                <span className="font-medium text-foreground">{allRows.length}</span>
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
              <TableHeader className="sticky top-0 z-10 bg-white">
                <TableRow className="border-b border-slate-200 bg-slate-50/70 hover:bg-slate-50/70">
                  <TableHead className="w-12 px-5 py-3">
                    <Checkbox
                      checked={allVisibleSelected ? true : selectedVisibleCount > 0 ? "indeterminate" : false}
                      onCheckedChange={(checked) => setAllVisibleSelected(checked === true)}
                      aria-label="Select visible tickets"
                    />
                  </TableHead>
                  <TableHead className="w-[56%] px-5 py-3">Conversation</TableHead>
                  <TableHead className="w-[14%] px-5 py-3">Status</TableHead>
                  <TableHead className="w-[26%] px-5 py-3">Owner and timing</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length ? (
                  rows.map((row) => (
                    <TableRow key={row.id} className="border-b border-slate-200/80 hover:bg-slate-50/60">
                      <TableCell className="px-5 py-4 align-top">
                        <Checkbox
                          checked={selectedIds.has(row.id)}
                          onCheckedChange={(checked) => setRowSelected(row.id, checked === true)}
                          aria-label={`Select ${row.ticketRef}`}
                        />
                      </TableCell>
                      <TableCell className="px-5 py-4 align-top">
                        <Link href={`/inbox?thread=${encodeURIComponent(row.id)}`} className="block min-w-0">
                          <div className="flex min-w-0 items-center gap-2">
                            <div
                              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-[0.06em] ${
                                row.ticketRef !== "No ticket ID"
                                  ? "border border-indigo-200 bg-indigo-50 font-mono text-indigo-700"
                                  : "border border-slate-200 bg-slate-50 text-slate-500"
                              }`}
                            >
                              {row.ticketRef}
                            </div>
                            <div className="truncate font-medium text-foreground">{row.subject}</div>
                          </div>
                          <div className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">
                            {row.snippet || "No preview available."}
                          </div>
                        </Link>
                      </TableCell>
                      <TableCell className="px-5 py-4 align-top">
                        <Badge
                          variant="outline"
                          className={`mt-1 rounded-full px-2.5 py-1 text-xs font-semibold ${statusClasses(row.status)}`}
                        >
                          {row.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-5 py-4 align-top text-sm">
                        <div
                          className={cn(
                            "font-medium",
                            row.assigneeLabel === "Unassigned" ? "text-orange-700" : "text-foreground"
                          )}
                        >
                          {row.assigneeLabel}
                        </div>
                        <div className="mt-1 text-muted-foreground">Created {formatCreated(row.createdAt)}</div>
                        <div className="text-muted-foreground">
                          Last activity {formatLastActivity(row.lastActivity)}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={4} className="h-28 text-center text-sm text-slate-500">
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
