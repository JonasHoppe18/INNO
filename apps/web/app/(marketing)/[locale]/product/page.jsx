import { getTranslations, unstable_setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import MarketingShell from "@/components/landing/MarketingShell";
import SectionHeading from "@/components/landing/SectionHeading";
import Reveal from "@/components/landing/Reveal";
import BookDemoButton from "@/components/landing/BookDemoButton";
import ProblemSection from "@/components/landing/ProblemSection";
import FeatureDives from "@/components/landing/FeatureDives";
import LanguagesSection from "@/components/landing/LanguagesSection";
import ControlSection from "@/components/landing/ControlSection";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params: { locale } }) {
  const t = await getTranslations({ locale, namespace: "landing.productPage" });
  return {
    title: `Sona — ${t("title")}`,
    description: t("subtitle"),
    alternates: { canonical: `/${locale}/product`, languages: { en: "/en/product", da: "/da/product" } },
  };
}

export default async function ProductPage({ params: { locale } }) {
  unstable_setRequestLocale(locale);
  const t = await getTranslations("landing.productPage");
  return (
    <MarketingShell locale={locale}>
      <section className="px-5 pt-20 pb-6">
        <SectionHeading title={t("title")} subtitle={t("subtitle")} />
      </section>

      <ProblemSection />
      <FeatureDives />
      <LanguagesSection />
      <ControlSection />

      <section className="px-5 pt-12 pb-24 text-center">
        <Reveal>
          <BookDemoButton
            label={t("cta")}
            fallbackHref={`/${locale}#book-demo`}
            className="inline-block rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition-all duration-200 hover:bg-indigo-500 active:scale-[0.97]"
          />
        </Reveal>
      </section>
    </MarketingShell>
  );
}
