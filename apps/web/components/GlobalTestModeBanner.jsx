"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function GlobalTestModeBanner() {
  const pathname = usePathname();
  const [testModeEnabled, setTestModeEnabled] = useState(false);
  const bannerRef = useRef(null);

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

  useEffect(() => {
    const root = document.documentElement;
    if (!testModeEnabled || !bannerRef.current) {
      root.style.setProperty("--app-top-offset", "0px");
      return;
    }

    const updateOffset = () => {
      const height = bannerRef.current?.offsetHeight || 0;
      root.style.setProperty("--app-top-offset", `${height}px`);
    };

    updateOffset();
    const observer = new ResizeObserver(() => updateOffset());
    observer.observe(bannerRef.current);

    return () => {
      observer.disconnect();
      root.style.setProperty("--app-top-offset", "0px");
    };
  }, [testModeEnabled]);

  if (!testModeEnabled) return null;

  return (
    <div ref={bannerRef}>
      <div className="flex h-9 items-center justify-center gap-2 bg-indigo-800 px-4">
        <p className="text-[13px] font-medium tracking-[0.05em] text-white">Test mode is enabled.</p>
        <Link
          href="/settings"
          className="text-[13px] font-medium tracking-[0.05em] text-indigo-100 underline underline-offset-2 hover:text-white"
        >
          Manage settings
        </Link>
      </div>
    </div>
  );
}
