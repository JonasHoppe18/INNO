"use client";

const TABS = [
  { key: "needs_attention", label: "Needs attention" },
  { key: "waiting", label: "Waiting" },
  { key: "resolved", label: "Resolved" },
];

export function StatusTabs({ active, counts = {}, onChange }) {
  return (
    <div className="flex items-center gap-1">
      {TABS.map((tab) => {
        const isActive = active === tab.key;
        const count = counts[tab.key];
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange?.(tab.key)}
            className={
              "rounded-md px-2.5 py-1 text-xs transition-colors " +
              (isActive
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            {tab.label}
            {typeof count === "number" && count > 0 ? ` · ${count}` : ""}
          </button>
        );
      })}
    </div>
  );
}
