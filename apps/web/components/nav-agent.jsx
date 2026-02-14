"use client"

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import {
  SidebarGroup,
  SidebarGroupLabel,
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
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>AI Agent</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <SidebarMenuItem key={item.name}>
            <SidebarMenuButton
              asChild
              className={cn(
                "justify-start",
                linkActive(item.url) &&
                  "bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <Link href={item.url} className="flex w-full items-center gap-2">
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
