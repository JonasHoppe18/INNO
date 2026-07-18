import { getTranslations, unstable_setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import MarketingShell from "@/components/landing/MarketingShell";
import SectionHeading from "@/components/landing/SectionHeading";
import Reveal from "@/components/landing/Reveal";
import BookDemoButton from "@/components/landing/BookDemoButton";
import ProblemSection from "@/components/landing/ProblemSection";
import AnatomyOfAnswer from "@/components/landing/AnatomyOfAnswer";
import ControlSection from "@/components/landing/ControlSection";
import CapabilitiesGrid from "@/components/landing/CapabilitiesGrid";

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

// The product page goes deep in a different shape from the homepage: its own
// narrative hero, a step-by-step "anatomy of an answer" walkthrough built from
// the real inbox components, the problem it solves, the control modes, and a
// capabilities grid.
export default async function ProductPage({ params: { locale } }) {
  unstable_setRequestLocale(locale);
  const t = await getTranslations("landing.productPage");
  return (
    <MarketingShell locale={locale}>
      <section className="relative overflow-hidden px-5 pt-16 pb-12 text-center">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(ellipse_at_50%_0%,rgba(99,102,241,0.14),rgba(147,51,234,0.06)_55%,transparent_75%)]"
        />
        <Reveal className="relative mb-5">
          <span className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/70 px-3 py-1.5 text-xs font-medium text-zinc-600">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-600" />
            {t("badge")}
          </span>
        </Reveal>
        <SectionHeading title={t("title")} subtitle={t("subtitle")} />
        <Reveal delay={80} className="mt-8 text-center">
          <BookDemoButton
            label={t("cta")}
            fallbackHref={`/${locale}#book-demo`}
            className="inline-block rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition-all duration-200 hover:bg-indigo-500 active:scale-[0.97]"
          />
        </Reveal>
      </section>

      <AnatomyOfAnswer />
      <ProblemSection />
      <ControlSection />
      <CapabilitiesGrid />

      <section className="border-t border-zinc-100 bg-zinc-50 px-5 py-20 text-center">
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
