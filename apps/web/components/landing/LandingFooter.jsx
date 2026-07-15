import { getTranslations } from "next-intl/server";
import { SonaMark } from "./icons";
import LocaleSwitcher from "./LocaleSwitcher";

export default async function LandingFooter({ locale }) {
  const t = await getTranslations("landing.footer");
  return (
    <div className="flex flex-col items-center justify-between gap-4 border-t border-zinc-800 py-6 text-sm text-zinc-500 sm:flex-row">
      <span className="flex items-center gap-2 font-bold text-white"><SonaMark /> sona</span>
      <div className="flex items-center gap-5">
        <a href="/privacy" className="hover:text-zinc-300">{t("privacy")}</a>
        <a href="/terms" className="hover:text-zinc-300">{t("terms")}</a>
        <a href={`mailto:${t("contact")}`} className="hover:text-zinc-300">{t("contact")}</a>
        <LocaleSwitcher locale={locale} />
      </div>
    </div>
  );
}
