import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SonaLogo } from "@/components/ui/SonaLogo";
import LocaleSwitcher from "./LocaleSwitcher";
import BookDemoButton from "./BookDemoButton";

export default async function LandingNav({ locale }) {
  const t = await getTranslations("landing.nav");
  return (
    <header className="sticky top-0 z-40 border-b border-zinc-100 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <Link href={`/${locale}`} className="flex items-center gap-2 font-bold tracking-tight text-zinc-950">
          <SonaLogo size={22} className="h-[22px] w-[22px] shrink-0" />
          Sona AI
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-zinc-600 md:flex">
          <Link href={`/${locale}/product`} className="hover:text-zinc-900">{t("product")}</Link>
          <Link href={`/${locale}/integrations`} className="hover:text-zinc-900">{t("integrations")}</Link>
          <Link href={`/${locale}#pricing`} className="hover:text-zinc-900">{t("pricing")}</Link>
          <Link href={`/${locale}/security`} className="hover:text-zinc-900">{t("security")}</Link>
        </nav>
        <div className="flex items-center gap-4">
          <LocaleSwitcher locale={locale} />
          <Link href="/sign-in" className="hidden text-sm text-zinc-600 hover:text-zinc-900 sm:block">{t("login")}</Link>
          <BookDemoButton
            label={t("bookDemo")}
            fallbackHref={`/${locale}#book-demo`}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-indigo-500 active:scale-[0.97]"
          />
        </div>
      </div>
    </header>
  );
}
