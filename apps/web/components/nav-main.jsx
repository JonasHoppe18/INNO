"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

export function NavMain({ items }) {
  const pathname = usePathname();

  const initiallyOpen = useMemo(() => {
    const set = new Set();
    items.forEach((item) => {
      if (
        item.children?.some((child) =>
          pathname.startsWith(child.url)
        )
      ) {
        set.add(item.title);
      }
    });
    return set;
  }, [items, pathname]);

  const [openGroups, setOpenGroups] = useState(initiallyOpen);

  useEffect(() => {
    setOpenGroups(initiallyOpen);
  }, [initiallyOpen]);

  const toggleGroup = (item) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(item.title)) {
        next.delete(item.title);
      } else {
        next.add(item.title);
      }
      return next;
    });
  };

  const isActiveLink = (url, children) => {
    if (!children?.length) {
      return pathname === url || pathname.startsWith(`${url}/`);
    }
    return children.some((child) => pathname.startsWith(child.url));
  };

  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          {items.map((item) => {
            const hasChildren = Boolean(item.children?.length);
            const isOpen = openGroups.has(item.title);
            const isActive = isActiveLink(item.url, item.children);
            const showChildren =
              hasChildren && (isOpen || pathname.startsWith(item.url));

            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  asChild={!hasChildren}
                  tooltip={item.title}
                  className={cn(
                    "group/entry justify-start",
                    isActive &&
                      "bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                  onClick={
                    hasChildren
                      ? (event) => {
                          event.preventDefault();
                          toggleGroup(item);
                        }
                      : undefined
                  }
                >
                  {hasChildren ? (
                    <div className="flex w-full items-center gap-2">
                      <Link
                        href={item.url}
                        className="flex flex-1 items-center gap-2 text-inherit no-underline"
                      >
                        {item.icon && <item.icon className="h-4 w-4" />}
                        <span>{item.title}</span>
                      </Link>
                    </div>
                  ) : (
                     <Link href={item.url} className="flex w-full items-center gap-2 text-inherit no-underline">
                       {item.icon && <item.icon className="h-4 w-4" />}
                       <span>{item.title}</span>
                     </Link>
                  )}
                </SidebarMenuButton>
                {showChildren && (
                  <div className="mt-2 flex flex-col gap-1 border-l border-border/60 pl-4">
                    {item.children.map((child) => (
                      <Link
                        key={child.title}
                        href={child.url}
                        className={cn(
                          "flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-muted-foreground no-underline hover:bg-muted hover:text-foreground",
                          pathname.startsWith(child.url) && "bg-muted text-foreground"
                        )}
                      >
                        {child.icon && <child.icon className="h-4 w-4" />}
                        {child.title}
                      </Link>
                    ))}
                  </div>
                )}
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
