"use client";

import { usePathname } from "next/navigation";
import { SidebarInset } from "@/components/ui/sidebar";
import { SiteHeader } from "@/components/site-header";
import { SiteHeaderActionsProvider } from "@/components/site-header-actions";
import { SetupBanner } from "@/components/onboarding/SetupBanner";
import { cn } from "@/lib/utils";

export function DashboardShell({ children }) {
  const pathname = usePathname();
  const isInbox = pathname === "/inbox" || pathname?.startsWith("/inbox/");

  return (
    <SidebarInset className={cn(isInbox ? "h-svh overflow-hidden" : "min-h-svh")}>
      <SiteHeaderActionsProvider>
        <SiteHeader />
        <SetupBanner />
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            isInbox ? "overflow-hidden" : "overflow-auto"
          )}
        >
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col gap-2",
              isInbox ? "overflow-hidden" : "overflow-visible"
            )}
          >
            {children}
          </div>
        </div>
      </SiteHeaderActionsProvider>
    </SidebarInset>
  );
}
