"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CalendarDaysIcon, LoaderCircleIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const PERIOD_OPTIONS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "this_month", label: "This month" },
];

function formatDate(value, fallback) {
  if (!value) return fallback;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function periodLabel(period, range) {
  if (range.start && range.end) {
    return `${formatDate(range.start, "Start")} – ${formatDate(range.end, "End")}`;
  }
  return PERIOD_OPTIONS.find((option) => option.value === period)?.label || "Date range";
}

export function DashboardPeriodPicker({ period = "30", range = { start: "", end: "" } }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [draftRange, setDraftRange] = useState(range);
  const startRef = useRef(null);
  const endRef = useRef(null);

  useEffect(() => {
    setDraftRange(range);
  }, [range]);

  const navigate = (nextPeriod, nextRange = { start: "", end: "" }) => {
    const params = new URLSearchParams();
    if (nextRange.start && nextRange.end) {
      params.set("start", nextRange.start);
      params.set("end", nextRange.end);
    } else {
      params.set("period", nextPeriod);
    }
    setOpen(false);
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  };

  const handleRangeChange = (key, value) => {
    setDraftRange((current) => ({ ...current, [key]: value }));
  };

  const hasValidRange = draftRange.start && draftRange.end && draftRange.end >= draftRange.start;

  const openPicker = (input) => {
    if (typeof input?.showPicker === "function") input.showPicker();
    else input?.focus();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-9 rounded-lg" aria-busy={isPending}>
          {isPending ? (
            <LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
          ) : (
            <CalendarDaysIcon data-icon="inline-start" />
          )}
          {periodLabel(period, draftRange)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-1 rounded-md bg-muted p-1">
            {PERIOD_OPTIONS.map((option) => {
              const active = !draftRange.start && !draftRange.end && period === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => navigate(option.value)}
                  className={cn(
                    "h-8 rounded text-xs font-medium transition-colors",
                    active ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            <div className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">From</span>
              <button
                type="button"
                onClick={() => openPicker(startRef.current)}
                className="relative inline-flex h-9 items-center justify-between gap-2 rounded-md border bg-background px-2 text-left text-sm"
              >
                <span className={draftRange.start ? "text-foreground" : "text-muted-foreground"}>
                  {formatDate(draftRange.start, "Start")}
                </span>
                <CalendarDaysIcon className="size-4 text-muted-foreground" />
                <input
                  ref={startRef}
                  type="date"
                  aria-label="From"
                  value={draftRange.start}
                  onChange={(event) => handleRangeChange("start", event.target.value)}
                  onInput={(event) => handleRangeChange("start", event.target.value)}
                  className="pointer-events-none absolute inset-0 opacity-0"
                  tabIndex={-1}
                />
              </button>
            </div>
            <span className="pb-2 text-xs text-muted-foreground">to</span>
            <div className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">To</span>
              <button
                type="button"
                onClick={() => openPicker(endRef.current)}
                className="relative inline-flex h-9 items-center justify-between gap-2 rounded-md border bg-background px-2 text-left text-sm"
              >
                <span className={draftRange.end ? "text-foreground" : "text-muted-foreground"}>
                  {formatDate(draftRange.end, "End")}
                </span>
                <CalendarDaysIcon className="size-4 text-muted-foreground" />
                <input
                  ref={endRef}
                  type="date"
                  aria-label="To"
                  value={draftRange.end}
                  min={draftRange.start || undefined}
                  onChange={(event) => handleRangeChange("end", event.target.value)}
                  onInput={(event) => handleRangeChange("end", event.target.value)}
                  className="pointer-events-none absolute inset-0 opacity-0"
                  tabIndex={-1}
                />
              </button>
            </div>
          </div>
          <div className="flex justify-end border-t pt-3">
            <Button
              type="button"
              size="sm"
              className="h-8 rounded-lg"
              disabled={!hasValidRange || isPending}
              onClick={() => navigate("custom", draftRange)}
            >
              Apply range
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
