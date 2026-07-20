"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { routing } from "@/i18n/routing";

// Metadata for the switcher UI (flag + display name) — only en/da for now.
// Keyed by locale code so adding a new locale to routing.js without adding an
// entry here still renders something sane (uppercase code, globe icon).
const LOCALE_META = {
  en: { label: "English", flag: "🇬🇧" },
  da: { label: "Dansk", flag: "🇩🇰" },
};

const LOCALE_PATTERN = new RegExp(`^/(${routing.locales.join("|")})`);

// Dropdown language switcher: flag + current language on a pill trigger,
// opens a listbox of the other locales. Swaps only the locale segment of the
// current path, so switching keeps you on the same page. `tone="dark"` is for
// placement on a dark background (the footer); default is the light header.
// `compactOnMobile` hides the text label below `sm` (flag + chevron only) —
// used in the header, where the trigger competes for space with the hamburger
// and the primary CTA; the footer has room to spare and keeps the full label.
export default function LocaleSwitcher({ locale, tone = "light", compactOnMobile = false }) {
  const t = useTranslations("landing.nav");
  const pathname = usePathname() || "/";
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const dark = tone === "dark";

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

  const current = LOCALE_META[locale] || { label: locale.toUpperCase(), flag: "🌐" };
  const targetFor = (code) => pathname.replace(LOCALE_PATTERN, `/${code}`);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("switchLanguage")}
        className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors duration-200 ${
          dark
            ? "text-zinc-400 hover:text-white"
            : "text-zinc-600 hover:text-zinc-900"
        }`}
      >
        <span aria-hidden="true">{current.flag}</span>
        <span className={compactOnMobile ? "hidden sm:inline" : undefined}>{current.label}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          aria-hidden="true"
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <path
            d="M2.5 4.5l3.5 3.5 3.5-3.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </button>

      {open ? (
        <ul
          role="listbox"
          aria-label={t("switchLanguage")}
          className={`absolute right-0 z-50 mt-2 min-w-[160px] overflow-hidden rounded-xl border py-1.5 shadow-lg ${
            dark ? "border-zinc-800 bg-zinc-900 shadow-black/40" : "border-zinc-200 bg-white shadow-zinc-900/10"
          }`}
        >
          {routing.locales.map((code) => {
            const meta = LOCALE_META[code] || { label: code.toUpperCase(), flag: "🌐" };
            const selected = code === locale;
            return (
              <li key={code} role="option" aria-selected={selected}>
                <Link
                  href={targetFor(code)}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-2.5 px-3 py-2 text-sm transition-colors duration-150 ${
                    dark
                      ? selected
                        ? "font-semibold text-white"
                        : "text-zinc-300 hover:bg-white/5 hover:text-white"
                      : selected
                      ? "font-semibold text-zinc-900"
                      : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
                  }`}
                >
                  <span aria-hidden="true">{meta.flag}</span>
                  <span className="flex-1">{meta.label}</span>
                  {selected ? (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 12 12"
                      aria-hidden="true"
                      className={dark ? "text-indigo-400" : "text-indigo-600"}
                    >
                      <path
                        d="M2.5 6.3l2.2 2.2 4.8-5"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        fill="none"
                      />
                    </svg>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
