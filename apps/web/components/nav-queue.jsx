"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import {
  Ban,
  CheckCircle2,
  Clock,
  Inbox,
  Package,
  Plus,
  Settings2,
  User,
} from "lucide-react"

import { cn } from "@/lib/utils"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"

// Task 11, Plan 2: TICKETS / INBOXES sidebar sections. Replaces the old
// single INBOXES block in app-sidebar.jsx. Links target `/inbox?view=...`
// per the routing scheme owned by useThreadFilters.js (Task 6, Plan 1):
// needs_attention (default, param omitted), mine, waiting, resolved,
// automated, all, inbox:<slug>.
//
// Spam (classification_key = "notification") sits at the bottom of TICKETS,
// right after Resolved — both are "done, no action needed" terminal states,
// whereas INBOXES below is purely user-created routing buckets (Lager etc.).
// Always a flat, always-visible row (not a collapsed section), per direct
// feedback that a collapsed-by-default AUTOMATED group made it feel
// hidden/hard to find.
//
// Count semantics (per brief): needs-attention-style counts render as today's
// badge; Waiting renders muted (text-muted-foreground, matching this file's
// existing muted-badge convention — see CountBadge below); Resolved never
// shows a count.
function CountBadge({ count, muted = false, fadeOnHover = false }) {
  if (!(count > 0)) return null
  return (
    <span
      className={cn(
        "ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded px-1.5 text-xs font-semibold leading-none tabular-nums transition-opacity duration-150",
        muted ? "text-muted-foreground" : "bg-muted text-foreground",
        fadeOnHover && "group-hover:opacity-0"
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
  const [contextMenu, setContextMenu] = useState(null)

  const needsAttentionCount = Number(counts?.needsAttentionCount ?? 0)
  const mineCount = Number(counts?.mineCount ?? 0)
  const waitingCustomerCount = Number(counts?.waitingCustomerCount ?? 0)
  const waitingThirdPartyCount = Number(counts?.waitingThirdPartyCount ?? 0)
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
            Tickets
          </span>
        </div>
        <SidebarGroupContent>
          <SidebarMenu>
            <QueueRow
              icon={Inbox}
              label="Inbox"
              href="/inbox"
              active={activeView === ""}
              count={needsAttentionCount}
            />
            {!isCollapsed && (
              <>
                <QueueRow
                  icon={User}
                  label="Assigned to me"
                  href="/inbox?view=mine"
                  active={isViewActive("mine")}
                  count={mineCount}
                />
                <QueueRow
                  icon={Clock}
                  label="Waiting on customer"
                  href="/inbox?view=waiting_customer"
                  active={isViewActive("waiting_customer")}
                  count={waitingCustomerCount}
                  muted
                />
                <QueueRow
                  icon={Package}
                  label="Waiting on third party"
                  href="/inbox?view=waiting_third_party"
                  active={isViewActive("waiting_third_party")}
                  count={waitingThirdPartyCount}
                  muted
                />
                <QueueRow
                  icon={CheckCircle2}
                  label="Resolved"
                  href="/inbox?view=resolved"
                  active={isViewActive("resolved")}
                />
                <SidebarMenuItem>
                  <div
                    className={cn(
                      "group relative flex items-center rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                      isViewActive("automated") && "bg-accent text-accent-foreground"
                    )}
                  >
                    <Link
                      href="/inbox?view=automated"
                      className="flex min-w-0 flex-1 items-center gap-2 text-inherit no-underline"
                    >
                      <Ban className="h-4 w-4 shrink-0" />
                      <span>Spam</span>
                      <CountBadge count={notificationsCount} fadeOnHover />
                    </Link>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onConfigureNotifications?.()
                      }}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity duration-150"
                      title="Configure Spam"
                    >
                      <Settings2 className="h-3 w-3" />
                    </button>
                  </div>
                </SidebarMenuItem>
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
                        "group relative flex items-center rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground",
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
                        <CountBadge count={count} fadeOnHover />
                      </Link>
                      {/* Absolutely positioned (out of flex flow) so it never
                          reserves layout width — otherwise the count above
                          would sit closer in than every TICKETS row's count,
                          since those rows have no trailing icon to make room
                          for. Swaps in over the count on hover instead. */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onConfigureInbox?.(inbox)
                        }}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity duration-150"
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
            className="fixed z-50 min-w-[170px] origin-top-left rounded-md border border-border bg-popover p-1 shadow-lg animate-context-menu-enter"
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
    </>
  )
}
