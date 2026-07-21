import { getTranslations, unstable_setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import MarketingShell from "@/components/landing/MarketingShell";
import LegalSections from "@/components/landing/LegalSections";
import { marketingMetadata } from "@/lib/landing/metadata";
import { CONTACT_EMAIL } from "@/lib/landing/contact";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params: { locale } }) {
  const t = await getTranslations({ locale, namespace: "landing.legal" });
  return marketingMetadata({
    locale,
    path: "/privacy",
    title: `Sona — ${t("privacyTitle")}`,
  });
}

export default async function PrivacyPage({ params: { locale } }) {
  unstable_setRequestLocale(locale);
  const t = await getTranslations("landing.legal");
  const sections = t.raw("privacySections");
  return (
    <MarketingShell locale={locale}>
      <section className="px-5 pt-20 pb-24">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-950 sm:text-4xl">{t("privacyTitle")}</h1>
          <p className="mt-2 text-sm text-zinc-400">
            {t("updatedLabel")}: {t("updatedDate")}
          </p>
          <LegalSections sections={sections} />
          <div className="mt-12 rounded-2xl border border-zinc-200 bg-zinc-50 p-6 text-center">
            <p className="text-sm leading-relaxed text-zinc-600">{t("contactPrompt")}</p>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="mt-3 inline-block text-sm font-semibold text-indigo-600 hover:text-indigo-700"
            >
              {CONTACT_EMAIL}
            </a>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
