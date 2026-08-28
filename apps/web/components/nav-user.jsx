"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  Check,
  CreditCardIcon,
  Loader2,
  LogOutIcon,
  MoreVerticalIcon,
  SettingsIcon,
} from "lucide-react"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { SignOutButton, useAuth, useOrganizationList } from "@clerk/nextjs"
import { toast } from "sonner"

function membershipOrganization(membership) {
  const organization = membership?.organization
  if (!organization?.id) return null
  return {
    id: String(organization.id),
    name: String(organization.name || "Workspace"),
  }
}

function organizationInitials(name) {
  return String(name || "Workspace")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "W"
}

export function NavUser({
  user,
  compact = false,
}) {
  const router = useRouter()
  const { isMobile } = useSidebar()
  const { orgId } = useAuth()
  const { isLoaded, setActive, userMemberships } = useOrganizationList({
    userMemberships: { infinite: true, pageSize: 25 },
  })
  const [switchingTo, setSwitchingTo] = useState(null)

  const organizations = useMemo(() => {
    const seen = new Set()
    return (userMemberships?.data || [])
      .map(membershipOrganization)
      .filter((organization) => {
        if (!organization || seen.has(organization.id)) return false
        seen.add(organization.id)
        return true
      })
  }, [userMemberships?.data])

  useEffect(() => {
    if (!isLoaded || orgId || organizations.length !== 1 || typeof setActive !== "function") return

    setActive({ organization: organizations[0].id })
      .then(() => {
        router.refresh()
        window.location.reload()
      })
      .catch(() => toast.error("Could not activate your workspace."))
  }, [isLoaded, orgId, organizations, router, setActive])

  const handleWorkspaceSelect = async (organizationId) => {
    if (!organizationId || organizationId === orgId || typeof setActive !== "function") return
    setSwitchingTo(organizationId)
    try {
      await setActive({ organization: organizationId })
      router.refresh()
      window.location.reload()
    } catch (error) {
      setSwitchingTo(null)
      toast.error(error?.errors?.[0]?.longMessage || error?.message || "Could not switch workspace.")
    }
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              tooltip={compact ? user.name : undefined}
              aria-label={compact ? user.name : undefined}
              className={cn(
                "data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground",
                compact && "size-8 justify-center px-0"
              )}>
              <Avatar className="h-8 w-8 rounded-lg grayscale">
                <AvatarImage src={user.avatar} alt={user.name} />
                <AvatarFallback className="rounded-lg">CN</AvatarFallback>
              </Avatar>
              <div className={cn("grid flex-1 text-left text-sm leading-tight", compact && "sr-only")}>
                <span className="truncate font-medium">{user.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {user.email}
                </span>
              </div>
              <MoreVerticalIcon className={cn("ml-auto size-4", compact && "sr-only")} />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}>
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage src={user.avatar} alt={user.name} />
                  <AvatarFallback className="rounded-lg">CN</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {user.email}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="px-2 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Workspace
            </DropdownMenuLabel>
            {organizations.map((organization) => (
              <DropdownMenuItem
                key={organization.id}
                disabled={Boolean(switchingTo)}
                onSelect={() => handleWorkspaceSelect(organization.id)}
                className="gap-3 py-2"
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-violet-100 text-[10px] font-semibold tracking-wide text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
                  {switchingTo === organization.id ? <Loader2 className="size-3.5 animate-spin" /> : organizationInitials(organization.name)}
                </span>
                <span className="min-w-0 flex-1 truncate">{organization.name}</span>
                {organization.id === orgId ? <Check className="size-4 text-primary" /> : null}
              </DropdownMenuItem>
            ))}
            {!organizations.length && isLoaded ? (
              <DropdownMenuItem disabled>No workspace available</DropdownMenuItem>
            ) : null}
            {!isLoaded ? (
              <DropdownMenuItem disabled>Loading workspace...</DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <CreditCardIcon />
                Billing
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/settings">
                  <SettingsIcon />
                  Settings
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <LogOutIcon />
              <SignOutButton redirectUrl={process.env.NEXT_PUBLIC_MARKETING_URL || "/"}>
                Log out
              </SignOutButton>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
