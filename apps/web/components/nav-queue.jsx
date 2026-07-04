"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import {
  Bell,
  CheckCircle2,
  ChevronRight,
  Clock,
  Inbox,
  Plus,
  Settings2,
  User,
} from "lucide-react"

import { cn } from "@/lib/utils"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"

// Task 11, Plan 2: QUEUE / INBOXES / AUTOMATED sidebar sections. Replaces the
// old single INBOXES block in app-sidebar.jsx. Links target `/inbox?view=...`
// per the routing scheme owned by useThreadFilters.js (Task 6, Plan 1):
// needs_attention (default, param omitted), mine, waiting, resolved,
// automated, all, inbox:<slug>.
//
// Count semantics (per brief): needs-attention-style counts render as today's
// badge; Waiting renders muted (text-muted-foreground, matching this file's
// existing muted-badge convention — see CountBadge below); Resolved and
// AUTOMATED entries never show a count.
function CountBadge({ count, muted = false }) {
  if (!(count > 0)) return null
  return (
    <span
      className={cn(
        "ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded px-1.5 text-xs font-semibold leading-none tabular-nums",
        muted ? "text-muted-foreground" : "text-foreground"
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  )
}

function QueueRow({ icon: Icon, label, href, active, count, muted, pl }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        tooltip={label}
        className={cn(
          "justify-start cursor-pointer",
          pl,
          active && "bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground"
        )}
      >
        <Link href={href} className="flex w-full items-center gap-2 text-inherit no-underline">
          <Icon className="h-4 w-4 shrink-0" />
          <span>{label}</span>
          <CountBadge count={count} muted={muted} />
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

export function NavQueue({
  counts = {},
  inboxes = [],
  activeView = "",
  onCreateInbox,
  onConfigureInbox,
  onConfigureNotifications,
}) {
  const { state } = useSidebar()
  const isCollapsed = state === "collapsed"
  const [automatedOpen, setAutomatedOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState(null)

  const needsAttentionCount = Number(counts?.needsAttentionCount ?? 0)
  const mineCount = Number(counts?.mineCount ?? 0)
  const waitingCustomerCount = Number(counts?.waitingCustomerCount ?? 0)
  const waitingThirdPartyCount = Number(counts?.waitingThirdPartyCount ?? 0)
  const waitingCount = waitingCustomerCount + waitingThirdPartyCount
  const notificationsCount = Number(counts?.notificationsCount ?? 0)
  const inboxNeedsAttentionCounts =
    counts?.inboxNeedsAttentionCounts && typeof counts.inboxNeedsAttentionCounts === "object"
      ? counts.inboxNeedsAttentionCounts
      : {}

  const isViewActive = useCallback((view) => activeView === view, [activeView])

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
    <>
      <SidebarGroup className="pt-0">
        <div className="mb-1 px-2 group-data-[collapsible=icon]:hidden">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            QUEUE
          </span>
        </div>
        <SidebarGroupContent>
          <SidebarMenu>
            <QueueRow
              icon={Inbox}
              label="Needs attention"
              href="/inbox"
              active={!activeView}
              count={needsAttentionCount}
            />
            {!isCollapsed && (
              <>
                <QueueRow
                  icon={User}
                  label="Mine"
                  href="/inbox?view=mine"
                  active={isViewActive("mine")}
                  count={mineCount}
                  pl="pl-8"
                />
                <QueueRow
                  icon={Clock}
                  label="Waiting"
                  href="/inbox?view=waiting"
                  active={isViewActive("waiting")}
                  count={waitingCount}
                  muted
                  pl="pl-8"
                />
                <QueueRow
                  icon={CheckCircle2}
                  label="Resolved"
                  href="/inbox?view=resolved"
                  active={isViewActive("resolved")}
                  pl="pl-8"
                />
              </>
            )}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup className="pt-0 relative">
        <div className="mb-1 flex items-center justify-between px-2 group-data-[collapsible=icon]:hidden">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            INBOXES
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onCreateInbox?.()
            }}
            className="cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-accent"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="sr-only">Create inbox</span>
          </button>
        </div>
        {!isCollapsed && (
          <SidebarGroupContent>
            <SidebarMenu>
              {inboxes.map((inbox) => {
                const slug = String(inbox?.slug || "")
                if (!slug) return null
                const view = `inbox:${slug}`
                const active = isViewActive(view)
                const count = Number(inboxNeedsAttentionCounts?.[slug] || 0)
                const href = `/inbox?view=${encodeURIComponent(view)}`
                return (
                  <SidebarMenuItem key={slug}>
                    <div
                      className={cn(
                        "group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                        active && "bg-accent text-accent-foreground"
                      )}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        setContextMenu({ inbox, x: event.clientX, y: event.clientY })
                      }}
                    >
                      <Link
                        href={href}
                        className="flex min-w-0 flex-1 items-center gap-2 text-inherit no-underline"
                      >
                        <Inbox className="h-4 w-4 shrink-0" />
                        <span className="truncate">{inbox?.name || slug}</span>
                        <CountBadge count={count} />
                      </Link>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onConfigureInbox?.(inbox)
                        }}
                        className="ml-1 flex-shrink-0 rounded p-1 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity duration-150"
                        title="Configure inbox"
                      >
                        <Settings2 className="h-3 w-3" />
                      </button>
                    </div>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        )}
        {contextMenu ? (
          <div
            className="fixed z-50 min-w-[170px] rounded-md border border-border bg-popover p-1 shadow-lg"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              type="button"
              onClick={() => {
                onConfigureInbox?.(contextMenu.inbox)
                setContextMenu(null)
              }}
              className="flex w-full items-center rounded px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
            >
              Configure inbox
            </button>
          </div>
        ) : null}
      </SidebarGroup>

      <SidebarGroup className="pt-0">
        <Collapsible open={automatedOpen} onOpenChange={setAutomatedOpen}>
          <div className="mb-1 flex items-center px-2 group-data-[collapsible=icon]:hidden">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex flex-1 cursor-pointer items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
              >
                <ChevronRight
                  className={cn(
                    "h-3 w-3 shrink-0 transition-transform duration-150",
                    automatedOpen && "rotate-90"
                  )}
                />
                <span>AUTOMATED</span>
              </button>
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <div
                    className={cn(
                      "group flex items-center rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                      isViewActive("automated") && "bg-accent text-accent-foreground"
                    )}
                  >
                    <Link
                      href="/inbox?view=automated"
                      className="flex min-w-0 flex-1 items-center gap-2 text-inherit no-underline"
                    >
                      <Bell className="h-4 w-4 shrink-0" />
                      <span>Notifications</span>
                      <CountBadge count={notificationsCount} />
                    </Link>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onConfigureNotifications?.()
                      }}
                      className="ml-1 flex-shrink-0 rounded p-1 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity duration-150"
                      title="Configure Notifications"
                    >
                      <Settings2 className="h-3 w-3" />
                    </button>
                  </div>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </CollapsibleContent>
        </Collapsible>
      </SidebarGroup>
    </>
  )
}
