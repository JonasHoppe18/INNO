"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";

export function GlobalTestModeBanner() {
  const pathname = usePathname();
  const [testModeEnabled, setTestModeEnabled] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const res = await fetch("/api/settings/test-mode", {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      }).catch(() => null);
      if (!active || !res?.ok) {
        if (active) setTestModeEnabled(false);
        return;
      }
      const payload = await res.json().catch(() => null);
      if (!active) return;
      setTestModeEnabled(Boolean(payload?.test_mode));
    };

    load().catch(() => null);
    return () => {
      active = false;
    };
  }, [pathname]);

  if (!testModeEnabled) return null;

  return (
    <div className="border-b border-slate-200 bg-indigo-50/60">
      <div className="flex flex-col gap-2 px-4 py-2.5 lg:flex-row lg:items-center lg:justify-between lg:px-6">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900">Test Mode is enabled</p>
          <p className="text-xs text-slate-600">
            Actions and emails are being simulated. No changes will be sent to Shopify or other integrations.
          </p>
        </div>
        <Button
          asChild
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 self-start text-slate-700 hover:bg-indigo-100 hover:text-slate-900 lg:self-auto"
        >
          <Link href="/settings">Manage in Settings</Link>
        </Button>
      </div>
    </div>
  );
}
