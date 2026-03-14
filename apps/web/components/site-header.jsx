"use client";

import { usePathname } from "next/navigation";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useSiteHeaderActions } from "@/components/site-header-actions";

const TITLE_MAP = {
  "/dashboard": "Dashboard",
  "/inbox": "Inbox",
  "/inbox/tickets": "Tickets",
  "/automation": "Automation",
  "/knowledge-hub": "Knowledge",
  "/knowledge": "Knowledge Base",
  "/integrations": "Integrations",
  "/settings": "Settings",
  "/persona": "Persona",
};

export function SiteHeader() {
  const pathname = usePathname();
  const title = TITLE_MAP[pathname] || "Sona";
  const { actions, titleContent } = useSiteHeaderActions();
  const hasCustomTitle = Boolean(titleContent);

  return (
    <header
      className={`group-has-data-[collapsible=icon]/sidebar-wrapper:h-10 flex h-10 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear ${
        hasCustomTitle ? "bg-white" : "bg-white"
      }`}>
      <div
        className={
          hasCustomTitle
            ? "relative flex w-full min-w-0 items-center"
            : "relative flex w-full min-w-0 items-center px-4 lg:px-6"
        }
      >
        <div
          className={
            hasCustomTitle
              ? "pointer-events-none absolute left-4 top-1/2 z-10 flex -translate-y-1/2 items-center gap-1 lg:left-6 lg:gap-2"
              : "flex items-center gap-1 lg:gap-2"
          }
        >
          <SidebarTrigger className="-ml-1 pointer-events-auto" />
          <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
        </div>
        {titleContent ? (
          <div className="min-w-0 flex-1">{titleContent}</div>
        ) : (
          <h1 className="ml-11 text-base font-medium lg:ml-12">{title}</h1>
        )}
        {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
