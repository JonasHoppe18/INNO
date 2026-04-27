"use client"

import { useEffect, useState, useTransition } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  BarChart2Icon,
  BookOpenIcon,
  BotIcon,
  CableIcon,
  CheckCircle2,
  HelpCircleIcon,
  Inbox,
  LayoutDashboardIcon,
  MailIcon,
  Bell,
  Plus,
  Settings2,
  SlidersHorizontal,
  TagIcon,
  Trash2,
  User,
  UserRoundPenIcon,
} from "lucide-react"

import { NavAgent } from "@/components/nav-agent"
import { NavMain } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"
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
  SidebarGroup,
  SidebarGroupContent,
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
  navMain: [
    {
      title: "Dashboard",
      url: "/dashboard",
      icon: LayoutDashboardIcon,
    },
  ],
  navSecondary: [
    {
      title: "Integrations",
      url: "/integrations",
      icon: CableIcon,
    },
    {
      title: "Guides",
      url: "/guides",
      icon: HelpCircleIcon,
    },
  ],
  agent: [
    {
      name: "Mailboxes",
      url: "/mailboxes",
      icon: MailIcon,
    },
    {
      name: "Fine-tuning",
      url: "/fine-tuning",
      icon: SlidersHorizontal,
    },
    {
      name: "Automation",
      url: "/automation",
      icon: BotIcon,
    },
    {
      name: "Knowledge",
      url: "/knowledge",
      icon: BookOpenIcon,
    },
    {
      name: "Tags",
      url: "/tags",
      icon: TagIcon,
    },
    {
      name: "Analytics",
      url: "/analytics",
      icon: BarChart2Icon,
    },
  ],
}

function InboxSection({
  handleCreateInbox,
  handleConfigureInbox,
  handleConfigureNotifications,
  customInboxes = [],
  customInboxUnreadCounts = {},
  allTicketsUnreadCount = 0,
  assignedCount = 0,
  notificationsCount = 0,
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const { state } = useSidebar()
  const [contextMenu, setContextMenu] = useState(null)
  const view = searchParams.get("view")
  const isCollapsed = state === "collapsed"

  const isInboxPath = pathname === "/inbox" || pathname === "/inbox/tickets"
  const isAllTicketsActive = isInboxPath && !view
  const isNotificationsActive = pathname === "/inbox" && view === "notifications"
  const isAssignedActive = pathname === "/inbox" && view === "mine"
  const isResolvedActive = pathname === "/inbox" && view === "resolved"

  const navigateToView = (url) => {
    startTransition(() => router.replace(url, { scroll: false }))
  }

  useEffect(() => {
    if (!contextMenu) return undefined
    const handleClose = () => setContextMenu(null)
    window.addEventListener("click", handleClose)
    window.addEventListener("scroll", handleClose, true)
    window.addEventListener("resize", handleClose)
    return () => {
      window.removeEventListener("click", handleClose)
      window.removeEventListener("scroll", handleClose, true)
      window.removeEventListener("resize", handleClose)
    }
  }, [contextMenu])

  return (
    <SidebarGroup className="pt-0 relative">
      <div className="mb-1 flex items-center justify-between px-2 group-data-[collapsible=icon]:hidden">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          INBOXES
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            handleCreateInbox()
          }}
          className="cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-accent"
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="sr-only">Create inbox</span>
        </button>
      </div>

      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="All Tickets"
              onClick={() => navigateToView("/inbox")}
              className={cn(
                "justify-start cursor-pointer",
                isAllTicketsActive && "bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground",
                isPending && !isAllTicketsActive && "opacity-60"
              )}
            >
              <Inbox className="h-4 w-4 shrink-0" />
              <span>All Tickets</span>
              {allTicketsUnreadCount > 0 ? (
                <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded px-1.5 text-xs font-semibold leading-none text-muted-foreground tabular-nums">
                  {allTicketsUnreadCount > 99 ? "99+" : allTicketsUnreadCount}
                </span>
              ) : null}
            </SidebarMenuButton>
          </SidebarMenuItem>

          {!isCollapsed && (
            <>
              <SidebarMenuItem>
                <div
                  className={cn(
                    "group flex items-center rounded-md px-2 py-1.5 pl-8 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    isNotificationsActive && "bg-accent text-accent-foreground",
                    isPending && !isNotificationsActive && "opacity-60"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => navigateToView("/inbox?view=notifications")}
                    className="flex min-w-0 flex-1 items-center gap-2 cursor-pointer text-inherit"
                  >
                    <Bell className="h-4 w-4 shrink-0" />
                    <span>Notifications</span>
                    {notificationsCount > 0 ? (
                      <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded px-1.5 text-xs font-semibold leading-none text-muted-foreground tabular-nums">
                        {notificationsCount > 99 ? "99+" : notificationsCount}
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleConfigureNotifications?.() }}
                    className="ml-1 flex-shrink-0 rounded p-1 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity duration-150"
                    title="Configure Notifications"
                  >
                    <Settings2 className="h-3 w-3" />
                  </button>
                </div>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="Assigned to me"
                  onClick={() => navigateToView("/inbox?view=mine")}
                  className={cn(
                    "justify-start pl-8 cursor-pointer",
                    isAssignedActive && "bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground",
                    isPending && !isAssignedActive && "opacity-60"
                  )}
                >
                  <User className="h-4 w-4 shrink-0" />
                  <span>Assigned to me</span>
                  {assignedCount > 0 ? (
                    <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded px-1.5 text-xs font-semibold leading-none text-muted-foreground tabular-nums">
                      {assignedCount > 99 ? "99+" : assignedCount}
                    </span>
                  ) : null}
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="Resolved"
                  onClick={() => navigateToView("/inbox?view=resolved")}
                  className={cn(
                    "justify-start pl-8 cursor-pointer",
                    isResolvedActive && "bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground",
                    isPending && !isResolvedActive && "opacity-60"
                  )}
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>Resolved</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {customInboxes.map((inbox) => {
                const slug = String(inbox?.slug || "")
                if (!slug) return null
                const isActive = pathname === "/inbox" && view === `inbox:${slug}`
                const unreadCount = Number(customInboxUnreadCounts?.[slug] || 0)
                const inboxUrl = `/inbox?view=${encodeURIComponent(`inbox:${slug}`)}`
                return (
                  <SidebarMenuItem key={slug}>
                    <div
                      className={cn(
                        "group flex items-center gap-1 rounded-md px-2 py-1.5 pl-8 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                        isActive && "bg-accent text-accent-foreground",
                        isPending && !isActive && "opacity-60"
                      )}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        setContextMenu({
                          inbox,
                          x: event.clientX,
                          y: event.clientY,
                        })
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => navigateToView(inboxUrl)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-inherit cursor-pointer"
                      >
                        <Inbox className="h-4 w-4 shrink-0" />
                        <span className="truncate">{inbox?.name || slug}</span>
                        {unreadCount > 0 ? (
                          <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded px-1.5 text-xs font-semibold leading-none text-muted-foreground tabular-nums">
                            {unreadCount > 99 ? "99+" : unreadCount}
                          </span>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleConfigureInbox?.(inbox) }}
                        className="ml-1 flex-shrink-0 rounded p-1 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity duration-150"
                        title="Configure inbox"
                      >
                        <Settings2 className="h-3 w-3" />
                      </button>
                    </div>
                  </SidebarMenuItem>
                )
              })}
            </>
          )}
        </SidebarMenu>
      </SidebarGroupContent>
      {contextMenu ? (
        <div
          className="fixed z-50 min-w-[170px] rounded-md border border-border bg-popover p-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            onClick={() => {
              handleConfigureInbox?.(contextMenu.inbox)
              setContextMenu(null)
            }}
            className="flex w-full items-center rounded px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
          >
            Configure inbox
          </button>
        </div>
      ) : null}
    </SidebarGroup>
  )
}

export function AppSidebar({
  user,
  className,
  ...props
}) {
  const router = useRouter()
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
  const [allTicketsUnreadCount, setAllTicketsUnreadCount] = useState(0)
  const [assignedCount, setAssignedCount] = useState(0)
  const [notificationsCount, setNotificationsCount] = useState(0)
  const [customInboxUnreadCounts, setCustomInboxUnreadCounts] = useState({})
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
      const [unreadRes, sidebarRes] = await Promise.all([
        fetch("/api/inbox/unread-count", { method: "GET", cache: "no-store", credentials: "include" }).catch(() => null),
        fetch("/api/inbox/sidebar-counts", { method: "GET", cache: "no-store", credentials: "include" }).catch(() => null),
      ])
      if (!active) return
      if (unreadRes?.ok) {
        const payload = await unreadRes.json().catch(() => ({}))
        if (active) setAllTicketsUnreadCount(Number(payload?.unreadCount ?? 0))
      }
      if (sidebarRes?.ok) {
        const payload = await sidebarRes.json().catch(() => ({}))
        if (active) {
          setAssignedCount(Number(payload?.assignedCount ?? 0))
          setNotificationsCount(Number(payload?.notificationsCount ?? 0))
          setCustomInboxUnreadCounts(
            payload?.customInboxUnreadCounts && typeof payload.customInboxUnreadCounts === "object"
              ? payload.customInboxUnreadCounts
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

  return (
    <Sidebar
      collapsible="icon"
      className={cn("[&_a]:text-inherit [&_a]:no-underline", className)}
      {...props}
    >
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip="Sona AI"
              className="data-[slot=sidebar-menu-button]:!p-1.5 group-data-[collapsible=icon]:justify-center"
            >
              <a href="#" className="flex items-center gap-2 text-inherit no-underline">
                <SonaLogo size={22} className="h-[22px] w-[22px] shrink-0" />
                <span className="text-base font-semibold group-data-[collapsible=icon]:hidden">Sona AI</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <InboxSection
          handleCreateInbox={handleOpenCreateInbox}
          customInboxes={customInboxes}
          customInboxUnreadCounts={customInboxUnreadCounts}
          handleConfigureInbox={handleConfigureInbox}
          handleConfigureNotifications={handleConfigureNotifications}
          allTicketsUnreadCount={allTicketsUnreadCount}
          assignedCount={assignedCount}
          notificationsCount={notificationsCount}
        />
        <NavAgent items={data.agent} />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
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
