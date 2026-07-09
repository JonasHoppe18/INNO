"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import {
  ChevronDown,
  ChevronRight,
  Inbox,
  Plus,
  Settings2,
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
import {
  THREAD_DRAG_MIME,
  dispatchThreadMove,
} from "@/lib/inbox/thread-drag-bridge"

// Task 11, Plan 2: TICKETS / INBOXES sidebar sections. Replaces the old
// single INBOXES block in app-sidebar.jsx. Links target `/inbox?view=...`
// per the routing scheme owned by useThreadFilters.js (Task 6, Plan 1):
// needs_attention (default, param omitted), mine, waiting, resolved,
// automated, all, inbox:<slug>.
//
// Spam (classification_key = "notification") sits at the bottom of INBOXES,
// after any custom inboxes, using the same Inbox icon as every custom
// inbox row — it's effectively just another routing bucket from the
// sidebar's point of view, not a lifecycle state like the TICKETS rows
// above it. Always a flat, always-visible row (not a collapsed section),
// per direct feedback that a collapsed-by-default AUTOMATED group made it
// feel hidden/hard to find.
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
        "ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded px-1.5 text-xs font-normal leading-none tabular-nums transition-opacity duration-150",
        muted ? "text-muted-foreground" : "bg-muted text-foreground",
        fadeOnHover && "group-hover/inbox:opacity-0"
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  )
}

function QueueRow({ icon: Icon, label, href, active, count, muted, pl, dropProps, isDropActive, isDropPulse, hideIcon }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        tooltip={label}
        className={cn(
          "justify-start cursor-pointer text-foreground",
          pl,
          active && "bg-accent text-foreground hover:bg-accent hover:text-foreground",
          isDropActive && "bg-primary/10 ring-2 ring-inset ring-primary text-foreground",
          isDropPulse && "animate-inbox-drop"
        )}
      >
        {/* No text-inherit here: with asChild this Link IS the button, so
            text-inherit would inherit the sidebar root's --sidebar-foreground
            and beat the button's own text color (Radix Slot concatenates
            classes without tailwind-merge). Dropping it lets the button's
            text-foreground apply, so every sidebar row renders the same
            solid color. */}
        <Link
          href={href}
          className="flex w-full items-center gap-2 no-underline"
          {...dropProps}
        >
          {hideIcon ? null : <Icon className="h-4 w-4 shrink-0" />}
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
  // Inbox is a collapsible parent; Assigned to me / Waiting / Resolved nest
  // under it (iconless, indented). Default expanded.
  const [ticketsOpen, setTicketsOpen] = useState(true)
  // Which drop target (if any) a dragged ticket is currently hovering. Keys:
  // "inbox" | "spam" | `inbox:${slug}`. See makeDropProps below.
  const [dragOverKey, setDragOverKey] = useState(null)
  // The row a ticket was JUST dropped on — briefly pulses to confirm the
  // ticket landed there (the "flew to the folder" Outlook feedback), cleared
  // after the pulse. Distinct from dragOverKey, which clears the instant the
  // drop happens.
  const [justDroppedKey, setJustDroppedKey] = useState(null)
  const dropPulseTimerRef = useRef(null)
  useEffect(() => () => clearTimeout(dropPulseTimerRef.current), [])

  // Wires a sidebar row as a ticket drop target. destination:
  // { inboxSlug, classificationKey } handed straight to the InboxSplitView
  // move handler (via the drag bridge).
  //
  // preventDefault() runs UNCONDITIONALLY on both dragEnter and dragOver:
  // the HTML5 spec requires cancelling BOTH for an element to count as a
  // valid drop zone, and gating that on a dataTransfer.types check is
  // unreliable mid-drag (some browsers withhold custom types during
  // dragover), which silently kills the drop. So the row is always a valid
  // zone; the MIME check only decides the *highlight* and dropEffect, and
  // the actual move only fires when a real threadId is present on drop — so
  // dropping a file/text here is a harmless no-op, never a broken move.
  // dragLeave only clears when the pointer truly leaves the row (not when
  // crossing between its child icon/label/badge).
  const makeDropProps = useCallback(
    (key, destination) => {
      const carriesThread = (event) =>
        Array.from(event.dataTransfer?.types || []).includes(THREAD_DRAG_MIME)
      return {
        onDragEnter: (event) => {
          event.preventDefault()
          if (carriesThread(event)) setDragOverKey(key)
        },
        onDragOver: (event) => {
          event.preventDefault()
          if (carriesThread(event)) event.dataTransfer.dropEffect = "move"
        },
        onDragLeave: (event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setDragOverKey((current) => (current === key ? null : current))
          }
        },
        onDrop: (event) => {
          event.preventDefault()
          const threadId = event.dataTransfer.getData(THREAD_DRAG_MIME)
          setDragOverKey(null)
          if (!threadId) return
          dispatchThreadMove(threadId, destination)
          setJustDroppedKey(key)
          clearTimeout(dropPulseTimerRef.current)
          dropPulseTimerRef.current = setTimeout(() => setJustDroppedKey(null), 600)
        },
      }
    },
    [],
  )

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
            {/* Inbox parent. Collapsed (icon) sidebar: fall back to the plain
                QueueRow/SidebarMenuButton, which handles icon-only mode (our
                custom chevron row below is a bare div that would leak the
                label). Expanded: icon+label in the standard row position (flush
                with Dashboard etc.) + a trailing chevron on the RIGHT that
                toggles the nested lifecycle rows without navigating. Both link
                to /inbox and are drop targets. */}
            {isCollapsed ? (
              <QueueRow
                icon={Inbox}
                label="Inbox"
                href="/inbox"
                active={activeView === ""}
                count={needsAttentionCount}
                isDropActive={dragOverKey === "inbox"}
                isDropPulse={justDroppedKey === "inbox"}
                dropProps={makeDropProps("inbox", {
                  kind: "inbox",
                  inboxSlug: null,
                  classificationKey: "support",
                })}
              />
            ) : (
              <SidebarMenuItem>
                <div
                  className={cn(
                    "group relative flex items-center rounded-md text-sm text-foreground hover:bg-accent hover:text-foreground",
                    activeView === "" && "bg-accent text-foreground",
                    dragOverKey === "inbox" &&
                      "bg-primary/10 ring-2 ring-inset ring-primary text-foreground",
                    justDroppedKey === "inbox" && "animate-inbox-drop"
                  )}
                  {...makeDropProps("inbox", {
                    kind: "inbox",
                    inboxSlug: null,
                    classificationKey: "support",
                  })}
                >
                  <Link
                    href="/inbox"
                    className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 pr-8 no-underline"
                  >
                    <Inbox className="h-4 w-4 shrink-0" />
                    <span>Inbox</span>
                    <CountBadge count={needsAttentionCount} />
                  </Link>
                  {/* Absolutely positioned (out of flex flow), at the same
                      right-inset every other row's trailing icon uses — so
                      the count badge above (ml-auto within the Link, which
                      reserves pr-8 for this) lands in the same column as
                      every INBOXES row's count, instead of sitting to the
                      left of a flex-sibling chevron. Unlike those rows'
                      hover-only configure icon, this stays always visible:
                      collapsing Inbox is a persistent action, not a hover
                      affordance. */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setTicketsOpen((open) => !open)
                    }}
                    className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                    aria-label={ticketsOpen ? "Collapse" : "Expand"}
                  >
                    {ticketsOpen ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </SidebarMenuItem>
            )}
            {!isCollapsed && ticketsOpen && (
              <>
                <QueueRow
                  hideIcon
                  pl="pl-8"
                  label="Assigned to me"
                  href="/inbox?view=mine"
                  active={isViewActive("mine")}
                  count={mineCount}
                  isDropActive={dragOverKey === "mine"}
                  isDropPulse={justDroppedKey === "mine"}
                  dropProps={makeDropProps("mine", {
                    kind: "assign",
                    assigneeId: "__me__",
                  })}
                />
                <QueueRow
                  hideIcon
                  pl="pl-8"
                  label="Waiting on customer"
                  href="/inbox?view=waiting_customer"
                  active={isViewActive("waiting_customer")}
                  count={waitingCustomerCount}
                  muted
                  isDropActive={dragOverKey === "waiting_customer"}
                  isDropPulse={justDroppedKey === "waiting_customer"}
                  dropProps={makeDropProps("waiting_customer", {
                    kind: "status",
                    status: "waiting_customer",
                    waitingReason: "customer",
                  })}
                />
                <QueueRow
                  hideIcon
                  pl="pl-8"
                  label="Waiting on third party"
                  href="/inbox?view=waiting_third_party"
                  active={isViewActive("waiting_third_party")}
                  count={waitingThirdPartyCount}
                  muted
                  isDropActive={dragOverKey === "waiting_third_party"}
                  isDropPulse={justDroppedKey === "waiting_third_party"}
                  dropProps={makeDropProps("waiting_third_party", {
                    kind: "status",
                    status: "waiting_third_party",
                    waitingReason: "third_party",
                  })}
                />
                <QueueRow
                  hideIcon
                  pl="pl-8"
                  label="Resolved"
                  href="/inbox?view=resolved"
                  active={isViewActive("resolved")}
                  isDropActive={dragOverKey === "resolved"}
                  isDropPulse={justDroppedKey === "resolved"}
                  dropProps={makeDropProps("resolved", {
                    kind: "status",
                    status: "resolved",
                  })}
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
                const dropKey = `inbox:${slug}`
                return (
                  <SidebarMenuItem key={slug}>
                    <div
                      className={cn(
                        "group/inbox relative flex items-center rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-accent hover:text-foreground",
                        active && "bg-accent text-foreground",
                        dragOverKey === dropKey &&
                          "bg-primary/10 ring-2 ring-inset ring-primary text-foreground",
                        justDroppedKey === dropKey && "animate-inbox-drop"
                      )}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        setContextMenu({ inbox, x: event.clientX, y: event.clientY })
                      }}
                      {...makeDropProps(dropKey, {
                        inboxSlug: slug,
                        classificationKey: "support",
                      })}
                    >
                      <Link
                        href={href}
                        className="flex min-w-0 flex-1 items-center gap-2 pr-8 no-underline"
                      >
                        <Inbox className="h-4 w-4 shrink-0" />
                        <span className="truncate">{inbox?.name || slug}</span>
                        <CountBadge count={count} fadeOnHover />
                      </Link>
                      {/* Absolutely positioned (out of flex flow), at the same
                          right-inset the Inbox row's chevron uses — the Link
                          above reserves pr-8 for it, so the count badge lands
                          in the same column as every other row's count.
                          Swaps in over the count on hover instead of staying
                          always visible, unlike Inbox's chevron. */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onConfigureInbox?.(inbox)
                        }}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 opacity-0 group-hover/inbox:opacity-100 text-muted-foreground hover:text-foreground transition-opacity duration-150"
                        title="Configure inbox"
                      >
                        <Settings2 className="h-3 w-3" />
                      </button>
                    </div>
                  </SidebarMenuItem>
                )
              })}
              <SidebarMenuItem>
                <div
                  className={cn(
                    "group/inbox relative flex items-center rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-accent hover:text-foreground",
                    isViewActive("automated") && "bg-accent text-foreground",
                    dragOverKey === "spam" &&
                      "bg-primary/10 ring-2 ring-inset ring-primary text-foreground",
                    justDroppedKey === "spam" && "animate-inbox-drop"
                  )}
                  {...makeDropProps("spam", {
                    inboxSlug: null,
                    classificationKey: "notification",
                  })}
                >
                  <Link
                    href="/inbox?view=automated"
                    className="flex min-w-0 flex-1 items-center gap-2 pr-8 no-underline"
                  >
                    <Inbox className="h-4 w-4 shrink-0" />
                    <span>Spam</span>
                    <CountBadge count={notificationsCount} fadeOnHover />
                  </Link>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onConfigureNotifications?.()
                    }}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 opacity-0 group-hover/inbox:opacity-100 text-muted-foreground hover:text-foreground transition-opacity duration-150"
                    title="Configure Spam"
                  >
                    <Settings2 className="h-3 w-3" />
                  </button>
                </div>
              </SidebarMenuItem>
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
