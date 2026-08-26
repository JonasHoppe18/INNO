"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, useOrganizationList } from "@clerk/nextjs";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

function membershipOrganization(membership) {
  const organization = membership?.organization;
  if (!organization?.id) return null;
  return {
    id: String(organization.id),
    name: String(organization.name || "Workspace"),
  };
}

function organizationInitials(name) {
  return String(name || "Workspace")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "W";
}

export function WorkspaceSwitcher() {
  const router = useRouter();
  const { orgId } = useAuth();
  const { state } = useSidebar();
  const { isLoaded, setActive, userMemberships } = useOrganizationList({
    userMemberships: { infinite: true, pageSize: 25 },
  });
  const [switchingTo, setSwitchingTo] = useState(null);

  const organizations = useMemo(() => {
    const seen = new Set();
    return (userMemberships?.data || [])
      .map(membershipOrganization)
      .filter((organization) => {
        if (!organization || seen.has(organization.id)) return false;
        seen.add(organization.id);
        return true;
      });
  }, [userMemberships?.data]);

  const activeOrganization = organizations.find((organization) => organization.id === orgId) || null;

  useEffect(() => {
    if (!isLoaded || orgId || organizations.length !== 1 || typeof setActive !== "function") return;

    setActive({ organization: organizations[0].id })
      .then(() => {
        router.refresh();
        window.location.reload();
      })
      .catch(() => toast.error("Could not activate your workspace."));
  }, [isLoaded, orgId, organizations, router, setActive]);

  const handleSelect = async (organizationId) => {
    if (!organizationId || organizationId === orgId || typeof setActive !== "function") return;
    setSwitchingTo(organizationId);
    try {
      await setActive({ organization: organizationId });
      router.refresh();
      window.location.reload();
    } catch (error) {
      setSwitchingTo(null);
      toast.error(error?.errors?.[0]?.longMessage || error?.message || "Could not switch workspace.");
    }
  };

  const label = activeOrganization?.name || (isLoaded ? "Select workspace" : "Loading workspace");
  const workspaceMark = switchingTo
    ? <Loader2 className="size-3.5 animate-spin" />
    : organizationInitials(activeOrganization?.name || label);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="default"
              disabled={!isLoaded || organizations.length === 0 || Boolean(switchingTo)}
              tooltip={label}
              className="h-9 border-0 bg-transparent px-2 transition-[transform,background-color,color] duration-150 ease-out hover:bg-sidebar-accent/70 active:scale-[0.98] group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-1.5"
              aria-label={label}
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-violet-100 text-[10px] font-semibold tracking-wide text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
                {workspaceMark}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium group-data-[collapsible=icon]:hidden">
                {label}
              </span>
              <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-64 rounded-lg"
            side={state === "collapsed" ? "right" : "bottom"}
            align="start"
            sideOffset={6}
          >
            <DropdownMenuLabel className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Switch workspace
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {organizations.map((organization) => (
              <DropdownMenuItem
                key={organization.id}
                disabled={Boolean(switchingTo)}
                onSelect={() => handleSelect(organization.id)}
                className="gap-3 py-2.5"
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-violet-100 text-[10px] font-semibold tracking-wide text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
                  {organizationInitials(organization.name)}
                </span>
                <span className="min-w-0 flex-1 truncate">{organization.name}</span>
                {organization.id === orgId ? <Check className="size-4 text-primary" /> : null}
              </DropdownMenuItem>
            ))}
            {!organizations.length ? (
              <DropdownMenuItem disabled>No workspace available</DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
