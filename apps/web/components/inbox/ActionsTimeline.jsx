import { cn } from "@/lib/utils";
import { MapPin, RefreshCcw, XCircle, Zap } from "lucide-react";

const statusStyles = {
  success: {
    dot: "border-violet-500",
    line: "bg-violet-300/70 dark:bg-violet-500/30",
    badge: "border-violet-300 dark:border-violet-500/40 bg-violet-100/80 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300",
  },
  warning: {
    dot: "border-amber-500",
    line: "bg-amber-200 dark:bg-amber-500/30",
    badge: "border-amber-200 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
  info: {
    dot: "border-violet-400",
    line: "bg-violet-200/70 dark:bg-violet-500/25",
    badge: "border-violet-200 dark:border-violet-500/40 bg-violet-50 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300",
  },
  error: {
    dot: "border-red-500",
    line: "bg-red-200 dark:bg-red-500/30",
    badge: "border-red-200 dark:border-red-500/40 bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300",
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
        wrapper: "border-violet-200 dark:border-violet-500/40 bg-violet-50 dark:bg-violet-500/10 text-violet-900 dark:text-violet-200",
        icon: "text-violet-600 dark:text-violet-400",
        label: "Updated Shipping Address",
        Icon: MapPin,
      }
    : isCancellation
    ? {
        wrapper: "border-rose-200 dark:border-rose-500/40 bg-rose-50 dark:bg-rose-500/10 text-rose-900 dark:text-rose-200",
        icon: "text-rose-600 dark:text-rose-400",
        label: "Cancellation",
        Icon: XCircle,
      }
    : isRefund
    ? {
        wrapper: "border-amber-200 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 text-amber-900 dark:text-amber-200",
        icon: "text-amber-600 dark:text-amber-400",
        label: "Refund",
        Icon: RefreshCcw,
      }
    : {
        wrapper: "border-violet-200 dark:border-violet-500/40 bg-violet-50 dark:bg-violet-500/10 text-violet-900 dark:text-violet-200",
        icon: "text-violet-600 dark:text-violet-400",
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
      <div className="mt-2 rounded border border-border bg-card p-2 text-sm">
        {isAddressUpdate && addressLines.length ? (
          addressLines.map((line, idx) => (
            <div
              key={`address-line-${idx}`}
              className={cn(
                "break-words",
                idx === 0 ? "font-bold text-foreground" : "text-muted-foreground"
              )}
            >
              {line}
            </div>
          ))
        ) : (
          <div className="break-words text-foreground">{cleaned}</div>
        )}
      </div>
    </div>
  );
}

export function ActionsTimeline({ items = [] }) {
  return (
    <div className="space-y-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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
                className={cn("h-2.5 w-2.5 rounded-full border-2 bg-card", styles.dot)}
              />
              {index < items.length - 1 ? (
                <div className={cn("mt-1 h-full w-px flex-1", styles.line)} />
              ) : null}
            </div>
            <div className="space-y-2">
              <div className="text-sm font-semibold text-foreground">{item.title}</div>
              {isShopifyAction ? (
                <ShopifyActionCard detail={detailText} />
              ) : item.statusLabel ? (
                <div
                  className={cn(
                    "max-w-full rounded-lg border px-3 py-1 text-xs font-medium leading-5 shadow-sm whitespace-pre-line break-words",
                    styles.badge
                  )}
                >
                  {item.statusLabel}
                </div>
              ) : null}
              <div className={cn("text-xs text-muted-foreground")}>
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
