import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SonaLogo } from "@/components/ui/SonaLogo";
import LocaleSwitcher from "./LocaleSwitcher";
import BookDemoButton from "./BookDemoButton";
import MobileNavMenu from "./MobileNavMenu";

export default async function LandingNav({ locale }) {
  const t = await getTranslations("landing.nav");
  const links = [
    { href: `/${locale}/product`, label: t("product") },
    { href: `/${locale}/integrations`, label: t("integrations") },
    { href: `/${locale}#pricing`, label: t("pricing") },
    { href: `/${locale}/security`, label: t("security") },
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-zinc-100 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center px-5 py-4">
        {/* Equal flex-basis on the two outer groups keeps the centred nav on
            the true page centre, instead of the midpoint between two
            unequally-wide side groups (which read as lopsided). */}
        <div className="flex flex-1 items-center">
          <Link href={`/${locale}`} className="flex items-center gap-2 font-bold tracking-tight text-zinc-950">
            <SonaLogo size={22} className="h-[22px] w-[22px] shrink-0" />
            Sona AI
          </Link>
        </div>
        <nav className="hidden items-center gap-6 text-sm text-zinc-600 md:flex">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-zinc-900">
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-1 items-center justify-end gap-2 sm:gap-4">
          <MobileNavMenu
            links={links}
            loginLabel={t("login")}
            menuLabel={t("menu")}
            closeMenuLabel={t("closeMenu")}
          />
          <LocaleSwitcher locale={locale} />
          <Link href="/sign-in" className="hidden text-sm text-zinc-600 hover:text-zinc-900 md:block">{t("login")}</Link>
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
