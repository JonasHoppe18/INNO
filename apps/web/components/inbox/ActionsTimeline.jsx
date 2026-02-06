import { cn } from "@/lib/utils";

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

export function ActionsTimeline({ items = [] }) {
  return (
    <div className="space-y-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Action timeline
      </div>
      <div className="space-y-4">
        {items.map((item, index) => {
          const styles = statusStyles[item.status] || statusStyles.info;
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
              {item.statusLabel ? (
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
