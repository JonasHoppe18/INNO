"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { Bell } from "lucide-react"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"

function formatTimeAgo(dateStr) {
  if (!dateStr) return ""
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(0)
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(false)

  const toMentionNotifications = useCallback((rows = []) => {
    return (Array.isArray(rows) ? rows : []).filter((item) => {
      const mentionId = String(item?.mention_id || "").trim()
      return Boolean(item?.can_mark_read && mentionId)
    })
  }, [])

  const refreshCount = useCallback(() => {
    fetch("/api/notifications", { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        const mentionNotifications = toMentionNotifications(d?.notifications ?? [])
        setCount(mentionNotifications.length)
      })
      .catch(() => null)
  }, [toMentionNotifications])

  const handleNotificationClick = (notification) => {
    const mentionId = String(notification?.mention_id || "").trim()
    const canMarkRead = Boolean(notification?.can_mark_read && mentionId)
    if (!canMarkRead) return

    setNotifications((prev) => prev.filter((item) => item.id !== notification.id))
    setCount((prev) => Math.max(0, Number(prev || 0) - 1))

    fetch("/api/notifications", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mention_id: mentionId }),
      keepalive: true,
    }).catch(() => null)
  }

  // On mount: fetch count
  useEffect(() => {
    refreshCount()
  }, [refreshCount])

  useEffect(() => {
    const onThreadRead = () => refreshCount()
    window.addEventListener("sona:thread-read", onThreadRead)
    return () => window.removeEventListener("sona:thread-read", onThreadRead)
  }, [refreshCount])

  // When popover opens: fetch notifications
  useEffect(() => {
    if (!open) return
    setLoading(true)
    // Outlook-style: clear red dot immediately when opened.
    setCount(0)
    fetch("/api/notifications", { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        const mentionNotifications = toMentionNotifications(d?.notifications ?? [])
        setNotifications(mentionNotifications)
        setLoading(false)

        const mentionIds = mentionNotifications
          .map((item) => String(item?.mention_id || "").trim())
          .filter(Boolean)
        if (!mentionIds.length) return

        fetch("/api/notifications", {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mention_ids: mentionIds }),
          keepalive: true,
        }).catch(() => null)
      })
      .catch(() => setLoading(false))
  }, [open, toMentionNotifications])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {count > 0 && (
            <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-destructive" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <p className="font-semibold text-sm mb-3">Notifications</p>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : notifications.length === 0 ? (
          <p className="text-sm text-muted-foreground">No new notifications</p>
        ) : (
          <div>
            {notifications.map(notif => (
              <Link
                key={notif.id}
                href={`/inbox?thread=${notif.thread_id || notif.id}`}
                onClick={() => handleNotificationClick(notif)}
                className="block py-2 border-b border-border last:border-0 hover:bg-accent rounded px-2 -mx-2"
              >
                <p className="text-sm font-medium truncate">{notif.title || notif.subject || "No subject"}</p>
                <p className="text-xs text-muted-foreground">
                  {notif.subtitle || notif.customer_email || "Notification"} · {formatTimeAgo(notif.updated_at)}
                </p>
              </Link>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
