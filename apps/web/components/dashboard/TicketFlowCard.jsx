import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { flowDetail } from "@/lib/dashboard-queue-copy";

const STAGES = [
  { key: "needsReply", label: "Needs reply", href: "/inbox", color: "bg-info-foreground" },
  { key: "repliesReady", label: "Replies ready", href: "/inbox", color: "bg-primary" },
  { key: "awaitingApproval", label: "Awaiting approval", href: "/inbox", color: "bg-warning-foreground" },
  { key: "waiting", label: "Waiting", href: "/inbox?tab=waiting", color: "bg-muted-foreground/40" },
];

export function TicketFlowCard({ queue }) {
  const flow = queue?.flow || {};
  const total = queue?.openTotal ?? 0;

  return (
    <Card className="overflow-hidden rounded-xl shadow-sm">
      <div className="flex flex-col gap-3 px-5 pb-4 pt-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-medium">Open tickets</h2>
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold tabular-nums text-foreground">{total}</span> in progress
          </p>
        </div>
        <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          {STAGES.map((stage) => {
            const count = flow[stage.key]?.count || 0;
            return count ? <span key={stage.key} className={cn("h-full", stage.color)} style={{ flexGrow: count }} /> : null;
          })}
        </div>
      </div>
      <div className="grid border-t border-border/70 sm:grid-cols-2 xl:grid-cols-4">
        {STAGES.map((stage, index) => {
          const bucket = flow[stage.key];
          const count = bucket?.count || 0;
          return (
            <Link
              key={stage.key}
              href={stage.href}
              className={cn(
                "group flex flex-col gap-1 border-border/70 px-5 py-4 transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                index > 0 && "sm:border-l",
                index > 1 && "border-t xl:border-t-0",
              )}
            >
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className={cn("size-2 rounded-full", count ? stage.color : "bg-muted-foreground/25")} aria-hidden="true" />
                {stage.label}
                <ChevronRightIcon className="ml-auto size-3.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100" aria-hidden="true" />
              </span>
              <span className={cn("mt-1 text-2xl font-semibold tracking-tight tabular-nums", !count && "text-muted-foreground/50")}>{count}</span>
              <span className="text-xs text-muted-foreground">{flowDetail(stage.key, bucket)}</span>
            </Link>
          );
        })}
      </div>
    </Card>
  );
}
