import Link from "next/link";
import { CheckCircle2Icon, ChevronRightIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatWait } from "@/lib/dashboard-queue-copy";

const STAGE = {
  needsReply: { variant: "info", label: "Needs reply", action: "Open" },
  replyReady: { variant: "ai", label: "Reply ready", action: "Review reply" },
  approval: { variant: "warning", label: "Awaiting approval", action: "Review action" },
};

export function UpNextCard({ items = [] }) {
  return (
    <Card className="rounded-xl shadow-sm">
      <CardHeader className="flex-row items-center justify-between gap-3 pb-3">
        <div>
          <CardTitle className="text-section-heading">Up next</CardTitle>
          <CardDescription className="mt-1">The customers who have waited longest.</CardDescription>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/inbox">Open inbox<ChevronRightIcon data-icon="inline-end" /></Link>
        </Button>
      </CardHeader>
      <CardContent>
        {items.length ? (
          <ol className="flex flex-col divide-y divide-border/70">
            {items.map((item) => {
              const stage = STAGE[item.stage] || STAGE.needsReply;
              const meta = [item.ticketNumber ? `#${item.ticketNumber}` : null, item.customer, `waited ${formatWait(item.waitedHours)}`]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={item.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.subject || "No subject"}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</p>
                  </div>
                  <Badge variant={stage.variant} className="hidden shrink-0 sm:inline-flex">{stage.label}</Badge>
                  <Button variant="outline" size="sm" className="shrink-0" asChild>
                    <Link href={item.url}>{stage.action}</Link>
                  </Button>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="flex items-center gap-3 rounded-lg bg-success/60 px-4 py-4">
            <CheckCircle2Icon className="size-5 shrink-0 text-success-foreground" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium">You&apos;re all caught up</p>
              <p className="text-xs text-muted-foreground">New tickets and Sona&apos;s replies will show up here.</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
