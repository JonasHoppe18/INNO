"use client";

import { usePathname } from "next/navigation";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useSiteHeaderActions } from "@/components/site-header-actions";

const TITLE_MAP = {
  "/dashboard": "Dashboard",
  "/inbox": "Inbox",
  "/automation": "Automation",
  "/knowledge": "Knowledge Base",
  "/integrations": "Integrations",
  "/settings": "Settings",
  "/persona": "Persona",
};

export function SiteHeader() {
  const pathname = usePathname();
  const title = TITLE_MAP[pathname] || "Sona";
  const { actions } = useSiteHeaderActions();

  return (
    <header
      className="group-has-data-[collapsible=icon]/sidebar-wrapper:h-12 flex h-12 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
        <h1 className="text-base font-medium">{title}</h1>
        {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
