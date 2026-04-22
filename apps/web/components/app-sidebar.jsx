"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import {
  BarChart2Icon,
  BookOpenIcon,
  BotIcon,
  CableIcon,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  HelpCircleIcon,
  Inbox,
  LayoutDashboardIcon,
  MailIcon,
  Bell,
  Plus,
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
  isInboxOpen,
  setIsInboxOpen,
  handleCreateInbox,
  handleDeleteInbox,
  customInboxes = [],
  allTicketsUnreadCount = 0,
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { state } = useSidebar()
  const view = searchParams.get("view")
  const isCollapsed = state === "collapsed"

  const isInboxPath = pathname === "/inbox" || pathname === "/inbox/tickets"
  const isAllTicketsActive = isInboxPath && !view
  const isNotificationsActive = pathname === "/inbox" && view === "notifications"
  const isAssignedActive = pathname === "/inbox" && view === "mine"
  const isResolvedActive = pathname === "/inbox" && view === "resolved"

  return (
    <SidebarGroup className="pt-0">
      <div className="mb-1 flex items-center justify-between px-2 group-data-[collapsible=icon]:hidden">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
          INBOXES
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            handleCreateInbox()
          }}
          className="cursor-pointer rounded p-0.5 text-slate-600 hover:bg-slate-200"
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
              className={cn(
                "justify-start",
                isAllTicketsActive && "bg-slate-100 text-slate-900 hover:bg-slate-100 hover:text-slate-900"
              )}
            >
              <>
                <Link href="/inbox" className="flex min-w-0 flex-1 items-center gap-2 text-inherit no-underline">
                  <Inbox className="h-4 w-4 shrink-0" />
                  <span>All Tickets</span>
                  {allTicketsUnreadCount > 0 ? (
                    <span className="ml-auto inline-flex h-7 min-w-7 items-center justify-center rounded-md bg-slate-100 px-2 text-xs font-semibold leading-none text-slate-600 tabular-nums">
                      {allTicketsUnreadCount > 99 ? "99+" : allTicketsUnreadCount}
                    </span>
                  ) : null}
                </Link>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setIsInboxOpen((prev) => !prev)
                  }}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setIsInboxOpen((prev) => !prev)}
                  className="ml-1 rounded p-0.5 hover:bg-slate-200 group-data-[collapsible=icon]:hidden cursor-pointer"
                >
                  {isInboxOpen ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                  <span className="sr-only">Toggle inbox filters</span>
                </div>
              </>
            </SidebarMenuButton>
          </SidebarMenuItem>

          {isInboxOpen && !isCollapsed ? (
            <>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  tooltip="Notifications"
                  className={cn(
                    "justify-start pl-8",
                    isNotificationsActive && "bg-slate-100 text-slate-900 hover:bg-slate-100 hover:text-slate-900"
                  )}
                >
                  <Link href="/inbox?view=notifications" className="flex w-full items-center gap-2 text-inherit no-underline">
                    <Bell className="h-4 w-4 shrink-0" />
                    <span>Notifications</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  tooltip="Assigned to me"
                  className={cn(
                    "justify-start pl-8",
                    isAssignedActive && "bg-slate-100 text-slate-900 hover:bg-slate-100 hover:text-slate-900"
                  )}
                >
                  <Link href="/inbox?view=mine" className="flex w-full items-center gap-2 text-inherit no-underline">
                    <User className="h-4 w-4 shrink-0" />
                    <span>Assigned to me</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  tooltip="Resolved"
                  className={cn(
                    "justify-start pl-8",
                    isResolvedActive && "bg-slate-100 text-slate-900 hover:bg-slate-100 hover:text-slate-900"
                  )}
                >
                  <Link href="/inbox?view=resolved" className="flex w-full items-center gap-2 text-inherit no-underline">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span>Resolved</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {customInboxes.map((inbox) => {
                const slug = String(inbox?.slug || "")
                if (!slug) return null
                const isActive = pathname === "/inbox" && view === `inbox:${slug}`
                return (
                  <SidebarMenuItem key={slug}>
                    <div
                      className={cn(
                        "group flex items-center gap-1 rounded-md px-2 py-1.5 pl-8 text-sm text-slate-600 hover:bg-slate-100",
                        isActive && "bg-slate-100 text-slate-900"
                      )}
                    >
                      <Link
                        href={`/inbox?view=${encodeURIComponent(`inbox:${slug}`)}`}
                        className="flex min-w-0 flex-1 items-center gap-2 text-inherit no-underline"
                      >
                        <Inbox className="h-4 w-4 shrink-0" />
                        <span className="truncate">{inbox?.name || slug}</span>
                      </Link>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          handleDeleteInbox?.(inbox)
                        }}
                        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && handleDeleteInbox?.(inbox)}
                        className="opacity-0 transition-opacity group-hover:opacity-100 rounded p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-700 cursor-pointer"
                        aria-label={`Delete ${inbox?.name || slug}`}
                        title="Delete inbox"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </div>
                    </div>
                  </SidebarMenuItem>
                )
              })}
            </>
          ) : null}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

export function AppSidebar({
  user,
  className,
  ...props
}) {
  const [isInboxOpen, setIsInboxOpen] = useState(true)
  const [customInboxes, setCustomInboxes] = useState([])
  const [createInboxOpen, setCreateInboxOpen] = useState(false)
  const [createInboxName, setCreateInboxName] = useState("")
  const [createInboxError, setCreateInboxError] = useState("")
  const [isCreatingInbox, setIsCreatingInbox] = useState(false)
  const [deleteInboxOpen, setDeleteInboxOpen] = useState(false)
  const [deleteInboxTarget, setDeleteInboxTarget] = useState(null)
  const [deleteInboxError, setDeleteInboxError] = useState("")
  const [isDeletingInbox, setIsDeletingInbox] = useState(false)
  const [allTicketsUnreadCount, setAllTicketsUnreadCount] = useState(0)
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

    const loadUnreadCount = async () => {
      const response = await fetch("/api/inbox/unread-count", {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      }).catch(() => null)
      if (!active || !response?.ok) return
      const payload = await response.json().catch(() => ({}))
      if (!active) return
      const totalUnread = Number(payload?.unreadCount ?? 0)
      setAllTicketsUnreadCount(totalUnread)
    }

    loadUnreadCount().catch(() => null)
    const intervalId = setInterval(() => {
      loadUnreadCount().catch(() => null)
    }, 30_000)

    return () => {
      active = false
      clearInterval(intervalId)
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
          isInboxOpen={isInboxOpen}
          setIsInboxOpen={setIsInboxOpen}
          handleCreateInbox={handleOpenCreateInbox}
          customInboxes={customInboxes}
          handleDeleteInbox={handleOpenDeleteInbox}
          allTicketsUnreadCount={allTicketsUnreadCount}
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
    </Sidebar>
  )
}
