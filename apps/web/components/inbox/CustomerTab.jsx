import { memo, useEffect, useState } from "react";
import { AlertTriangle, ChevronRight, ExternalLink, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTicketReference } from "@/lib/tickets/reference";
import {
  CustomerAvatar,
  PanelSection,
  PropertyRow,
  ticketStatusLabel,
} from "@/components/inbox/panel-primitives";

const DISPLAY_LOCALE = "en-GB";
const DISPLAY_TIMEZONE = "Europe/Copenhagen";

const formatDate = (value, { withYear = true } = {}) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(DISPLAY_LOCALE, {
    timeZone: DISPLAY_TIMEZONE,
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  });
};

const formatMoney = (amount, currency) => {
  const value = typeof amount === "number" ? amount : Number(String(amount ?? "").replace(",", "."));
  if (!Number.isFinite(value)) return "";
  try {
    return new Intl.NumberFormat("da-DK", { style: "currency", currency: currency || "DKK" }).format(value);
  } catch {
    return `${value.toLocaleString("da-DK")} ${currency || ""}`.trim();
  }
};

const orderNumberKey = (value) => String(value ?? "").replace(/\D/g, "");

function FulfillmentPill({ status }) {
  const raw = String(status || "").toLowerCase();
  if (!raw) return null;
  const done = raw === "fulfilled";
  const label = raw.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-[11px] font-medium",
        done
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
          : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
      )}
    >
      <span className={cn("size-1.5 rounded-full", done ? "bg-emerald-500" : "bg-amber-500")} />
      {label}
    </span>
  );
}

function OrderRow({ order, isCurrent = false, warning = null }) {
  const orderUrl = order?.adminUrl || "";
  return (
    <div className="py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        {orderUrl ? (
          <a
            href={orderUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open order #${order.id} in Shopify`}
            className="group/order inline-flex min-w-0 items-center gap-1 text-xs font-medium text-foreground hover:text-violet-700 dark:hover:text-violet-300"
          >
            <span className="truncate">#{order.id}</span>
            <ExternalLink aria-hidden="true" className="h-3 w-3 shrink-0 text-muted-foreground group-hover/order:text-violet-600" />
          </a>
        ) : (
          <span className="truncate text-xs font-medium text-foreground">#{order?.id}</span>
        )}
        <FulfillmentPill status={order?.fulfillmentStatus || order?.fulfillment_status || order?.status} />
        {isCurrent ? (
          <span className="shrink-0 rounded-full bg-violet-50 px-1.5 py-px text-[11px] font-medium text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
            This ticket
          </span>
        ) : null}
        <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatMoney(order?.total, order?.currency)}
        </span>
      </div>
      {order?.placedAt ? (
        <div className="mt-0.5 text-xs text-muted-foreground">{formatDate(order.placedAt)}</div>
      ) : null}
      {warning ? (
        <div className="mt-1 flex items-start gap-1.5 text-xs leading-snug text-warning-foreground">
          <AlertTriangle aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>{warning}</span>
        </div>
      ) : null}
    </div>
  );
}

function PreviousTickets({ tickets, onOpenTicket }) {
  const [visibleCount, setVisibleCount] = useState(5);
  const firstTicketId = String(tickets[0]?.thread_id || "").trim();

  useEffect(() => {
    setVisibleCount(5);
  }, [tickets.length, firstTicketId]);

  if (!tickets.length) {
    return <p className="text-xs text-muted-foreground">No previous conversations with this customer.</p>;
  }

  return (
    <div className="-mx-2">
      {tickets.slice(0, visibleCount).map((ticket) => {
        const threadId = String(ticket?.thread_id || "").trim();
        const ticketRef = formatTicketReference(ticket?.ticket_number);
        return (
          <button
            key={threadId || `${ticket?.ticket_number}-${ticket?.subject}`}
            type="button"
            disabled={!threadId}
            onClick={() => threadId && onOpenTicket?.(threadId)}
            className="group flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-[background-color,transform] duration-150 ease-out hover:bg-muted/45 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500/30 disabled:cursor-default"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-foreground">
                {String(ticket?.subject || "").trim() || "Untitled ticket"}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {[
                  ticketStatusLabel(ticket?.status),
                  formatDate(ticket?.last_message_at, { withYear: false }),
                  ticketRef !== "No ticket ID" ? `#${ticketRef.replace(/^T-/, "")}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            {threadId ? (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5" />
            ) : null}
          </button>
        );
      })}
      {visibleCount < tickets.length ? (
        <button
          type="button"
          onClick={() => setVisibleCount((count) => Math.min(count + 5, tickets.length))}
          className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground"
        >
          Show {Math.min(5, tickets.length - visibleCount)} more
        </button>
      ) : null}
    </div>
  );
}

function CustomerTabComponent({
  data,
  loading,
  error,
  onRefresh,
  onOpenTicket,
  customerName = "",
  customerEmail = "",
}) {
  const customer = data?.customer || null;
  const profile = customer?.profile || null;
  const previousTickets = Array.isArray(data?.previousTickets) ? data.previousTickets : [];
  // Orders matched only by number can belong to another email; they are listed
  // separately and never counted as this customer's.
  const lookupOrders = Array.isArray(data?.orders) ? data.orders : [];
  const ownLookupOrders = lookupOrders.filter((order) => order?.ownedBySender !== false);
  const foreignOrders = lookupOrders.filter((order) => order?.ownedBySender === false);
  // Lifetime profile orders when Shopify gave us a profile; otherwise only the
  // orders this ticket's lookup found.
  const orders = profile?.recentOrders?.length ? profile.recentOrders : ownLookupOrders;
  const currentOrderKey = orderNumberKey(data?.matchedOrderNumber);
  const inShopify = Boolean(profile) || customer?.source === "shopify_orders";
  const lifetimeOrders = Number.isFinite(profile?.lifetimeOrders) ? profile.lifetimeOrders : null;
  const location = [profile?.city, profile?.country || customer?.country].filter(Boolean).join(", ");

  return (
    <div className="px-1 pb-2">
      <PanelSection>
        <div className="flex items-start gap-3">
          <CustomerAvatar name={customerName} email={customerEmail} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-sm font-semibold text-foreground" title={customerName}>
                {customerName || "Unknown customer"}
              </span>
              {customer?.adminUrl ? (
                <a
                  href={customer.adminUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open customer in Shopify"
                  title="Open in Shopify"
                  className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : null}
            </div>
            {customerEmail && customerEmail !== customerName ? (
              <div className="truncate text-xs text-muted-foreground">{customerEmail}</div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh customer"
            title="Refresh"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
        </div>

        {loading && !customer ? (
          <div className="mt-3 space-y-1.5" aria-label="Loading customer">
            <div className="h-3 w-40 animate-pulse rounded bg-muted" />
            <div className="h-3 w-32 animate-pulse rounded bg-muted" />
          </div>
        ) : error ? (
          <p className="mt-3 text-xs text-destructive">{error.message || "Couldn’t load this customer."}</p>
        ) : inShopify ? (
          <div className="mt-3">
            {lifetimeOrders !== null ? <PropertyRow label="Orders">{lifetimeOrders}</PropertyRow> : null}
            {profile?.amountSpent ? (
              <PropertyRow label="Spent">
                {formatMoney(profile.amountSpent.amount, profile.amountSpent.currency)}
              </PropertyRow>
            ) : null}
            {profile?.createdAt ? (
              <PropertyRow label="Customer since">{formatDate(profile.createdAt)}</PropertyRow>
            ) : null}
            {location ? <PropertyRow label="Location">{location}</PropertyRow> : null}
            {customer?.phone ? <PropertyRow label="Phone">{customer.phone}</PropertyRow> : null}
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">No Shopify customer with this email.</p>
        )}
      </PanelSection>

      {orders.length ? (
        <PanelSection
          title={lifetimeOrders !== null ? `Orders (${lifetimeOrders})` : "Orders"}
          action={
            customer?.adminUrl && lifetimeOrders !== null && lifetimeOrders > orders.length ? (
              <a
                href={customer.adminUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              >
                All in Shopify
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null
          }
        >
          <div className="divide-y divide-border/50">
            {orders.map((order, index) => (
              <OrderRow
                key={`${order?.id || "order"}-${index}`}
                order={order}
                isCurrent={Boolean(currentOrderKey) && orderNumberKey(order?.id) === currentOrderKey}
              />
            ))}
          </div>
        </PanelSection>
      ) : null}

      {foreignOrders.length ? (
        <PanelSection title="Mentioned orders">
          <div className="divide-y divide-border/50">
            {foreignOrders.map((order, index) => (
              <OrderRow
                key={`${order?.id || "foreign"}-${index}`}
                order={order}
                warning={`Placed with ${order?.customerEmail || "a different email"}, not the sender. Verify before acting.`}
              />
            ))}
          </div>
        </PanelSection>
      ) : null}

      <PanelSection
        title={previousTickets.length ? `Previous conversations (${previousTickets.length})` : "Previous conversations"}
      >
        <PreviousTickets tickets={previousTickets} onOpenTicket={onOpenTicket} />
      </PanelSection>
    </div>
  );
}

export const CustomerTab = memo(CustomerTabComponent);
