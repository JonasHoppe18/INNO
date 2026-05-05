import Image from "next/image";
import shopifyLogo from "../../../../assets/Shopify-Logo.png";
import { ExternalLink, RefreshCw, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";

const formatTimestamp = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("da-DK", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
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
  if (!currency) return String(value);
  try {
    return new Intl.NumberFormat("da-DK", { style: "currency", currency }).format(value);
  } catch {
    return `${value} ${currency}`;
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

const formatTicketStatus = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "solved" || normalized === "resolved") return "Resolved";
  if (normalized === "pending") return "Pending";
  if (normalized === "waiting") return "Waiting";
  if (normalized === "new") return "New";
  return "Open";
};

const formatTicketRef = (ticketNumber) => {
  const raw = String(ticketNumber ?? "").trim();
  if (!raw) return "No ticket ID";
  const digits = raw.replace(/\D/g, "");
  const parsed = Number(digits);
  return Number.isFinite(parsed) && parsed > 0
    ? `T-${String(parsed).padStart(6, "0")}`
    : "No ticket ID";
};

export function CustomerTab({ data, loading, error, onRefresh, lookupParams, onOpenTicket }) {
  if (loading) {
    return (
      <div className="space-y-4 text-sm text-slate-500">
        <div className="flex items-center justify-between">
          <span>Loading customer details...</span>
          <Button variant="outline" size="sm" disabled>
            Refresh
          </Button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4 text-sm text-slate-500">
        <div className="flex items-center justify-between">
          <span>{error.message || "Kunne ikke hente kunden."}</span>
          <Button variant="outline" size="sm" onClick={onRefresh}>
            Refresh
          </Button>
        </div>
      </div>
    );
  }

  const previousTickets = Array.isArray(data?.previousTickets) ? data.previousTickets : [];

  if (!data?.customer && !data?.orders?.length) {
    const source = data?.source ? String(data.source).trim() : "Shopify";
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>{`No customer found in ${source}.`}</span>
          <Button variant="outline" size="sm" onClick={onRefresh}>
            Refresh
          </Button>
        </div>
        {previousTickets.length > 0 && (
          <div className="space-y-2">
            <div className="text-[11px] font-medium text-slate-400">Previous tickets</div>
            {previousTickets.map((ticket) => {
              const threadId = String(ticket?.thread_id || "").trim();
              const lastActivity = formatTimestamp(ticket?.last_message_at);
              return (
                <button
                  key={threadId || `${ticket?.ticket_number || "no-number"}-${ticket?.subject || ""}`}
                  type="button"
                  onClick={() => {
                    if (!threadId) return;
                    onOpenTicket?.(threadId);
                  }}
                  className="w-full rounded-lg border border-slate-200 bg-white p-3 text-left transition hover:border-slate-300 hover:bg-slate-50"
                  disabled={!threadId}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div
                      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-[0.06em] ${
                        formatTicketRef(ticket?.ticket_number) !== "No ticket ID"
                          ? "bg-slate-100 font-mono font-medium text-slate-500"
                          : "text-slate-400"
                      }`}
                    >
                      {formatTicketRef(ticket?.ticket_number)}
                    </div>
                    <div className="text-[11px] text-slate-400">{formatTicketStatus(ticket?.status)}</div>
                  </div>
                  <div className="mt-1 line-clamp-2 text-[13px] font-medium text-slate-900">
                    {String(ticket?.subject || "").trim() || "Untitled ticket"}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">{lastActivity || "—"}</div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  const orders = Array.isArray(data?.orders) ? data.orders : [];
  const customer = data?.customer || {};
  const shopDomain =
    data?.shopDomain ||
    data?.shop?.domain ||
    data?.shop?.shop_domain ||
    null;
  const source = data?.source ? String(data.source).trim() : "Shopify";
  const sourceLabel = source ? source.charAt(0).toUpperCase() + source.slice(1) : "Shopify";
  const updatedAt = formatTimestamp(data?.fetchedAt);
  const totals = orders
    .map((order) => parseAmount(order?.total))
    .filter((value) => value !== null);
  const totalSpent = totals.length ? totals.reduce((sum, value) => sum + value, 0) : null;
  const currency = orders.find((order) => order?.currency)?.currency || null;
  const initials = getInitials(customer?.name, customer?.email);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
          <span className="text-sm font-semibold">{initials}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-slate-900">
            {customer?.name || "Unknown customer"}
          </div>
          <div className="truncate text-[13px] text-slate-400">{customer?.email || "—"}</div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          title="Refresh"
          className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
          <div className="text-[11px] text-slate-400">Spent</div>
          <div className="mt-0.5 text-[15px] font-semibold text-slate-900">
            {totalSpent !== null ? formatCurrency(totalSpent, currency) : "—"}
          </div>
        </div>
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
          <div className="text-[11px] text-slate-400">Orders</div>
          <div className="mt-0.5 text-[15px] font-semibold text-slate-900">{orders.length}</div>
        </div>
      </div>
      <div className="space-y-2">
        <div className="text-[11px] font-medium text-slate-400">Recent orders</div>
        {orders.length ? (
          orders.map((order) => (
            <div key={order.id} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm font-semibold text-slate-900">
                  {order?.adminUrl || (shopDomain && order?.adminId) ? (
                    <a
                      href={
                        order?.adminUrl ||
                        `https://${shopDomain}/admin/orders/${order.adminId}`
                      }
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 hover:underline"
                    >
                      Order #{order.id}
                      <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
                    </a>
                  ) : (
                    <>Order #{order.id}</>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {order?.financialStatus ? (
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        order.financialStatus === "paid"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {order.financialStatus === "paid" ? "Paid" : "Refunded"}
                    </span>
                  ) : null}
                  {order?.fulfillmentStatus ? (
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        order.fulfillmentStatus === "fulfilled"
                          ? "bg-blue-50 text-blue-600"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {order.fulfillmentStatus === "fulfilled"
                        ? "Fulfilled"
                        : "Unfulfilled"}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="mt-2 text-xs text-slate-500">
                {order.total
                  ? `Total: ${formatCurrency(parseAmount(order.total) ?? order.total, order.currency)}`
                  : "Total: —"}
              </div>
              {order?.tracking?.url && order?.tracking?.number ? (
                <div className="mt-2 flex items-center gap-1.5 text-[12px] text-gray-500">
                  <Truck className="h-3.5 w-3.5 shrink-0" />
                  <a
                    href={order.tracking.url}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate hover:underline"
                  >
                    {order.tracking.number}
                  </a>
                </div>
              ) : null}
              {Array.isArray(order?.items) && order.items.length ? (
                <div className="mt-3 space-y-1 text-sm text-gray-600">
                  {order.items.map((item, index) => (
                    <div key={`${order.id}-item-${index}`} className="flex items-center gap-2">
                      <span className="h-1 w-1 rounded-full bg-gray-400" />
                      <span className="font-medium text-gray-900">{item}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {order.shippingAddress?.city || order.shippingAddress?.country ? (
                <div className="mt-1 text-xs text-slate-400">
                  {[
                    order.shippingAddress?.city,
                    order.shippingAddress?.country,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </div>
              ) : null}
            </div>
          ))
        ) : (
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-[13px] text-slate-500">
            Ingen ordrer fundet.
          </div>
        )}
      </div>
      <div className="space-y-2">
        <div className="text-[11px] font-medium text-slate-400">Previous tickets</div>
        {previousTickets.length ? (
          previousTickets.map((ticket) => {
            const threadId = String(ticket?.thread_id || "").trim();
            const lastActivity = formatTimestamp(ticket?.last_message_at);
            return (
              <button
                key={threadId || `${ticket?.ticket_number || "no-number"}-${ticket?.subject || ""}`}
                type="button"
                onClick={() => {
                  if (!threadId) return;
                  onOpenTicket?.(threadId);
                }}
                className="w-full rounded-lg border border-slate-200 bg-white p-3 text-left transition hover:border-slate-300 hover:bg-slate-50"
                disabled={!threadId}
              >
                <div className="flex items-start justify-between gap-2">
                  <div
                    className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-[0.06em] ${
                      formatTicketRef(ticket?.ticket_number) !== "No ticket ID"
                        ? "bg-slate-100 font-mono font-medium text-slate-500"
                        : "text-slate-400"
                    }`}
                  >
                    {formatTicketRef(ticket?.ticket_number)}
                  </div>
                  <div className="text-[11px] text-slate-400">{formatTicketStatus(ticket?.status)}</div>
                </div>
                <div className="mt-1 line-clamp-2 text-[13px] font-medium text-slate-900">
                  {String(ticket?.subject || "").trim() || "Untitled ticket"}
                </div>
                <div className="mt-1 text-[11px] text-slate-400">{lastActivity || "—"}</div>
              </button>
            );
          })
        ) : (
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-[13px] text-slate-500">
            No previous tickets found.
          </div>
        )}
      </div>
    </div>
  );
}
