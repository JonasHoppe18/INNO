"use client";

const SONA_COLORS = ["#6366f1", "#2BC8B7", "#8b5cf6", "#38bdf8", "#64748b"];

function formatTag(tag) {
  if (!tag) return "";
  return tag.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function TicketTypesChart({ data = [] }) {
  if (!data.length) {
    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center">
        <p className="text-sm font-medium">No categories yet</p>
        <p className="text-xs text-muted-foreground">
          Topic tags will appear here once tickets are classified.
        </p>
      </div>
    );
  }

  const total = data.reduce((sum, row) => sum + (row.count || 0), 0);
  const max = Math.max(...data.map((row) => row.count || 0), 1);
  const visibleRows = data.slice(0, 12);

  return (
    <div className="space-y-2.5">
      {visibleRows.map((row, index) => {
        const color = SONA_COLORS[index % SONA_COLORS.length];
        const share = total > 0 ? Math.round((row.count / total) * 100) : 0;
        return (
          <div
            key={row.tag}
            className="grid grid-cols-[minmax(130px,200px)_1fr_80px] items-center gap-3 text-sm"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: color }} />
              <span className="truncate font-medium">{formatTag(row.tag)}</span>
            </span>
            <div className="h-6 overflow-hidden rounded bg-muted">
              <div
                className="flex h-full min-w-8 items-center justify-end rounded px-2 text-[10px] font-semibold text-white transition-[width] duration-500"
                style={{
                  width: `${Math.max(5, ((row.count || 0) / max) * 100)}%`,
                  backgroundColor: color,
                }}
              >
                {share}%
              </div>
            </div>
            <div className="flex items-center justify-end gap-1">
              <span className="font-medium tabular-nums">{row.count}</span>
              <span className="text-xs text-muted-foreground">tickets</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
