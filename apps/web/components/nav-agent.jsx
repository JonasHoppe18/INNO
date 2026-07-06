"use client"

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export function NavAgent({
  items
}) {
  const pathname = usePathname()

  const linkActive = (url) =>
    pathname === url || pathname.startsWith(`${url}/`);

  return (
    <SidebarGroup className="pt-0">
      {/* Matches nav-queue.jsx's QUEUE/INBOXES/AUTOMATED label styling exactly
          (rather than the generic SidebarGroupLabel default) so every sidebar
          section header reads as one consistent system. */}
      <div className="mb-1 px-2 group-data-[collapsible=icon]:hidden">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Tools
        </span>
      </div>
      <SidebarMenu>
        {items.map((item) => (
          <SidebarMenuItem key={item.name}>
            <SidebarMenuButton
              asChild
              tooltip={item.name}
              className={cn(
                "justify-start",
                linkActive(item.url) &&
                  "bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <Link href={item.url} className="flex w-full items-center gap-2 text-inherit no-underline">
                <item.icon className="h-4 w-4" />
                <span>{item.name}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
