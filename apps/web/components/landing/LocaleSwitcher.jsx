"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Skifter kun locale-præfikset; landing-siden er eneste marketing-rute.
export default function LocaleSwitcher({ locale }) {
  const pathname = usePathname() || "/";
  const other = locale === "da" ? "en" : "da";
  const target = pathname.replace(/^\/(en|da)/, `/${other}`);
  return (
    <Link href={target} className="text-sm text-zinc-500 hover:text-zinc-900" aria-label="Switch language">
      {other.toUpperCase()}
    </Link>
  );
}
