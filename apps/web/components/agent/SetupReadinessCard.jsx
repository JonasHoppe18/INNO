"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { CheckCircle2, AlertCircle, ChevronDown, ChevronUp } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const levelConfig = {
  needs_setup: { label: "Setup required", color: "text-rose-700", bar: "bg-rose-500", badge: "border-rose-200 bg-rose-50 text-rose-700" },
  getting_started: { label: "Getting started", color: "text-amber-700", bar: "bg-amber-500", badge: "border-amber-200 bg-amber-50 text-amber-700" },
  good: { label: "Good setup", color: "text-amber-700", bar: "bg-amber-400", badge: "border-amber-200 bg-amber-50 text-amber-700" },
  ready: { label: "Ready for 10/10", color: "text-emerald-700", bar: "bg-emerald-500", badge: "border-emerald-200 bg-emerald-50 text-emerald-700" },
}

export function SetupReadinessCard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    fetch("/api/settings/readiness")
      .then((r) => r.json())
      .then((json) => {
        if (!json.error) setData(json)
      })
      .catch(() => null)
      .finally(() => setLoading(false))
  }, [])

  if (loading || !data) return null

  const isReady = data.level === "ready"
  const config = levelConfig[data.level] || levelConfig.good
  const missingItems = data.items.filter((item) => !item.done)
  const showExpanded = expanded || !isReady

  // Collapsed ready state
  if (isReady && !expanded) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-emerald-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Ready for 10/10 — all setup steps completed
        </div>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-xs text-emerald-600 hover:underline"
        >
          Show details
        </button>
      </div>
    )
  }

  return (
    <Card className={cn(
      "border",
      data.level === "needs_setup" && "border-rose-200",
      data.level === "getting_started" && "border-amber-200",
      data.level === "good" && "border-amber-100",
      data.level === "ready" && "border-emerald-200",
    )}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-slate-700">
            Setup quality
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={cn("text-xs", config.badge)}
            >
              {data.score} / {data.max}
            </Badge>
            {isReady && (
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <ChevronUp className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={cn("h-full rounded-full transition-all duration-500", config.bar)}
            style={{ width: `${data.pct}%` }}
          />
        </div>
        <p className={cn("text-xs mt-1", config.color)}>
          {config.label} — {data.pct}% configured
        </p>
      </CardHeader>

      <CardContent className="pt-0">
        <ul className="space-y-2">
          {data.items.map((item) => (
            <li key={item.key} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {item.done ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                ) : (
                  <AlertCircle className="h-4 w-4 shrink-0 text-slate-300" />
                )}
                <span className={cn(
                  "text-sm",
                  item.done ? "text-slate-500" : "text-slate-700 font-medium"
                )}>
                  {item.label}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!item.done && (
                  <Link
                    href={item.action_url}
                    className="text-xs text-slate-500 hover:text-slate-700 hover:underline"
                  >
                    Add →
                  </Link>
                )}
                <span className={cn(
                  "text-xs tabular-nums",
                  item.done ? "text-emerald-600" : "text-slate-400"
                )}>
                  +{item.points}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
