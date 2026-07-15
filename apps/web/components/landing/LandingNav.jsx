import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SonaMark } from "./icons";
import LocaleSwitcher from "./LocaleSwitcher";

export default async function LandingNav({ locale }) {
  const t = await getTranslations("landing.nav");
  return (
    <header className="sticky top-0 z-40 border-b border-zinc-100 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <Link href={`/${locale}`} className="flex items-center gap-2 font-bold tracking-tight text-zinc-950">
          <SonaMark /> sona
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-zinc-600 md:flex">
          <a href="#product" className="hover:text-zinc-900">{t("product")}</a>
          <a href="#how" className="hover:text-zinc-900">{t("how")}</a>
          <a href="#pricing" className="hover:text-zinc-900">{t("pricing")}</a>
        </nav>
        <div className="flex items-center gap-4">
          <LocaleSwitcher locale={locale} />
          <Link href="/sign-in" className="hidden text-sm text-zinc-600 hover:text-zinc-900 sm:block">{t("login")}</Link>
          <a href="#book-demo" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
            {t("bookDemo")}
          </a>
        </div>
      </div>
    </header>
  );
}
