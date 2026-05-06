"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Sparkles, CircleDot, Clock, HelpCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const READINESS_CONFIG = {
  ready: {
    label: "Ready",
    color: "text-emerald-700",
    bg: "bg-emerald-50 border-emerald-100",
    dot: "bg-emerald-500",
    Icon: CircleDot,
  },
  learning: {
    label: "Learning",
    color: "text-amber-700",
    bg: "bg-amber-50 border-amber-100",
    dot: "bg-amber-400",
    Icon: Clock,
  },
  insufficient_data: {
    label: "Not enough data",
    color: "text-slate-500",
    bg: "bg-slate-50 border-slate-100",
    dot: "bg-slate-300",
    Icon: HelpCircle,
  },
  not_ready: {
    label: "Needs improvement",
    color: "text-red-600",
    bg: "bg-red-50 border-red-100",
    dot: "bg-red-400",
    Icon: CircleDot,
  },
};

function ConfidenceBar({ value }) {
  if (value === null) return <div className="h-1.5 w-full rounded-full bg-slate-100" />;
  const pct = Math.round(value * 100);
  const color = value >= 0.78 ? "bg-emerald-500" : value >= 0.65 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="h-1.5 w-full rounded-full bg-slate-100">
      <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

function CategoryRow({ category, onToggle, disabled }) {
  const cfg = READINESS_CONFIG[category.readiness];
  const canEnable = category.readiness === "ready";
  const pct = category.avg_confidence !== null ? Math.round(category.avg_confidence * 100) : null;

  return (
    <div className="px-4 py-4 md:px-5">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-6">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-slate-900">{category.label}</span>
            {category.sona_recommends && (
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 border border-violet-100">
                <Sparkles className="h-2.5 w-2.5" />
                Sona recommends
              </span>
            )}
            <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border", cfg.bg, cfg.color)}>
              <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />
              {cfg.label}
            </span>
          </div>
          <div className="space-y-1">
            <ConfidenceBar value={category.avg_confidence} />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-400">
                {pct !== null ? `${pct}% avg quality` : "No data yet"}
                {category.ticket_count > 0 && ` · ${category.ticket_count} ticket${category.ticket_count !== 1 ? "s" : ""}`}
              </span>
              {!canEnable && category.readiness !== "insufficient_data" && (
                <span className="text-[11px] text-slate-400">
                  {category.readiness === "learning" ? "Needs more consistency" : "Quality too low"}
                </span>
              )}
              {category.readiness === "insufficient_data" && (
                <span className="text-[11px] text-slate-400">Process more tickets to unlock</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-start justify-start sm:justify-end sm:pl-4 pt-0.5">
          <Switch
            checked={category.auto_send_enabled}
            onCheckedChange={(checked) => onToggle(category.intent, checked)}
            disabled={disabled || !canEnable}
            aria-label={`Auto-send ${category.label}`}
          />
        </div>
      </div>
    </div>
  );
}

export function AutopilotReadinessSection({ autoDraftEnabled }) {
  const [categories, setCategories] = useState([]);
  const [autoSendIntents, setAutoSendIntents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchReadiness = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/autopilot-readiness", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      setCategories(data?.categories ?? []);
      setAutoSendIntents(data?.auto_send_intents ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReadiness();
  }, [fetchReadiness]);

  const handleToggle = useCallback(async (intent, enabled) => {
    const next = enabled
      ? [...autoSendIntents.filter((i) => i !== intent), intent]
      : autoSendIntents.filter((i) => i !== intent);

    setAutoSendIntents(next);
    setCategories((prev) =>
      prev.map((c) => (c.intent === intent ? { ...c, auto_send_enabled: enabled } : c))
    );

    setSaving(true);
    try {
      const res = await fetch("/api/settings/autopilot-readiness", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto_send_intents: next }),
      });
      if (!res.ok) throw new Error();
      toast.success(
        enabled
          ? `Auto-send enabled for ${categories.find((c) => c.intent === intent)?.label ?? intent}`
          : `Auto-send disabled`
      );
    } catch {
      // revert on error
      setAutoSendIntents(autoSendIntents);
      setCategories((prev) =>
        prev.map((c) => (c.intent === intent ? { ...c, auto_send_enabled: !enabled } : c))
      );
      toast.error("Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  }, [autoSendIntents, categories]);

  const readyCount = categories.filter((c) => c.readiness === "ready").length;
  const enabledCount = categories.filter((c) => c.auto_send_enabled).length;

  return (
    <Card className="rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <CardContent className="p-6 md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5 max-w-xl">
            <div className="flex items-center gap-2.5">
              <h2 className="text-[15px] font-semibold text-slate-900">Autopilot by ticket type</h2>
              {enabledCount > 0 && (
                <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border border-emerald-100 text-[11px]">
                  {enabledCount} active
                </Badge>
              )}
            </div>
            <p className="text-sm leading-relaxed text-slate-600">
              Let Sona send replies automatically for ticket types it handles well. Sona flags when a category is ready — you always decide when to enable it.
            </p>
            {!autoDraftEnabled && (
              <p className="text-xs text-slate-500">Enable Sona Assistant above to configure autopilot.</p>
            )}
          </div>
        </div>

        <Separator className="my-6 bg-slate-200" />

        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="space-y-2 px-1">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-5 w-10 rounded-full" />
                </div>
                <Skeleton className="h-1.5 w-full rounded-full" />
              </div>
            ))}
          </div>
        ) : categories.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-4">
            No ticket data yet. Sona will suggest categories as it processes tickets.
          </p>
        ) : (
          <>
            {readyCount > 0 && (
              <p className="text-[12px] text-slate-500 mb-3">
                Sona recommends enabling autopilot for <span className="font-medium text-slate-700">{readyCount} {readyCount === 1 ? "category" : "categories"}</span> based on recent quality scores.
              </p>
            )}
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              {categories.map((cat, i) => (
                <div key={cat.intent} className={i < categories.length - 1 ? "border-b border-slate-100" : ""}>
                  <CategoryRow
                    category={cat}
                    onToggle={handleToggle}
                    disabled={!autoDraftEnabled || saving}
                  />
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-slate-400">
              Quality scores based on the last 30 days of processed tickets. Only categories marked &quot;Ready&quot; can be enabled.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
