import { getTranslations, unstable_setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import MarketingShell from "@/components/landing/MarketingShell";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params: { locale } }) {
  const t = await getTranslations({ locale, namespace: "landing.legal" });
  return {
    title: `Sona — ${t("termsTitle")}`,
    alternates: { canonical: `/${locale}/terms`, languages: { en: "/en/terms", da: "/da/terms" } },
  };
}

export default async function TermsPage({ params: { locale } }) {
  unstable_setRequestLocale(locale);
  const t = await getTranslations("landing.legal");
  return (
    <MarketingShell locale={locale}>
      <section className="px-5 pt-20 pb-24">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-950 sm:text-4xl">{t("termsTitle")}</h1>
          <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm leading-relaxed text-amber-800">
            {t("placeholder")}
          </div>
          <p className="mt-6 text-sm text-zinc-500">{t("contactLine")}</p>
        </div>
      </section>
    </MarketingShell>
  );
}
