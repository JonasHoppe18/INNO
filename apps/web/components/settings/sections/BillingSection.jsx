"use client";

import { Badge } from "@/components/ui/badge";

export function BillingSection() {
  return (
    <section className="w-full space-y-5">
      <div className="mb-6">
        <h2 className="text-page-heading font-semibold tracking-tight text-foreground">Billing</h2>
        <p className="mt-1 text-sm text-muted-foreground">Manage your subscription and plan.</p>
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-foreground">Current plan</span>
          <Badge className="bg-success text-success-foreground hover:bg-success">
            Free Beta
          </Badge>
        </div>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          Your workspace has full beta access. Billing controls will become available before paid plans launch.
        </p>
      </div>
    </section>
  );
}
