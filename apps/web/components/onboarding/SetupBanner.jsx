"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DISMISS_KEY = "sona_setup_banner_dismissed";

const stepConfig = [
  {
    key: "email_connected",
    label: "Connect email",
    href: "/onboarding",
  },
  {
    key: "shopify_connected",
    label: "Connect Shopify",
    href: "/onboarding",
  },
  {
    key: "ai_configured",
    label: "Configure AI",
    href: "/onboarding",
  },
  {
    key: "first_draft_created",
    label: "Get first draft",
    href: "/onboarding",
  },
];

export function SetupBanner() {
  const pathname = usePathname();
  const [state, setState] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(DISMISS_KEY) : null;
    setDismissed(stored === "true");
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const res = await fetch("/api/onboarding/state").catch(() => null);
      if (!res?.ok) return;
      const payload = await res.json().catch(() => null);
      if (!active || !payload) return;
      setState(payload);
      if (payload?.completed && typeof window !== "undefined") {
        window.localStorage.removeItem(DISMISS_KEY);
        setDismissed(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, []);

  const shouldHide =
    dismissed ||
    !state ||
    state.completed ||
    pathname?.startsWith("/onboarding") ||
    pathname?.startsWith("/guides");

  const progress = useMemo(() => {
    if (!state?.steps) return 0;
    const total = stepConfig.length;
    const done = stepConfig.filter((step) => state.steps[step.key]).length;
    return { done, total };
  }, [state]);

  if (shouldHide) return null;

  return (
    <div className="sticky top-0 z-30 border-b border-indigo-100 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3 lg:px-6">
        <div className="min-w-[220px]">
          <p className="text-sm font-semibold text-slate-900">Setup progress</p>
          <p className="text-xs text-slate-500">
            {progress.done}/{progress.total} steps completed
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {stepConfig.map((step) => {
            const isDone = Boolean(state?.steps?.[step.key]);
            return (
              <Link
                key={step.key}
                href={step.href}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition",
                  isDone
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-indigo-200 bg-indigo-50 text-indigo-700 hover:border-indigo-300 hover:bg-indigo-100"
                )}
              >
                {step.label}
              </Link>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm">
            <Link href="/onboarding">Continue setup</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/guides" target="_blank" rel="noreferrer">
              View setup guide
            </Link>
          </Button>
          <button
            type="button"
            className="text-xs text-slate-500 hover:text-slate-700"
            onClick={() => {
              if (typeof window !== "undefined") {
                window.localStorage.setItem(DISMISS_KEY, "true");
              }
              setDismissed(true);
            }}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
