import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SonaMark } from "./icons";
import LocaleSwitcher from "./LocaleSwitcher";

export default async function LandingFooter({ locale }) {
  const t = await getTranslations("landing.footer");
  return (
    <div className="flex flex-col items-center justify-between gap-4 border-t border-zinc-800 py-6 text-sm text-zinc-500 sm:flex-row">
      <span className="flex items-center gap-2 font-bold text-white"><SonaMark /> sona</span>
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
        <Link href={`/${locale}/integrations`} className="hover:text-zinc-300">{t("integrations")}</Link>
        <Link href={`/${locale}/security`} className="hover:text-zinc-300">{t("security")}</Link>
        <Link href={`/${locale}/privacy`} className="hover:text-zinc-300">{t("privacy")}</Link>
        <Link href={`/${locale}/terms`} className="hover:text-zinc-300">{t("terms")}</Link>
        <a href={`mailto:${t("contact")}`} className="hover:text-zinc-300">{t("contact")}</a>
        <LocaleSwitcher locale={locale} />
      </div>
    </div>
  );
}
