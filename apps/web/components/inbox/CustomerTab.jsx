import { memo } from "react";
import { ChevronRight, ExternalLink, RefreshCw, ShoppingBag, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatTicketReference } from "@/lib/tickets/reference";
import { getCustomerDisplayName } from "@/lib/inbox/customer-display";

const DISPLAY_LOCALE = "en-GB";
const DISPLAY_TIMEZONE = "Europe/Copenhagen";

const getDateKey = (date) => {
  const parts = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    timeZone: DISPLAY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const getCalendarDayDistance = (fromKey, toKey) => {
  const [fromYear, fromMonth, fromDay] = String(fromKey).split("-").map(Number);
  const [toYear, toMonth, toDay] = String(toKey).split("-").map(Number);
  if (![fromYear, fromMonth, fromDay, toYear, toMonth, toDay].every(Number.isFinite)) {
    return null;
  }
  return Math.round(
    (Date.UTC(fromYear, fromMonth - 1, fromDay) - Date.UTC(toYear, toMonth - 1, toDay)) /
      (24 * 60 * 60 * 1000),
  );
};

const formatHistoryTimestamp = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const daysAgo = getCalendarDayDistance(getDateKey(new Date()), getDateKey(date));
  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  if (daysAgo > 1 && daysAgo < 7) return `${daysAgo} days ago`;
  return date.toLocaleDateString(DISPLAY_LOCALE, {
    timeZone: DISPLAY_TIMEZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const parseAmount = (value) => {
  if (value === null || value === undefined) return null;
  const num = Number(String(value).replace(",", "."));
  return Number.isFinite(num) ? num : null;
};

const formatCurrency = (value, currency) => {
  if (value === null || value === undefined) return "—";
  if (typeof value !== "number") return String(value);
  if (!currency) return value.toLocaleString(DISPLAY_LOCALE);
  try {
    return new Intl.NumberFormat(DISPLAY_LOCALE, { style: "currency", currency }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString(DISPLAY_LOCALE)}`;
  }
};

const getInitials = (name, email) => {
  const base = name || email || "";
  const parts = base
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

const getTicketStatusMeta = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "solved" || normalized === "resolved") {
    return {
      label: "Resolved",
      className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
      dotClassName: "bg-emerald-500",
    };
  }
  if (normalized === "pending" || normalized === "waiting") {
    return {
      label: normalized === "pending" ? "Pending" : "Waiting",
      className: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
      dotClassName: "bg-amber-500",
    };
  }
  if (normalized === "new") {
    return {
      label: "New",
      className: "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",
      dotClassName: "bg-blue-500",
    };
  }
  return {
    label: "Open",
    className: "bg-muted text-muted-foreground",
    dotClassName: "bg-muted-foreground/60",
  };
};

const formatTicketRef = (ticketNumber) => formatTicketReference(ticketNumber);

function SectionHeading({ title, description, count }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-[13px] font-semibold tracking-[-0.01em] text-foreground">{title}</h3>
        {description ? <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{description}</p> : null}
      </div>
      {count !== undefined ? (
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
          {count}
        </span>
      ) : null}
    </div>
  );
}

function PreviousTicketCard({ ticket, onOpenTicket }) {
  const threadId = String(ticket?.thread_id || "").trim();
  const ticketRef = formatTicketRef(ticket?.ticket_number);
  const subject = String(ticket?.subject || "").trim() || "Untitled ticket";
  const status = getTicketStatusMeta(ticket?.status);
  const timestamp = formatHistoryTimestamp(ticket?.last_message_at);

  return (
    <button
      type="button"
      onClick={() => {
        if (threadId) onOpenTicket?.(threadId);
      }}
      disabled={!threadId}
      className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-[background-color,transform] duration-150 ease-out hover:bg-background/80 active:scale-[0.995] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30 disabled:cursor-default disabled:opacity-70"
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${status.dotClassName}`} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{subject}</div>
          <span className="shrink-0 text-[10px] text-muted-foreground/70">{timestamp || "—"}</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${status.className}`}>
            {status.label}
          </span>
          <span className="truncate text-[10px] font-mono tracking-[0.04em] text-muted-foreground/70">
            {ticketRef}
          </span>
        </div>
      </div>
      {threadId ? (
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-[color,transform] duration-150 group-hover:translate-x-0.5 group-hover:text-foreground" />
      ) : null}
    </button>
  );
}

function PreviousTicketsSection({ tickets, onOpenTicket }) {
  return (
    <section className="space-y-2.5 border-t border-border/70 pt-5">
      <SectionHeading
        title="Previous conversations"
        description="Previous conversations with this customer."
        count={tickets.length}
      />
      {tickets.length ? (
        <div className="overflow-hidden rounded-xl border border-border/70 bg-background/45 divide-y divide-border/70">
          {tickets.map((ticket) => (
            <PreviousTicketCard
              key={
                String(ticket?.thread_id || "").trim() ||
                `${ticket?.ticket_number || "no-number"}-${ticket?.subject || ""}`
              }
              ticket={ticket}
              onOpenTicket={onOpenTicket}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-background/40 px-3 py-3 text-[12px] text-muted-foreground">
          No previous tickets found.
        </div>
      )}
    </section>
  );
}

function OrderCard({ order, shopDomain }) {
  const orderUrl = order?.adminUrl || (shopDomain && order?.adminId)
    ? order?.adminUrl || `https://${shopDomain}/admin/orders/${order.adminId}`
    : "";
  const total = order?.total ? formatCurrency(parseAmount(order.total) ?? order.total, order.currency) : "—";

  return (
    <div className="rounded-xl border border-border/70 bg-background/75 p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-[background-color,border-color,box-shadow] duration-150 hover:border-border hover:bg-background hover:shadow-sm">
      <div className="flex items-start gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
          <ShoppingBag className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 text-[13px] font-semibold text-foreground">
              {orderUrl ? (
                <a
                  href={orderUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="group/order inline-flex max-w-full items-center gap-1 hover:text-violet-700 dark:hover:text-violet-300"
                >
                  <span className="truncate">Order #{order.id}</span>
                  <ExternalLink className="size-3 shrink-0 text-muted-foreground transition-colors group-hover/order:text-violet-600" />
                </a>
              ) : (
                <>Order #{order.id}</>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-1">
              {order?.financialStatus ? (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  order.financialStatus === "paid"
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                    : "bg-muted text-muted-foreground"
                }`}>
                  {order.financialStatus === "paid" ? "Paid" : "Refunded"}
                </span>
              ) : null}
              {order?.fulfillmentStatus ? (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  order.fulfillmentStatus === "fulfilled"
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"
                    : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
                }`}>
                  {order.fulfillmentStatus === "fulfilled" ? "Fulfilled" : "Unfulfilled"}
                </span>
              ) : null}
            </div>
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">{total}</div>
        </div>
      </div>

      {Array.isArray(order?.items) && order.items.length ? (
        <div className="mt-3 space-y-1 border-t border-border/60 pt-2.5">
          {order.items.slice(0, 3).map((item, index) => (
            <div key={`${order.id}-item-${index}`} className="flex min-w-0 items-start gap-2 text-[11px] leading-4 text-muted-foreground">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground/50" />
              <span className="line-clamp-2 min-w-0">{item}</span>
            </div>
          ))}
          {order.items.length > 3 ? (
            <div className="pl-3 text-[10px] text-muted-foreground/70">+{order.items.length - 3} more items</div>
          ) : null}
        </div>
      ) : null}

      {order?.tracking?.url && order?.tracking?.number ? (
        <div className="mt-3 flex items-center gap-1.5 border-t border-border/60 pt-2.5 text-[11px] text-muted-foreground">
          <Truck className="size-3.5 shrink-0" />
          <a href={order.tracking.url} target="_blank" rel="noreferrer" className="truncate hover:text-foreground hover:underline">
            {order.tracking.number}
          </a>
        </div>
      ) : null}
    </div>
  );
}

function CustomerTabComponent({ data, loading, error, onRefresh, onOpenTicket }) {
  const previousTickets = Array.isArray(data?.previousTickets) ? data.previousTickets : [];
  const orders = Array.isArray(data?.orders) ? data.orders : [];
  const customer = data?.customer || {};
  const shopDomain = data?.shopDomain || data?.shop?.domain || data?.shop?.shop_domain || null;
  const totals = orders
    .map((order) => parseAmount(order?.total))
    .filter((value) => value !== null);
  const totalSpent = totals.length ? totals.reduce((sum, value) => sum + value, 0) : null;
  const currency = orders.find((order) => order?.currency)?.currency || null;
  const customerDisplayName = getCustomerDisplayName({
    customer,
    fallbackEmail: customer?.email,
  });
  const initials = getInitials(customerDisplayName, customer?.email);
  const hasCustomerData = Boolean(data?.customer || orders.length);

  if (loading) {
    return (
      <div className="space-y-5 px-0.5" aria-label="Loading customer history">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-semibold tracking-[-0.015em] text-foreground">Customer history</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Orders and previous conversations.</p>
          </div>
          <Button variant="outline" size="sm" disabled>Refresh</Button>
        </div>
        <div className="space-y-3">
          <div className="h-16 animate-pulse rounded-xl bg-muted" />
          <div className="h-20 animate-pulse rounded-xl bg-muted" />
          <div className="h-24 animate-pulse rounded-xl bg-muted" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-5 px-0.5">
        <div>
          <h3 className="text-[15px] font-semibold tracking-[-0.015em] text-foreground">Customer history</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Orders and previous conversations.</p>
        </div>
        <div className="rounded-xl border border-destructive/20 bg-destructive/[0.04] p-3.5">
          <p className="text-[13px] font-medium text-foreground">Couldn’t load customer history</p>
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
            {error.message || "Something went wrong while loading this customer."}
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={onRefresh}>Try again</Button>
        </div>
      </div>
    );
  }

  if (!hasCustomerData) {
    return (
      <div className="space-y-5 px-0.5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-semibold tracking-[-0.015em] text-foreground">Customer history</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Orders and previous conversations.</p>
          </div>
          <Button variant="outline" size="sm" onClick={onRefresh}>Refresh</Button>
        </div>
        <div className="rounded-xl border border-dashed border-border bg-background/40 p-4">
          <p className="text-[13px] font-medium text-foreground">No customer profile found</p>
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
            We couldn’t match this ticket to a customer or order.
          </p>
        </div>
        <PreviousTicketsSection tickets={previousTickets} onOpenTicket={onOpenTicket} />
      </div>
    );
  }

  return (
    <div className="space-y-5 px-0.5 pb-2">
      <section className="border-b border-border/70 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-semibold tracking-[-0.015em] text-foreground">Customer history</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Orders and previous conversations.</p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            title="Refresh customer history"
            aria-label="Refresh customer history"
            className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-[background-color,color,transform] duration-150 ease-out hover:bg-muted hover:text-foreground active:scale-[0.97]"
          >
            <RefreshCw className="size-3.5" />
          </button>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
            <span className="text-[13px] font-semibold">{initials}</span>
          </div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-foreground">
              {customerDisplayName}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">{customer?.email || "No email available"}</div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-[1.35fr_0.825fr_0.825fr] gap-2">
        <div className="min-w-0 rounded-xl border border-border/70 bg-background/60 px-2.5 py-2.5">
          <div className="truncate text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/75">Spent</div>
          <div className="mt-1 whitespace-nowrap text-[12px] font-semibold tabular-nums tracking-[-0.01em] text-foreground">
            {totalSpent !== null ? formatCurrency(totalSpent, currency) : "—"}
          </div>
        </div>
        <div className="min-w-0 rounded-xl border border-border/70 bg-background/60 px-2.5 py-2.5">
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/75">Orders</div>
          <div className="mt-1 text-[13px] font-semibold tabular-nums text-foreground">{orders.length}</div>
        </div>
        <div className="min-w-0 rounded-xl border border-border/70 bg-background/60 px-2.5 py-2.5">
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/75">Tickets</div>
          <div className="mt-1 text-[13px] font-semibold tabular-nums text-foreground">{previousTickets.length}</div>
        </div>
      </section>

      <section className="space-y-2.5">
        <SectionHeading title="Recent orders" description="Orders linked to this customer." count={orders.length} />
        {orders.length ? (
          <div className="space-y-2">
            {orders.map((order, index) => (
              <OrderCard key={order.id || `order-${index}`} order={order} shopDomain={shopDomain} />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-background/40 px-3 py-3 text-[12px] text-muted-foreground">
            No orders found.
          </div>
        )}
      </section>

      <PreviousTicketsSection tickets={previousTickets} onOpenTicket={onOpenTicket} />
    </div>
  );
}

export const CustomerTab = memo(CustomerTabComponent);
