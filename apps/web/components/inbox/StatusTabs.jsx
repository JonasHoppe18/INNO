"use client";

const TABS = [
  { key: "needs_attention", label: "Needs attention" },
  { key: "waiting", label: "Waiting" },
  { key: "resolved", label: "Resolved" },
];

export function StatusTabs({ active, onChange }) {
  return (
    <div className="flex items-center gap-1">
      {TABS.map((tab) => {
        const isActive = active === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange?.(tab.key)}
            className={
              "shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-xs transition-colors " +
              (isActive
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
