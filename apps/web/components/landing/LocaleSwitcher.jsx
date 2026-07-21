"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { routing } from "@/i18n/routing";

// Metadata for the switcher UI (short code for the trigger, full name for the
// dropdown list) — only en/da for now. Keyed by locale code so adding a new
// locale to routing.js without adding an entry here still renders something
// sane (uppercase code as both). No flags: emoji glyphs render in the OS's
// emoji font, not Inter, so they never actually match the rest of the UI —
// plain text does.
const LOCALE_META = {
  en: { code: "EN", label: "English" },
  da: { code: "DA", label: "Dansk" },
};

const LOCALE_PATTERN = new RegExp(`^/(${routing.locales.join("|")})`);

// Dropdown language switcher: a short code + chevron trigger (e.g. "EN"),
// opens a listbox of the other locales by full name. Swaps only the locale
// segment of the current path, so switching keeps you on the same page.
// `tone="dark"` is for placement on a dark background (the footer); default
// is the light header.
export default function LocaleSwitcher({ locale, tone = "light" }) {
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

  const current = LOCALE_META[locale] || { code: locale.toUpperCase(), label: locale.toUpperCase() };
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
        <span>{current.code}</span>
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
            const meta = LOCALE_META[code] || { label: code.toUpperCase() };
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
