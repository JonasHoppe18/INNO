import { getTranslations, unstable_setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import MarketingShell from "@/components/landing/MarketingShell";
import SectionHeading from "@/components/landing/SectionHeading";
import Reveal from "@/components/landing/Reveal";
import InlineBookingCalendar from "@/components/landing/InlineBookingCalendar";
import DemoInbox from "@/components/landing/demo-inbox/DemoInbox";
import ProblemSection from "@/components/landing/ProblemSection";
import AnatomyOfAnswer from "@/components/landing/AnatomyOfAnswer";
import ControlSection from "@/components/landing/ControlSection";
import CapabilitiesGrid from "@/components/landing/CapabilitiesGrid";
import { CheckIcon } from "@/components/landing/icons";

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
      <section className="relative overflow-hidden px-5 pt-16 pb-16 text-center">
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
            broken down step by step in the walkthrough below. The page's own
            CTA lives once, at the close (below) — no duplicate mid-page ask. */}
        <Reveal delay={100} className="relative mt-12">
          <DemoInbox showTabs={false} />
        </Reveal>
      </section>

      <AnatomyOfAnswer />
      <ProblemSection />
      <ControlSection />
      <CapabilitiesGrid />

      {/* Closing CTA: pitch + bullets left, an inline booking calendar right.
          The calendar column is a fixed-remainder width (not a proportional
          fraction) — Cal's embed needs real width (~800px+) to lay out its
          info panel, date grid and time slots side by side like the popup;
          narrower and it falls back to a cramped, zoomed-in stacked view. */}
      <section className="border-t border-zinc-100 bg-zinc-50 px-5 py-24">
        <div className="mx-auto grid max-w-7xl items-start gap-10 lg:grid-cols-[340px_minmax(0,1fr)]">
          <Reveal className="lg:pt-6">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-indigo-600">
              {t("closingKicker")}
            </p>
            <h2 className="mt-2.5 text-balance text-3xl font-bold tracking-tight text-zinc-950 sm:text-4xl">
              {t("closingTitle")}
            </h2>
            <p className="mt-3.5 text-base leading-relaxed text-zinc-600">{t("closingSubtitle")}</p>
            <ul className="mt-6 space-y-3">
              {["closingBullet1", "closingBullet2"].map((key) => (
                <li key={key} className="flex items-center gap-2.5 text-sm text-zinc-700">
                  <CheckIcon /> {t(key)}
                </li>
              ))}
            </ul>
          </Reveal>
          {/* Cal's embed auto-resizes unpredictably (grew past 2000px in
              testing regardless of column width) — cap the card height and
              let it scroll internally. overflow-hidden alone (no cap+scroll)
              silently clipped the times/details steps; this keeps every step
              reachable without letting the section grow unbounded. */}
          <Reveal
            delay={100}
            className="max-h-[640px] overflow-y-auto rounded-2xl border border-zinc-200 bg-white shadow-[0_20px_60px_-30px_rgba(0,0,0,0.25)]"
          >
            <InlineBookingCalendar
              fallbackLabel={t("calendarFallback")}
              fallbackHref={`/${locale}#book-demo`}
            />
          </Reveal>
        </div>
      </section>
    </MarketingShell>
  );
}
