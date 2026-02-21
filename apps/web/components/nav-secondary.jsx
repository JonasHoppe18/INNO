"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react"

import { cn } from "@/lib/utils";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export function NavSecondary({
  items,
  ...props
}) {
  const pathname = usePathname();

  const linkActive = React.useCallback(
    (url) => pathname === url || pathname.startsWith(`${url}/`),
    [pathname]
  );

  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                asChild
                className={cn(
                  "justify-start",
                  linkActive(item.url) &&
                    "bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <Link href={item.url} className="flex w-full items-center gap-2 text-inherit no-underline">
                  <item.icon className="h-4 w-4" />
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
