"use client";

import { usePathname } from "next/navigation";
import { SidebarInset } from "@/components/ui/sidebar";
import { SiteHeader } from "@/components/site-header";
import { SiteHeaderActionsProvider } from "@/components/site-header-actions";
import { SetupBanner } from "@/components/onboarding/SetupBanner";
import { cn } from "@/lib/utils";

export function DashboardShell({ children }) {
  const pathname = usePathname();
  const isInboxWorkspace = pathname === "/inbox";
  const isSettingsWorkspace = pathname === "/settings";
  const isFixedWorkspace = isInboxWorkspace || isSettingsWorkspace;

  return (
    <SidebarInset className={cn(isFixedWorkspace ? "h-[calc(100svh_-_var(--app-top-offset,0px))] overflow-hidden" : "min-h-svh")}>
      <SiteHeaderActionsProvider>
        <SiteHeader />
        <SetupBanner />
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            isFixedWorkspace ? "overflow-hidden" : "overflow-auto"
          )}
        >
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col gap-2",
              isFixedWorkspace ? "overflow-hidden" : "overflow-visible"
            )}
          >
            {children}
          </div>
        </div>
      </SiteHeaderActionsProvider>
    </SidebarInset>
  );
}
