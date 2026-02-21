import Image from "next/image";
import shopifyLogo from "../../../../assets/Shopify-Logo.png";
import { ExternalLink } from "lucide-react";
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

export function CustomerTab({ data, loading, error, onRefresh }) {
  if (loading) {
    return (
      <div className="space-y-4 text-sm text-slate-500">
        <div className="flex items-center justify-between">
          <span>Henter kundeoplysninger…</span>
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

  if (!data?.customer && !data?.orders?.length) {
    const source = data?.source ? String(data.source).trim() : "datakilden";
    return (
      <div className="space-y-4 text-sm text-slate-500">
        <div className="flex items-center justify-between">
          <span>{`Vi fandt ingen kunde i ${source} for denne henvendelse.`}</span>
          <Button variant="outline" size="sm" onClick={onRefresh}>
            Refresh
          </Button>
        </div>
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Customer
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          Refresh
        </Button>
      </div>
      <div className="flex flex-col items-center text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
          <span className="text-lg font-semibold">{initials}</span>
        </div>
        <div className="mt-4 text-lg font-semibold text-slate-900">
          {customer?.name || "Unknown customer"}
        </div>
        <div className="text-sm text-slate-500">{customer?.email || "—"}</div>
        {updatedAt ? (
          <div className="mt-2 text-xs text-gray-300">Updated {updatedAt}</div>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-center">
          <div className="text-xs uppercase tracking-wide text-slate-400">Spent</div>
          <div className="mt-2 text-lg font-semibold text-slate-900">
            {totalSpent !== null ? formatCurrency(totalSpent, currency) : "—"}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-center">
          <div className="text-xs uppercase tracking-wide text-slate-400">Orders</div>
          <div className="mt-2 text-lg font-semibold text-slate-900">{orders.length}</div>
        </div>
      </div>
      <div className="space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Recent orders
        </div>
        {orders.length ? (
          orders.map((order) => (
            <div key={order.id} className="rounded-2xl border border-slate-200 bg-white p-4">
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
                <div className="mt-2 text-sm text-gray-600">
                  🚚{" "}
                  <a
                    href={order.tracking.url}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
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
          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm text-slate-500">
            Ingen ordrer fundet.
          </div>
        )}
      </div>
    </div>
  );
}
