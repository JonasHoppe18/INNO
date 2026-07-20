"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

// Hamburger + dropdown panel for the primary nav links, shown only below the
// `md` breakpoint where LandingNav hides its inline <nav>. The panel is
// `absolute inset-x-0` — its containing block is the sticky <header> in
// LandingNav, so it spans the full header width even though this wrapper
// itself is only as wide as the button. Closes on link click, outside click,
// and Escape, mirroring LocaleSwitcher's interaction pattern.
export default function MobileNavMenu({ links, loginLabel, loginHref = "/sign-in", menuLabel, closeMenuLabel }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? closeMenuLabel : menuLabel}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-600 transition-colors duration-200 hover:bg-zinc-100 hover:text-zinc-900"
      >
        {open ? (
          <svg width="19" height="19" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="19" height="19" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M3 5.5h14M3 10h14M3 14.5h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        )}
      </button>

      {open ? (
        <div className="absolute inset-x-0 top-full z-30 border-b border-zinc-100 bg-white shadow-lg shadow-zinc-900/5">
          <nav className="mx-auto flex max-w-6xl flex-col px-5 py-2">
            {links.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-3 text-[15px] font-medium text-zinc-700 transition-colors duration-150 hover:bg-zinc-50 hover:text-zinc-900"
              >
                {label}
              </Link>
            ))}
            <div className="my-1 border-t border-zinc-100" />
            <Link
              href={loginHref}
              onClick={() => setOpen(false)}
              className="rounded-lg px-2 py-3 text-[15px] font-medium text-zinc-700 transition-colors duration-150 hover:bg-zinc-50 hover:text-zinc-900"
            >
              {loginLabel}
            </Link>
          </nav>
        </div>
      ) : null}
    </div>
  );
}
