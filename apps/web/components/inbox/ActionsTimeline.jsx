import { cn } from "@/lib/utils";
import { MapPin, RefreshCcw, XCircle, Zap } from "lucide-react";

const statusStyles = {
  success: {
    dot: "border-indigo-500",
    line: "bg-indigo-200",
    badge: "border-indigo-200 bg-indigo-50 text-indigo-700",
  },
  warning: {
    dot: "border-amber-500",
    line: "bg-amber-200",
    badge: "border-amber-200 bg-amber-50 text-amber-700",
  },
  info: {
    dot: "border-indigo-300",
    line: "bg-indigo-100",
    badge: "border-indigo-100 bg-indigo-50 text-indigo-600",
  },
  error: {
    dot: "border-red-500",
    line: "bg-red-200",
    badge: "border-red-200 bg-red-50 text-red-700",
  },
};

const stripThreadSuffix = (value) =>
  String(value || "").replace(/\s*\|thread_id:[a-z0-9-]+\s*/i, "").trim();

function ShopifyActionCard({ detail }) {
  const cleaned = stripThreadSuffix(detail);
  const lower = cleaned.toLowerCase();
  const isAddressUpdate = lower.startsWith("updated shipping address");
  const isCancellation = lower.includes("cancel") || lower.includes("cancelled");
  const isRefund = lower.includes("refund");

  const theme = isAddressUpdate
    ? {
        wrapper: "border-violet-200 bg-violet-50 text-violet-900",
        icon: "text-violet-600",
        label: "Updated Shipping Address",
        Icon: MapPin,
      }
    : isCancellation
    ? {
        wrapper: "border-rose-200 bg-rose-50 text-rose-900",
        icon: "text-rose-600",
        label: "Cancellation",
        Icon: XCircle,
      }
    : isRefund
    ? {
        wrapper: "border-amber-200 bg-amber-50 text-amber-900",
        icon: "text-amber-600",
        label: "Refund",
        Icon: RefreshCcw,
      }
    : {
        wrapper: "border-indigo-200 bg-indigo-50 text-indigo-900",
        icon: "text-indigo-600",
        label: "Shopify Action",
        Icon: Zap,
      };

  const addressLines = isAddressUpdate
    ? cleaned
        .replace(/^updated shipping address to\s*/i, "")
        .split(",")
        .map((line) => line.trim())
        .filter(Boolean)
    : [];

  const Icon = theme.Icon;

  return (
    <div className={cn("rounded-lg border p-3", theme.wrapper)}>
      <div className="flex items-center gap-2 text-xs font-semibold">
        <Icon className={cn("h-3.5 w-3.5", theme.icon)} />
        {theme.label}
      </div>
      <div className="mt-2 rounded border border-white/60 bg-white/70 p-2 text-sm">
        {isAddressUpdate && addressLines.length ? (
          addressLines.map((line, idx) => (
            <div
              key={`address-line-${idx}`}
              className={cn(
                "break-words",
                idx === 0 ? "font-bold text-gray-900" : "text-gray-600"
              )}
            >
              {line}
            </div>
          ))
        ) : (
          <div className="break-words text-gray-700">{cleaned}</div>
        )}
      </div>
    </div>
  );
}

export function ActionsTimeline({ items = [] }) {
  return (
    <div className="space-y-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Action timeline
      </div>
      <div className="space-y-4">
        {items.map((item, index) => {
          const styles = statusStyles[item.status] || statusStyles.info;
          const stepName = String(item.stepName || item.title || "");
          const isShopifyAction = stepName.toLowerCase() === "shopify action";
          const detailText = item.detail ?? item.statusLabel ?? "";
          return (
            <div key={item.id} className="flex gap-3">
            <div className="relative flex flex-col items-center">
              <div
                className={cn("h-2.5 w-2.5 rounded-full border-2 bg-white", styles.dot)}
              />
              {index < items.length - 1 ? (
                <div className={cn("mt-1 h-full w-px flex-1", styles.line)} />
              ) : null}
            </div>
            <div className="space-y-2">
              <div className="text-sm font-semibold text-slate-900">{item.title}</div>
              {isShopifyAction ? (
                <ShopifyActionCard detail={detailText} />
              ) : item.statusLabel ? (
                <div
                  className={cn(
                    "w-fit rounded-full border px-3 py-1 text-xs font-medium shadow-sm",
                    styles.badge
                  )}
                >
                  {item.statusLabel}
                </div>
              ) : null}
              <div className={cn("text-xs text-slate-400")}>
                {item.timestamp}
              </div>
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}
