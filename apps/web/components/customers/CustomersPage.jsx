"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useOrganization } from "@clerk/nextjs";
import {
  ArrowDownUp,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Mail,
  Package,
  RefreshCw,
  Search,
  Store,
  Ticket,
  Users,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatTicketReference } from "@/lib/tickets/reference";

const PAGE_SIZE = 25;
const EMPTY_CUSTOMERS = [];
const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
function date(value) {
  return value && Number.isFinite(Date.parse(value))
    ? dateFormat.format(new Date(value))
    : "—";
}
function initials(name) {
  return name
    .split(/[\s@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
function statusLabel(status) {
  return String(status || "Unknown")
    .replace(/_/g, " ")
    .replace(/^./, (char) => char.toUpperCase());
}
function money(amount, currency) {
  if (amount == null || !Number.isFinite(Number(amount))) return "—";
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
    }).format(Number(amount));
  } catch {
    return `${amount} ${currency || ""}`.trim();
  }
}

async function readJson(response) {
  const payload = await response.json();
  if (!response.ok)
    throw new Error(payload.error || "Could not load customers.");
  return payload;
}

function BlankState({ icon: Icon, title, children }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <div className="flex size-11 items-center justify-center rounded-xl border border-border bg-muted/40">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

function OrderState({ result }) {
  if (!result)
    return <span className="text-muted-foreground">View orders</span>;
  if (result.status === "loading")
    return <span className="text-muted-foreground">Checking…</span>;
  if (result.status === "error")
    return <span className="text-muted-foreground">Unavailable</span>;
  if (result.status === "not_connected")
    return <span className="text-muted-foreground">No store connected</span>;
  return (
    <Badge variant={result.orders.length ? "secondary" : "outline"}>
      {result.orders.length
        ? `${result.orders.length}${result.orders.length === result.limit ? "+" : ""} orders`
        : "No orders found"}
    </Badge>
  );
}

export function CustomersPage() {
  const { organization, isLoaded } = useOrganization();
  const organizationId = organization?.id || "personal";
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("recent");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [orderResults, setOrderResults] = useState({});
  const [orderRefresh, setOrderRefresh] = useState(0);

  useEffect(() => {
    if (!isLoaded) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setData(null);
    setSelected(null);
    setOrderResults({});
    setPage(1);
    fetch("/api/customers", { cache: "no-store", signal: controller.signal })
      .then(readJson)
      .then(setData)
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [organizationId, isLoaded, retryAttempt]);

  useEffect(() => {
    setPage(1);
  }, [search, filter, sort]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    const id = selected.id;
    setOrderResults((prev) => ({ ...prev, [id]: { status: "loading" } }));
    fetch(`/api/customers?customer=${encodeURIComponent(id)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(readJson)
      .then((result) => {
        if (!controller.signal.aborted)
          setOrderResults((prev) => ({ ...prev, [id]: result }));
      })
      .catch((err) => {
        if (!controller.signal.aborted)
          setOrderResults((prev) => ({
            ...prev,
            [id]: { status: "error", error: err.message },
          }));
      });
    return () => {
      controller.abort();
      setOrderResults((prev) => {
        if (prev[id]?.status !== "loading") return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    };
  }, [selected, orderRefresh]);

  const customers = data?.customers || EMPTY_CUSTOMERS;
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return customers
      .filter(
        (customer) =>
          (!query ||
            `${customer.name} ${customer.email}`
              .toLowerCase()
              .includes(query)) &&
          (filter !== "open" || customer.openTicketCount > 0) &&
          (filter !== "returning" || customer.ticketCount > 1),
      )
      .sort((a, b) =>
        sort === "name"
          ? a.name.localeCompare(b.name)
          : sort === "tickets"
            ? b.ticketCount - a.ticketCount
            : String(b.lastContactAt).localeCompare(String(a.lastContactAt)),
      );
  }, [customers, search, filter, sort]);
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const pageRows = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const orderResult = selected ? orderResults[selected.id] : null;

  return (
    <main className="flex min-w-0 flex-col gap-7 bg-background px-4 py-6 text-foreground lg:px-10 lg:py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Every customer conversation, connected to their store.
          </p>
        </div>
      </header>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <ToggleGroup
            type="single"
            size="sm"
            value={filter}
            onValueChange={(value) => value && setFilter(value)}
            aria-label="Customer filter"
          >
            <ToggleGroupItem value="all">All customers</ToggleGroupItem>
            <ToggleGroupItem value="open">Open tickets</ToggleGroupItem>
            <ToggleGroupItem value="returning">Repeat contacts</ToggleGroupItem>
          </ToggleGroup>
          <p className="text-xs text-muted-foreground">
            Customers with support conversations
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search customers"
              placeholder="Search by name or email…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="w-44" aria-label="Sort customers">
              <ArrowDownUp className="mr-2 size-3.5 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="recent">Latest contact</SelectItem>
                <SelectItem value="name">Name A–Z</SelectItem>
                <SelectItem value="tickets">Most tickets</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        {error ? (
          <div role="alert" className="flex flex-col items-center gap-3 p-12">
            <p className="text-sm text-destructive">{error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRetryAttempt((value) => value + 1)}
            >
              Try again
            </Button>
          </div>
        ) : loading ? (
          <div
            aria-label="Loading customers"
            className="flex flex-col gap-6 p-6"
          >
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : !visible.length ? (
          <BlankState
            icon={Users}
            title={
              customers.length
                ? "No customers found"
                : "Your customers will appear here"
            }
          >
            {customers.length
              ? "Try another name, email or filter."
              : "When someone writes to your inbox, their tickets and store orders will be collected here."}
          </BlankState>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Customer</TableHead>
                  <TableHead>Tickets</TableHead>
                  <TableHead>Orders</TableHead>
                  <TableHead>Last contact</TableHead>
                  <TableHead className="w-10">
                    <span className="sr-only">Open profile</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell className="pl-5">
                      <button
                        type="button"
                        className="flex items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => setSelected(customer)}
                      >
                        <Avatar className="size-9">
                          <AvatarFallback>
                            {initials(customer.name)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="flex flex-col gap-0.5">
                          <span className="font-medium">{customer.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {customer.email}
                          </span>
                        </span>
                      </button>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="tabular-nums">
                          {customer.ticketCount}
                        </span>
                        {customer.openTicketCount > 0 && (
                          <Badge variant="secondary">
                            {customer.openTicketCount} open
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        className="rounded-md text-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => setSelected(customer)}
                        aria-label={`View orders for ${customer.name}`}
                      >
                        <OrderState result={orderResults[customer.id]} />
                      </button>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {date(customer.lastContactAt)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Open ${customer.name}`}
                        onClick={() => setSelected(customer)}
                      >
                        <ChevronRight />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between gap-4 border-t border-border px-5 py-3">
              <p className="text-xs text-muted-foreground">
                {(page - 1) * PAGE_SIZE + 1}–
                {Math.min(page * PAGE_SIZE, visible.length)} of {visible.length}{" "}
                customers
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Previous page"
                  disabled={page <= 1}
                  onClick={() => setPage((value) => value - 1)}
                >
                  <ChevronLeft />
                </Button>
                <span className="text-xs text-muted-foreground">
                  {page} / {pages}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Next page"
                  disabled={page >= pages}
                  onClick={() => setPage((value) => value + 1)}
                >
                  <ChevronRight />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      <Sheet
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <SheetContent className="flex w-full flex-col gap-6 overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Customer profile</SheetTitle>
            <SheetDescription>
              Contact details, support history and store orders.
            </SheetDescription>
          </SheetHeader>
          {selected && (
            <>
              <div className="flex items-center gap-4">
                <Avatar className="size-12">
                  <AvatarFallback>{initials(selected.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold">
                    {selected.name}
                  </h2>
                  <a
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                    href={`mailto:${selected.email}`}
                  >
                    <Mail className="size-3.5 shrink-0" />
                    <span className="truncate">{selected.email}</span>
                  </a>
                </div>
              </div>
              <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/20 p-4">
                <p className="text-xs text-muted-foreground">First contact</p>
                <p className="text-sm">{date(selected.firstContactAt)}</p>
              </div>
              <section
                className="flex flex-col gap-3"
                aria-label="Customer tickets"
              >
                <div className="flex items-center gap-2">
                  <Ticket className="size-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">Tickets</h3>
                  <Badge variant="secondary">{selected.ticketCount}</Badge>
                </div>
                <div className="divide-y divide-border rounded-lg border border-border">
                  {selected.tickets.map((ticket) => (
                    <Link
                      key={ticket.id}
                      href={`/inbox?view=all&thread=${encodeURIComponent(ticket.id)}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="flex min-w-0 flex-col gap-1">
                        <p className="truncate text-sm font-medium">
                          {ticket.subject}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatTicketReference(ticket.ticketNumber)} ·{" "}
                          {date(ticket.lastMessageAt)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant="outline">
                          {statusLabel(ticket.status)}
                        </Badge>
                        <ArrowUpRight className="size-3.5 text-muted-foreground" />
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
              <section
                className="flex flex-col gap-3"
                aria-label="Customer orders"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Package className="size-4 text-muted-foreground" />
                    <h3 className="text-sm font-semibold">Orders</h3>
                    {orderResult?.status === "checked" && (
                      <Badge variant="secondary">
                        {orderResult.orders.length}
                      </Badge>
                    )}
                  </div>
                  {selected.shopId && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={orderResult?.status === "loading"}
                      onClick={() => setOrderRefresh((value) => value + 1)}
                      aria-label="Refresh orders"
                    >
                      <RefreshCw />
                      Refresh
                    </Button>
                  )}
                </div>
                {!orderResult || orderResult.status === "loading" ? (
                  <div
                    aria-label="Checking store orders"
                    className="flex flex-col gap-3"
                  >
                    <Skeleton className="h-20 w-full" />
                    <Skeleton className="h-20 w-full" />
                  </div>
                ) : orderResult.status === "error" ? (
                  <div
                    role="alert"
                    className="flex flex-col gap-3 rounded-lg border border-border p-4"
                  >
                    <p className="text-sm text-muted-foreground">
                      Orders could not be checked. Please try again.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setOrderRefresh((value) => value + 1)}
                    >
                      Try again
                    </Button>
                  </div>
                ) : orderResult.status === "not_connected" ? (
                  <BlankState icon={Store} title="No store connected">
                    Connect a Shopify store to this inbox in Settings to check
                    orders.
                  </BlankState>
                ) : !orderResult.orders.length ? (
                  <BlankState icon={Package} title="No orders found">
                    Shopify returned no accessible orders for this email
                    address. Older orders may require additional access.
                  </BlankState>
                ) : (
                  <div className="flex flex-col gap-3">
                    {orderResult.orders.map((order) => (
                      <a
                        key={order.id}
                        href={order.adminUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex flex-col gap-3 rounded-lg border border-border p-4 outline-none hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex flex-col gap-1">
                            <p className="flex items-center gap-2 text-sm font-semibold">
                              #{order.orderNumber}
                              <ArrowUpRight className="size-3.5 text-muted-foreground" />
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {date(order.createdAt)}
                            </p>
                          </div>
                          <span className="text-sm font-medium">
                            {money(order.total, order.currency)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {order.items
                            ?.map((item) => `${item.quantity} × ${item.title}`)
                            .join(", ") || "No item details"}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="outline">
                            {statusLabel(order.financialStatus)}
                          </Badge>
                          <Badge variant="secondary">
                            {statusLabel(
                              order.fulfillmentStatus || order.status,
                            )}
                          </Badge>
                        </div>
                      </a>
                    ))}
                    <p className="text-xs text-muted-foreground">
                      Up to 50 recent orders available to the Shopify
                      connection. Open an order to view it in Shopify.
                    </p>
                  </div>
                )}
              </section>
            </>
          )}
        </SheetContent>
      </Sheet>
    </main>
  );
}
