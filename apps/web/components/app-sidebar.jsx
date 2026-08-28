"use client"

import Link from "next/link"
import { useEffect, useState, useSyncExternalStore } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  getLiveSidebarCountsServerSnapshot,
  getLiveSidebarCountsSnapshot,
  subscribeLiveSidebarCounts,
} from "@/lib/inbox/live-sidebar-counts"
import {
  BarChart2Icon,
  BookOpenIcon,
  CableIcon,
  CirclePlayIcon,
  InboxIcon,
  LayoutDashboardIcon,
  ListIcon,
  MailIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
  Trash2,
} from "lucide-react"

import { NavMain } from "@/components/nav-main"
import { NavQueue } from "@/components/nav-queue"
import { NavUser } from "@/components/nav-user"
import { cn } from "@/lib/utils"
import { useClerkSupabase } from "@/lib/useClerkSupabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"

import { SonaLogo } from "@/components/ui/SonaLogo"

const baseData = {
  user: {
    name: "shadcn",
    email: "m@example.com",
    avatar: "/avatars/shadcn.jpg",
  },
  // Top tier — overview/reference surfaces you check often, ahead of the
  // work-queue sections below. Playground moved into /settings (its own
  // WORKSPACE menu section, alongside Mailboxes/Automation/Tags) since it
  // isn't in active use right now, unlike Knowledge/Analytics.
  navMain: [
    {
      title: "Dashboard",
      url: "/dashboard",
      icon: LayoutDashboardIcon,
    },
    {
      title: "New Ticket",
      url: "/inbox?new=1",
      icon: SquarePenIcon,
    },
    {
      title: "Knowledge",
      url: "/knowledge",
      icon: BookOpenIcon,
    },
    {
      title: "Analytics",
      url: "/analytics",
      icon: BarChart2Icon,
    },
    {
      title: "Integrations",
      url: "/integrations",
      icon: CableIcon,
    },
  ],
}

function SidebarWorkspaceRail({ items, pathname, user }) {
  const isActive = (url) => {
    if (url === "/inbox") return pathname.startsWith("/inbox")
    return pathname === url || pathname.startsWith(`${url}/`)
  }

  return (
    <div className="flex h-full min-h-0 w-[68px] shrink-0 flex-col border-r border-sidebar-border/55 bg-sidebar">
      <div className="flex items-center justify-center px-2 py-3.5">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip="Sona AI"
              tooltipAlways
              className="size-8 justify-center px-0"
            >
              <Link href="/dashboard" aria-label="Sona AI">
                <SonaLogo size={20} className="h-5 w-5 shrink-0" />
                <span className="sr-only">Sona AI</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        <SidebarMenu className="gap-1.5">
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={isActive("/inbox")}
              tooltip="Inbox"
              tooltipAlways
              className="size-8 justify-center px-0"
            >
              <Link href="/inbox" aria-label="Inbox">
                <InboxIcon className="h-4 w-4" />
                <span className="sr-only">Inbox</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="mx-2 my-2.5 h-px bg-sidebar-border/55" />
        <SidebarMenu className="gap-1.5">
          {items.map((item) => {
            const Icon = item.icon
            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  asChild
                  isActive={isActive(item.url)}
                  tooltip={item.title}
                  tooltipAlways
                  className="size-8 justify-center px-0"
                >
                  <Link href={item.url} aria-label={item.title}>
                    {Icon ? <Icon className="h-4 w-4" /> : null}
                    <span className="sr-only">{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </div>

      <div className="mt-auto border-t border-sidebar-border/55 p-2">
        <SidebarMenu className="gap-1.5">
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={pathname.startsWith("/guides")}
              tooltip="Sona Academy"
              tooltipAlways
              className="size-8 justify-center px-0"
            >
              <Link href="/guides" aria-label="Sona Academy">
                <CirclePlayIcon className="h-4 w-4" />
                <span className="sr-only">Sona Academy</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={pathname.startsWith("/settings")}
              tooltip="Settings"
              tooltipAlways
              className="size-8 justify-center px-0"
            >
              <Link href="/settings" aria-label="Settings">
                <SettingsIcon className="h-4 w-4" />
                <span className="sr-only">Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <NavUser user={user} compact />
      </div>
    </div>
  )
}

export function AppSidebar({
  user,
  className,
  ...props
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { isMobile } = useSidebar()
  // Same raw `?view=` semantics as useThreadFilters.js (Task 6, Plan 1): the
  // literal param value, "" meaning the needs-attention default. NavQueue
  // compares this directly against each row's target view. Only meaningful
  // while actually on an inbox route — on every other page (e.g. Dashboard)
  // there's no view at all, so this is `null` rather than "", which would
  // otherwise be indistinguishable from "on /inbox with no ?view=" and mark
  // "Inbox" active everywhere.
  const isInboxRoute = pathname.startsWith("/inbox")
  const activeView = isInboxRoute
    ? pathname === "/inbox/tickets"
      ? "all"
      : searchParams.get("view") || ""
    : null

  const [customInboxes, setCustomInboxes] = useState([])
  const [createInboxOpen, setCreateInboxOpen] = useState(false)
  const [createInboxName, setCreateInboxName] = useState("")
  const [createInboxError, setCreateInboxError] = useState("")
  const [isCreatingInbox, setIsCreatingInbox] = useState(false)
  const [deleteInboxOpen, setDeleteInboxOpen] = useState(false)
  const [deleteInboxTarget, setDeleteInboxTarget] = useState(null)
  const [deleteInboxError, setDeleteInboxError] = useState("")
  const [isDeletingInbox, setIsDeletingInbox] = useState(false)
  const [configureInboxOpen, setConfigureInboxOpen] = useState(false)
  const [configureInboxTarget, setConfigureInboxTarget] = useState(null)
  const [configureInboxRules, setConfigureInboxRules] = useState([])
  const [configureInboxRulesLoading, setConfigureInboxRulesLoading] = useState(false)
  const [configureInboxRulesSaving, setConfigureInboxRulesSaving] = useState(false)
  const [configureInboxError, setConfigureInboxError] = useState("")
  const [newSenderRuleType, setNewSenderRuleType] = useState("email")
  const [newSenderRuleValue, setNewSenderRuleValue] = useState("")
  const [notificationsCount, setNotificationsCount] = useState(0)
  // Task 11, Plan 2: sidebar-counts payload keys consumed by NavQueue's
  // QUEUE section. Default 0/{} — pre-migration (Plan 1's migration not yet
  // applied to the live DB) these read as 0/empty, which is expected.
  const [needsAttentionCount, setNeedsAttentionCount] = useState(0)
  const [mineCount, setMineCount] = useState(0)
  const [waitingCustomerCount, setWaitingCustomerCount] = useState(0)
  const [waitingThirdPartyCount, setWaitingThirdPartyCount] = useState(0)
  const [inboxNeedsAttentionCounts, setInboxNeedsAttentionCounts] = useState({})
  // Exact client-side counts published by InboxSplitView while the inbox is
  // mounted (null on other pages) — see lib/inbox/live-sidebar-counts.js.
  const liveCounts = useSyncExternalStore(
    subscribeLiveSidebarCounts,
    getLiveSidebarCountsSnapshot,
    getLiveSidebarCountsServerSnapshot,
  )
  const supabase = useClerkSupabase()

  const loadCustomInboxes = async () => {
    const response = await fetch("/api/inboxes", {
      method: "GET",
      cache: "no-store",
      credentials: "include",
    }).catch(() => null)
    if (!response?.ok) return
    const payload = await response.json().catch(() => ({}))
    const inboxes = Array.isArray(payload?.inboxes) ? payload.inboxes : []
    setCustomInboxes(inboxes)
  }

  useEffect(() => {
    if (!supabase) return
    loadCustomInboxes().catch(() => null)
  }, [supabase])

  useEffect(() => {
    if (!supabase) return
    let active = true

    const loadCounts = async () => {
      const sidebarRes = await fetch("/api/inbox/sidebar-counts", {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      }).catch(() => null)
      if (!active) return
      if (sidebarRes?.ok) {
        const payload = await sidebarRes.json().catch(() => ({}))
        if (active) {
          setNotificationsCount(Number(payload?.notificationsCount ?? 0))
          setNeedsAttentionCount(Number(payload?.needsAttentionCount ?? 0))
          setMineCount(Number(payload?.mineCount ?? 0))
          setWaitingCustomerCount(Number(payload?.waitingCustomerCount ?? 0))
          setWaitingThirdPartyCount(Number(payload?.waitingThirdPartyCount ?? 0))
          setInboxNeedsAttentionCounts(
            payload?.inboxNeedsAttentionCounts && typeof payload.inboxNeedsAttentionCounts === "object"
              ? payload.inboxNeedsAttentionCounts
              : {}
          )
        }
      }
    }

    const onThreadRead = () => loadCounts().catch(() => null)

    loadCounts().catch(() => null)
    window.addEventListener("sona:thread-read", onThreadRead)

    return () => {
      active = false
      window.removeEventListener("sona:thread-read", onThreadRead)
    }
  }, [supabase])

  const handleOpenCreateInbox = () => {
    setCreateInboxName("")
    setCreateInboxError("")
    setCreateInboxOpen(true)
  }

  const handleCreateInbox = async () => {
    const name = createInboxName.trim()
    if (!name) {
      setCreateInboxError("Inbox name is required.")
      return
    }
    setIsCreatingInbox(true)
    setCreateInboxError("")
    const response = await fetch("/api/inboxes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
      credentials: "include",
    }).catch(() => null)
    if (!response?.ok) {
      const payload = await response?.json().catch(() => ({}))
      setCreateInboxError(payload?.error || "Could not create inbox.")
      setIsCreatingInbox(false)
      return
    }
    await loadCustomInboxes().catch(() => null)
    setIsCreatingInbox(false)
    setCreateInboxOpen(false)
    setCreateInboxName("")
  }

  const handleOpenDeleteInbox = (inbox) => {
    setDeleteInboxTarget(inbox || null)
    setDeleteInboxError("")
    setDeleteInboxOpen(true)
  }

  const loadSenderRulesForTarget = async (target) => {
    const destinationType = String(target?.destinationType || "").trim().toLowerCase()
    const destinationValue = String(target?.destinationValue || "").trim().toLowerCase()
    if (!destinationType || !destinationValue) {
      setConfigureInboxRules([])
      return
    }
    setConfigureInboxRulesLoading(true)
    setConfigureInboxError("")
    try {
      const response = await fetch("/api/settings/email-sender-rules", {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      }).catch(() => null)
      if (!response?.ok) {
        const payload = await response?.json().catch(() => ({}))
        throw new Error(payload?.error || "Could not load sender rules.")
      }
      const payload = await response.json().catch(() => ({}))
      const rows = Array.isArray(payload?.rules) ? payload.rules : []
      const filteredRules = rows
        .filter((row) => {
          return (
            String(row?.destination_type || "").trim().toLowerCase() === destinationType &&
            String(row?.destination_value || "").trim().toLowerCase() === destinationValue
          )
        })
        .map((row) => ({
          id: String(row?.id || "").trim(),
          matcher_type:
            String(row?.matcher_type || "").trim().toLowerCase() === "domain" ? "domain" : "email",
          matcher_value: String(row?.matcher_value || "").trim(),
          is_active: Boolean(row?.is_active),
        }))
        .filter((row) => row.id && row.matcher_value)
      setConfigureInboxRules(filteredRules)
    } catch (error) {
      setConfigureInboxRules([])
      setConfigureInboxError(error?.message || "Could not load sender rules.")
    } finally {
      setConfigureInboxRulesLoading(false)
    }
  }

  const handleConfigureInbox = (inbox) => {
    const slug = String(inbox?.slug || "").trim().toLowerCase()
    const target = { ...inbox, destinationType: "inbox", destinationValue: slug }
    setConfigureInboxTarget(target)
    setConfigureInboxOpen(true)
    setNewSenderRuleType("email")
    setNewSenderRuleValue("")
    setConfigureInboxError("")
    loadSenderRulesForTarget(target).catch(() => null)
  }

  const handleConfigureNotifications = () => {
    const target = {
      name: "Notifications",
      builtin: true,
      destinationType: "classification",
      destinationValue: "notification",
    }
    setConfigureInboxTarget(target)
    setConfigureInboxOpen(true)
    setNewSenderRuleType("email")
    setNewSenderRuleValue("")
    setConfigureInboxError("")
    loadSenderRulesForTarget(target).catch(() => null)
  }

  const handleCreateSenderRuleForInbox = async () => {
    const destinationType = String(configureInboxTarget?.destinationType || "inbox").trim().toLowerCase()
    const destinationValue = String(configureInboxTarget?.destinationValue || "").trim().toLowerCase()
    const matcherType = newSenderRuleType === "domain" ? "domain" : "email"
    const matcherValue = String(newSenderRuleValue || "").trim().toLowerCase()
    if (!destinationValue || !matcherValue) return

    setConfigureInboxRulesSaving(true)
    setConfigureInboxError("")
    try {
      const response = await fetch("/api/settings/email-sender-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          matcher_type: matcherType,
          matcher_value: matcherValue,
          destination_type: destinationType,
          destination_value: destinationValue,
          is_active: true,
        }),
      }).catch(() => null)
      if (!response?.ok) {
        const payload = await response?.json().catch(() => ({}))
        throw new Error(payload?.error || "Could not save sender rule.")
      }
      setNewSenderRuleType("email")
      setNewSenderRuleValue("")
      await loadSenderRulesForTarget(configureInboxTarget)
    } catch (error) {
      setConfigureInboxError(error?.message || "Could not save sender rule.")
    } finally {
      setConfigureInboxRulesSaving(false)
    }
  }

  const handleToggleSenderRuleForInbox = async (rule, nextActive) => {
    const id = String(rule?.id || "").trim()
    if (!id) return
    setConfigureInboxRulesSaving(true)
    setConfigureInboxError("")
    try {
      const response = await fetch("/api/settings/email-sender-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          id,
          is_active: Boolean(nextActive),
        }),
      }).catch(() => null)
      if (!response?.ok) {
        const payload = await response?.json().catch(() => ({}))
        throw new Error(payload?.error || "Could not update sender rule.")
      }
      await loadSenderRulesForTarget(configureInboxTarget)
    } catch (error) {
      setConfigureInboxError(error?.message || "Could not update sender rule.")
    } finally {
      setConfigureInboxRulesSaving(false)
    }
  }

  const handleDeleteSenderRuleForInbox = async (rule) => {
    const id = String(rule?.id || "").trim()
    if (!id) return
    setConfigureInboxRulesSaving(true)
    setConfigureInboxError("")
    try {
      const response = await fetch("/api/settings/email-sender-rules", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id }),
      }).catch(() => null)
      if (!response?.ok) {
        const payload = await response?.json().catch(() => ({}))
        throw new Error(payload?.error || "Could not delete sender rule.")
      }
      await loadSenderRulesForTarget(configureInboxTarget)
    } catch (error) {
      setConfigureInboxError(error?.message || "Could not delete sender rule.")
    } finally {
      setConfigureInboxRulesSaving(false)
    }
  }

  const handleDeleteInbox = async () => {
    const slug = String(deleteInboxTarget?.slug || "").trim()
    if (!slug) {
      setDeleteInboxError("Inbox slug is missing.")
      return
    }
    setIsDeletingInbox(true)
    setDeleteInboxError("")
    const response = await fetch("/api/inboxes", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug }),
      credentials: "include",
    }).catch(() => null)
    if (!response?.ok) {
      const payload = await response?.json().catch(() => ({}))
      setDeleteInboxError(payload?.error || "Could not delete inbox.")
      setIsDeletingInbox(false)
      return
    }
    await loadCustomInboxes().catch(() => null)
    setIsDeletingInbox(false)
    setDeleteInboxOpen(false)
    setDeleteInboxTarget(null)
  }

  const data = {
    ...baseData,
    user: user ?? baseData.user,
  }

  // NavQueue's counts prop mirrors the /api/inbox/sidebar-counts payload
  // shape (Plan 1 Task 10) — see nav-queue.jsx for per-key rendering rules.
  // Every count here is unread-only: a bucket with 20 threads but 0 unread
  // reads as 0, never the total sitting in it (see computeSidebarCounts in
  // view-model.js). While the inbox is mounted, InboxSplitView publishes
  // exact client-side counts (computed from the loaded thread list, same
  // source as the status tabs) via the live-sidebar-counts bridge; those win
  // over the DB-side API values, which read 0 pre-migration and lag
  // optimistic updates after.
  const queueCounts = {
    needsAttentionCount: liveCounts?.needsAttentionCount ?? needsAttentionCount,
    mineCount: liveCounts?.mineCount ?? mineCount,
    waitingCustomerCount: liveCounts?.waitingCustomerCount ?? waitingCustomerCount,
    waitingThirdPartyCount:
      liveCounts?.waitingThirdPartyCount ?? waitingThirdPartyCount,
    notificationsCount: liveCounts?.notificationsCount ?? notificationsCount,
    inboxNeedsAttentionCounts:
      liveCounts?.inboxNeedsAttentionCounts ?? inboxNeedsAttentionCounts,
  }

  return (
    <Sidebar
      collapsible={isMobile ? "offcanvas" : "none"}
      className={cn("[&_a]:text-inherit [&_a]:no-underline", className)}
      {...props}
      style={
        !isMobile
          ? { "--sidebar-width": isInboxRoute ? "21rem" : "68px" }
          : undefined
      }
    >
      {isInboxRoute && !isMobile ? (
        <div className="flex h-full w-full min-w-0">
          <SidebarWorkspaceRail items={data.navMain} pathname={pathname} user={data.user} />
          <div className="flex min-w-0 flex-1 flex-col bg-sidebar">
            <div className="border-b border-sidebar-border/55 px-3 py-3.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold tracking-[-0.01em] text-sidebar-foreground">Inbox</p>
                  <p className="truncate text-[11px] text-sidebar-foreground/55">Customer conversations</p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    aria-label="Search inbox"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-sidebar-foreground/55 transition-[background-color,color,transform] duration-150 ease-out hover:bg-sidebar-accent hover:text-sidebar-foreground active:scale-[0.97]"
                    onClick={() => {
                      document.querySelector('[aria-label="Search tickets"]')?.focus()
                    }}
                  >
                    <SearchIcon className="h-3.5 w-3.5" />
                  </button>
                  <Link
                    href="/inbox/tickets"
                    aria-label="All tickets"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/55 transition-[background-color,color,transform] duration-150 ease-out hover:bg-sidebar-accent hover:text-sidebar-foreground active:scale-[0.97]"
                  >
                    <ListIcon className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </div>
            <SidebarContent className="gap-0">
              <NavQueue
                contextual
                counts={queueCounts}
                inboxes={customInboxes}
                activeView={activeView}
                onCreateInbox={handleOpenCreateInbox}
                onConfigureInbox={handleConfigureInbox}
                onConfigureNotifications={handleConfigureNotifications}
              />
            </SidebarContent>
          </div>
        </div>
      ) : !isMobile ? (
        <SidebarWorkspaceRail items={data.navMain} pathname={pathname} user={data.user} />
      ) : (
        <>
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  tooltip="Sona AI"
                  className="data-[slot=sidebar-menu-button]:!p-1.5 group-data-[collapsible=icon]:justify-center"
                >
                  <Link href="/dashboard" className="flex items-center gap-2 text-inherit no-underline">
                    <SonaLogo size={22} className="h-[22px] w-[22px] shrink-0" />
                    <span className="text-base font-semibold group-data-[collapsible=icon]:hidden">Sona AI</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>
          <SidebarContent>
            <NavMain items={data.navMain} />
            <NavQueue
              counts={queueCounts}
              inboxes={customInboxes}
              activeView={activeView}
              onCreateInbox={handleOpenCreateInbox}
              onConfigureInbox={handleConfigureInbox}
              onConfigureNotifications={handleConfigureNotifications}
            />
          </SidebarContent>
          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  tooltip="Sona Academy"
                  className={cn(
                    "justify-start text-foreground",
                    pathname.startsWith("/guides") &&
                      "bg-accent text-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  <Link href="/guides" prefetch className="flex w-full items-center gap-2 no-underline">
                    <CirclePlayIcon className="h-4 w-4" />
                    <span>Sona Academy</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
            <NavUser user={data.user} />
          </SidebarFooter>
        </>
      )}
      <Dialog open={createInboxOpen} onOpenChange={setCreateInboxOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Create inbox</DialogTitle>
            <DialogDescription>
              Create a team inbox that tickets can be assigned to.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault()
              handleCreateInbox().catch(() => null)
            }}
          >
            <Input
              value={createInboxName}
              onChange={(event) => {
                setCreateInboxName(event.target.value)
                if (createInboxError) setCreateInboxError("")
              }}
              placeholder="Inbox name"
              autoFocus
            />
            {createInboxError ? (
              <p className="text-xs text-red-600">{createInboxError}</p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateInboxOpen(false)}
                disabled={isCreatingInbox}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isCreatingInbox}>
                {isCreatingInbox ? "Creating..." : "Create inbox"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={deleteInboxOpen}
        onOpenChange={(open) => {
          setDeleteInboxOpen(open)
          if (!open) {
            setDeleteInboxTarget(null)
            setDeleteInboxError("")
          }
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Delete inbox</DialogTitle>
            <DialogDescription>
              Delete &quot;{deleteInboxTarget?.name || deleteInboxTarget?.slug || "this inbox"}&quot;?
              This only applies to custom teams/inboxes.
            </DialogDescription>
          </DialogHeader>
          {deleteInboxError ? (
            <p className="text-xs text-red-600">{deleteInboxError}</p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteInboxOpen(false)}
              disabled={isDeletingInbox}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                handleDeleteInbox().catch(() => null)
              }}
              disabled={isDeletingInbox}
            >
              {isDeletingInbox ? "Deleting..." : "Delete inbox"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={configureInboxOpen}
        onOpenChange={(open) => {
          setConfigureInboxOpen(open)
          if (!open) {
            setConfigureInboxTarget(null)
            setConfigureInboxRules([])
            setConfigureInboxError("")
            setNewSenderRuleType("email")
            setNewSenderRuleValue("")
          }
        }}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>
              {configureInboxTarget?.name || configureInboxTarget?.slug || "Inbox"}
            </DialogTitle>
            <DialogDescription>
              Emails matching these rules are routed directly to this inbox.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                handleCreateSenderRuleForInbox().catch(() => null)
              }}
            >
              <div className="flex rounded-md border border-input overflow-hidden shrink-0">
                <button
                  type="button"
                  disabled={configureInboxRulesSaving}
                  onClick={() => setNewSenderRuleType("email")}
                  className={cn(
                    "px-3 py-2 text-sm font-medium transition-colors duration-150",
                    newSenderRuleType === "email"
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  Email
                </button>
                <button
                  type="button"
                  disabled={configureInboxRulesSaving}
                  onClick={() => setNewSenderRuleType("domain")}
                  className={cn(
                    "px-3 py-2 text-sm font-medium transition-colors duration-150 border-l border-input",
                    newSenderRuleType === "domain"
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  Domain
                </button>
              </div>
              <Input
                value={newSenderRuleValue}
                onChange={(event) => setNewSenderRuleValue(event.target.value)}
                placeholder={newSenderRuleType === "domain" ? "example.com" : "sender@example.com"}
                disabled={configureInboxRulesSaving}
                className="flex-1"
              />
              <Button
                type="submit"
                disabled={configureInboxRulesSaving || !String(newSenderRuleValue || "").trim()}
                className="shrink-0"
              >
                Add
              </Button>
            </form>

            {configureInboxError ? (
              <p className="text-xs text-red-600">{configureInboxError}</p>
            ) : null}

            <div className="max-h-[260px] overflow-y-auto rounded-md border border-border">
              {configureInboxRulesLoading ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <p className="text-sm">Loading…</p>
                </div>
              ) : configureInboxRules.length ? (
                <div className="divide-y divide-border">
                  {configureInboxRules.map((rule) => (
                    <div
                      key={rule.id}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 transition-opacity duration-150",
                        !rule.is_active && "opacity-50"
                      )}
                    >
                      <span className={cn(
                        "inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-[11px] font-medium",
                        rule.matcher_type === "domain"
                          ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                          : "bg-muted text-muted-foreground"
                      )}>
                        {rule.matcher_type === "domain" ? "Domain" : "Email"}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-sm">
                        {rule.matcher_value}
                      </span>
                      <Switch
                        checked={Boolean(rule.is_active)}
                        disabled={configureInboxRulesSaving}
                        onCheckedChange={(checked) => {
                          handleToggleSenderRuleForInbox(rule, checked).catch(() => null)
                        }}
                      />
                      <button
                        type="button"
                        disabled={configureInboxRulesSaving}
                        onClick={() => handleDeleteSenderRuleForInbox(rule).catch(() => null)}
                        className="rounded p-1 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-red-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-muted-foreground">
                  <MailIcon className="h-5 w-5 opacity-30" />
                  <p className="text-sm">No rules yet</p>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            {!configureInboxTarget?.builtin && (
              <Button
                type="button"
                variant="destructive"
                disabled={configureInboxRulesSaving}
                onClick={() => {
                  setDeleteInboxTarget(configureInboxTarget || null)
                  setDeleteInboxError("")
                  setDeleteInboxOpen(true)
                  setConfigureInboxOpen(false)
                }}
              >
                Delete inbox
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => setConfigureInboxOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sidebar>
  )
}
