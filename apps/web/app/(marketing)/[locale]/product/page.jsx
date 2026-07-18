import { getTranslations, unstable_setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import MarketingShell from "@/components/landing/MarketingShell";
import SectionHeading from "@/components/landing/SectionHeading";
import Reveal from "@/components/landing/Reveal";
import BookDemoButton from "@/components/landing/BookDemoButton";
import DemoInbox from "@/components/landing/demo-inbox/DemoInbox";
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

        {/* Static full-inbox anchor (Front-style): the whole product up top,
            broken down step by step in the walkthrough below. */}
        <Reveal delay={100} className="relative mt-12">
          <DemoInbox showTabs={false} />
        </Reveal>

        <Reveal delay={80} className="mt-10 text-center">
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

      {/* Closing CTA: dark, with heading + subtitle, so it flows straight into
          MarketingShell's dark footer instead of ending on a lone button. */}
      <section className="relative overflow-hidden bg-zinc-950 px-5 pt-20 pb-4 text-center">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[32rem] -translate-x-1/2 bg-[radial-gradient(ellipse,rgba(99,102,241,0.35),transparent_70%)]"
        />
        <Reveal className="relative">
          <h2 className="text-balance text-3xl font-bold tracking-tight text-white sm:text-4xl">
            {t("closingTitle")}
          </h2>
          <p className="mx-auto mt-3.5 max-w-lg text-base text-zinc-400">{t("closingSubtitle")}</p>
        </Reveal>
        <Reveal delay={100} className="mt-9">
          <BookDemoButton
            label={t("cta")}
            fallbackHref={`/${locale}#book-demo`}
            className="inline-block rounded-lg bg-white px-6 py-3 text-sm font-semibold text-zinc-950 shadow-lg transition-all duration-200 hover:bg-zinc-100 active:scale-[0.97]"
          />
        </Reveal>
      </section>
    </MarketingShell>
  );
}
