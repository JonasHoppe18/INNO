"use client";

import { useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { pendingThreadReads } from "@/lib/client/pending-thread-read";
import { scopedReadCache } from "@/lib/client/scoped-read-cache";
import { usePathname } from "next/navigation";
import { SidebarInset, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { SiteHeader } from "@/components/site-header";
import { SiteHeaderActionsProvider } from "@/components/site-header-actions";
import { SetupBanner } from "@/components/onboarding/SetupBanner";
import { cn } from "@/lib/utils";
import { isSettingsSectionPath } from "@/lib/settings/navigation";

export function DashboardShell({ children }) {
  const pathname = usePathname();
  const { userId, sessionId, orgId } = useAuth();
  useEffect(() => () => { scopedReadCache.clear(); pendingThreadReads.clear(); }, [userId, sessionId, orgId]);
  const { setOpenMobile } = useSidebar();

  useEffect(() => {
    setOpenMobile(false);
  }, [pathname, setOpenMobile]);
  const isInboxWorkspace = pathname === "/inbox";
  const isSettingsWorkspace = isSettingsSectionPath(pathname);
  const isPlaygroundWorkspace = pathname === "/playground";
  const isFixedWorkspace = isInboxWorkspace || isSettingsWorkspace || isPlaygroundWorkspace;

  return (
    <SidebarInset className={cn(isFixedWorkspace ? "h-[calc(100svh_-_var(--app-top-offset,0px))] !min-h-0 overflow-hidden" : "min-h-svh")}>
      <SiteHeaderActionsProvider>
        {isInboxWorkspace ? <SiteHeader /> : (
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-background px-4 md:hidden">
            <SidebarTrigger aria-label="Open navigation" />
            <span className="text-sm font-medium">Sona</span>
          </div>
        )}
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
