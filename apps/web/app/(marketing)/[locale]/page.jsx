import { getTranslations, unstable_setRequestLocale } from "next-intl/server";

export default async function LandingPage({ params: { locale } }) {
  unstable_setRequestLocale(locale);
  const t = await getTranslations("landing");
  return (
    <main className="min-h-screen bg-white text-zinc-900">
      <p className="p-8">{t("hero.titleLine1")}</p>
    </main>
  );
}
