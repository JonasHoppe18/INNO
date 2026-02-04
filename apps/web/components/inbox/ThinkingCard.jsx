import { ExternalLink } from "lucide-react";
import { SonaLogo } from "@/components/ui/SonaLogo";
import { cn } from "@/lib/utils";

const FINANCIAL_STATUS_STYLES = {
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  refunded: "bg-gray-100 text-gray-700 border-gray-200",
};

const FULFILLMENT_STATUS_STYLES = {
  fulfilled: "bg-blue-50 text-blue-700 border-blue-200",
  unfulfilled: "bg-amber-50 text-amber-700 border-amber-200",
};

const resolveStatusStyle = (value = "", group = "financial") => {
  const normalized = String(value || "").trim().toLowerCase();
  const map =
    group === "fulfillment" ? FULFILLMENT_STATUS_STYLES : FINANCIAL_STATUS_STYLES;
  return map[normalized] || "bg-indigo-50 text-indigo-700 border-indigo-200";
};

const prettifyStatus = (value = "") => {
  if (!value) return "Unknown";
  return String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const normalizeLineItems = (items) => {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const quantity = Number(item?.quantity ?? 1);
      const title = item?.title || item?.name || "Item";
      return {
        id: item?.id || `${title}-${quantity}`,
        quantity: Number.isFinite(quantity) ? quantity : 1,
        title,
      };
    })
    .filter((item) => item.title);
};

export function ThinkingCard({ data }) {
  if (!data) return null;

  const orderName = data?.orderName || data?.order_number || data?.name || "Order";
  const orderUrl = data?.orderUrl || data?.order_url || data?.adminUrl || null;
  const financialStatus = prettifyStatus(data?.financialStatus || data?.financial_status);
  const fulfillmentStatus = prettifyStatus(
    data?.fulfillmentStatus || data?.fulfillment_status
  );
  const customerName = data?.customer?.name || "Unknown customer";
  const customerEmail = data?.customer?.email || "No email";
  const lineItems = normalizeLineItems(data?.lineItems);
  const totalPrice = data?.totalPrice ?? data?.total_price ?? "—";
  const currency = data?.currency || "";

  return (
    <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-white/70 p-1.5">
            <SonaLogo size={24} speed="working" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-500">
              Sona Thinking
            </p>
            {orderUrl ? (
              <a
                href={orderUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm font-semibold text-indigo-900 underline underline-offset-2"
              >
                {orderName}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : (
              <p className="text-sm font-semibold text-indigo-900">{orderName}</p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-xs font-medium",
              resolveStatusStyle(financialStatus, "financial")
            )}
          >
            {financialStatus}
          </span>
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-xs font-medium",
              resolveStatusStyle(fulfillmentStatus, "fulfillment")
            )}
          >
            {fulfillmentStatus}
          </span>
        </div>
      </div>

      <div className="mt-3 rounded-md bg-white/70 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Customer</p>
        <p className="text-sm font-medium text-gray-900">{customerName}</p>
        <p className="text-xs text-gray-600">{customerEmail}</p>
      </div>

      {lineItems.length ? (
        <div className="mt-3 rounded-md bg-white/70 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Line Items</p>
          <ul className="mt-1.5 space-y-1">
            {lineItems.map((item) => (
              <li key={item.id} className="text-sm text-gray-800">
                {item.quantity}x {item.title}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-end">
        <p className="text-sm font-semibold text-indigo-900">
          Total: {totalPrice} {currency}
        </p>
      </div>
    </div>
  );
}
