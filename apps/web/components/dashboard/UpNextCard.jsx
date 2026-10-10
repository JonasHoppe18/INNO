import Link from "next/link";
import { CheckCircle2Icon, ChevronRightIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { customerLabel, formatWait } from "@/lib/dashboard-queue-copy";

// "Needs reply" is the normal case, so only the stages that ask for something
// different (review a reply, approve an action) get a badge.
const STAGE_BADGE = {
  replyReady: { variant: "ai", label: "Reply ready" },
  approval: { variant: "warning", label: "Awaiting approval" },
};

export function UpNextCard({ items = [] }) {
  return (
    <Card className="rounded-xl shadow-sm">
      <CardHeader className="flex-row items-center justify-between gap-3 pb-2">
        <div>
          <CardTitle className="text-section-heading">Up next</CardTitle>
          <CardDescription className="mt-1">The customers who have waited longest.</CardDescription>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/inbox">Open inbox<ChevronRightIcon data-icon="inline-end" /></Link>
        </Button>
      </CardHeader>
      <CardContent className="px-3 pb-3">
        {items.length ? (
          <ol className="flex flex-col">
            {items.map((item) => {
              const badge = STAGE_BADGE[item.stage];
              const who = customerLabel(item.customerName ?? item.customer, item.customerEmail);
              const meta = [item.ticketNumber ? `#${item.ticketNumber}` : null, who].filter(Boolean).join(" · ");
              return (
                <li key={item.id}>
                  <Link
                    href={item.url}
                    className="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-150 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.subject || "No subject"}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</p>
                    </div>
                    {badge ? <Badge variant={badge.variant} className="hidden shrink-0 sm:inline-flex">{badge.label}</Badge> : null}
                    <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">waited {formatWait(item.waitedHours)}</span>
                    <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="mx-3 flex items-center gap-3 rounded-lg bg-success/60 px-4 py-4">
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
