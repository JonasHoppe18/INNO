"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const FALLBACK_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

function formatTag(tag) {
  if (!tag) return "";
  return tag.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function TicketTypesChart({ data = [] }) {
  if (!data.length) {
    return (
      <div className="flex min-h-[240px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        No ticket categories yet. Tags will appear here when tickets are classified.
      </div>
    );
  }

  const total = data.reduce((sum, row) => sum + (row.count || 0), 0);
  const max = Math.max(...data.map((row) => row.count || 0), 1);
  const visibleRows = data.slice(0, 14);

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {visibleRows.slice(0, 8).map((row, index) => {
          const color = row.color || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
          const share = total > 0 ? Math.round((row.count / total) * 100) : 0;
          return (
            <div key={row.tag} className="grid grid-cols-[minmax(120px,180px)_1fr_64px] items-center gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2 font-medium">
                <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: color }} />
                <span className="truncate">{formatTag(row.tag)}</span>
              </span>
              <div className="h-7 overflow-hidden rounded-md bg-muted">
                <div
                  className="flex h-full min-w-8 items-center justify-end rounded-md px-2 text-[11px] font-semibold text-white"
                  style={{
                    width: `${Math.max(5, ((row.count || 0) / max) * 100)}%`,
                    backgroundColor: color,
                  }}
                >
                  {share}%
                </div>
              </div>
              <span className="text-right font-medium tabular-nums">{row.count}</span>
            </div>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="font-semibold">Category</TableHead>
              <TableHead className="text-right font-semibold">Tickets</TableHead>
              <TableHead className="text-right font-semibold">Share</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.map((row, index) => {
              const color = row.color || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
              return (
                <TableRow key={row.tag} className="transition-colors hover:bg-muted/30">
                  <TableCell className="font-medium">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: color }} />
                      <span className="truncate">{formatTag(row.tag)}</span>
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {total > 0 ? Math.round((row.count / total) * 100) : 0}%
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
