import Link from "next/link";
import { CheckCircle2Icon, CircleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// Healthy: one quiet line. Broken: the card itself is the alert.
export function SystemStatusLine({ status }) {
  const checks = status?.checks || [];
  if (!checks.length) return null;

  if (status.healthy) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border/70 bg-card px-4 py-2.5 shadow-sm">
        <span className="flex items-center gap-2 text-sm font-medium">
          <CheckCircle2Icon className="size-4 text-success-foreground" aria-hidden="true" />
          Everything is connected
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {checks.map((check) => (
            <span key={check.key} className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-success-foreground" aria-hidden="true" />
              {check.label}
            </span>
          ))}
        </span>
      </div>
    );
  }

  const failing = checks.filter((check) => !check.ok);
  const first = failing[0];
  return (
    <Card role="alert" className="rounded-xl border-danger-border shadow-sm">
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex items-center gap-3">
          <CircleAlertIcon className="size-5 shrink-0 text-danger-foreground" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-danger-foreground">{first.label} disconnected</p>
            <p className="text-xs text-muted-foreground">{first.detail}. New mail and replies may not get through until it&apos;s reconnected.</p>
          </div>
          <Button size="sm" className="shrink-0" asChild>
            <Link href={first.href}>{first.action}</Link>
          </Button>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {checks.map((check) => (
            <li key={check.key} className={cn("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm", check.ok ? "bg-muted/40" : "bg-danger")}>
              <span className={cn("size-1.5 rounded-full", check.ok ? "bg-success-foreground" : "bg-danger-foreground")} aria-hidden="true" />
              <span className="flex-1">{check.label}</span>
              <span className={cn("text-xs", check.ok ? "text-muted-foreground" : "text-danger-foreground")}>{check.detail}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
