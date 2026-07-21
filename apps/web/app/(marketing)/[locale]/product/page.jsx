import { getTranslations, unstable_setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import MarketingShell from "@/components/landing/MarketingShell";
import SectionHeading from "@/components/landing/SectionHeading";
import Reveal from "@/components/landing/Reveal";
import InlineBookingCalendar from "@/components/landing/InlineBookingCalendar";
import AnimatedDemoInbox from "@/components/landing/demo-inbox/AnimatedDemoInbox";
import ProblemSection from "@/components/landing/ProblemSection";
import AnatomyOfAnswer from "@/components/landing/AnatomyOfAnswer";
import ControlSection from "@/components/landing/ControlSection";
import CapabilitiesGrid from "@/components/landing/CapabilitiesGrid";
import { CheckIcon } from "@/components/landing/icons";
import { marketingMetadata } from "@/lib/landing/metadata";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params: { locale } }) {
  const t = await getTranslations({ locale, namespace: "landing.productPage" });
  return marketingMetadata({
    locale,
    path: "/product",
    title: `Sona — ${t("title")}`,
    description: t("subtitle"),
  });
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

        {/* Live product tour up top: the same self-playing demo as the
            homepage, which literally acts out the page's promise ("follow one
            ticket start to finish"). The walkthrough below then breaks the same
            flow down step by step. The page's own CTA lives once, at the close
            (below) — no duplicate mid-page ask. */}
        <Reveal delay={100} className="relative mt-12">
          {/* Focused variant so it doesn't read as a copy of the homepage: no
              inbox sidebar, and a single looping ticket (address change — a
              different case than the refund the walkthrough below dissects). */}
          <AnimatedDemoInbox showList={false} only="address" wrapClassName="mx-auto max-w-2xl" />
        </Reveal>
      </section>

      <AnatomyOfAnswer />
      <ProblemSection />
      <ControlSection />
      <CapabilitiesGrid />

      {/* Closing CTA framed as one intentional "booking" panel: pitch + bullets
          in a bordered left column, the inline calendar in a tinted right
          column. Wrapping both in a single elevated card (rather than a tight
          border around just the embed) makes the calendar read as designed-in,
          not a raw iframe dropped on the page. The calendar column is a
          fixed-remainder width (not a proportional fraction) — Cal's embed needs
          real width (~800px+) to lay its info panel, date grid and time slots
          side by side like the popup; narrower and it falls back to a cramped,
          zoomed-in stacked view. */}
      <section className="border-t border-zinc-100 bg-zinc-50 px-5 py-24">
        <div className="mx-auto max-w-7xl">
          <Reveal className="overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-[0_28px_90px_-40px_rgba(24,24,27,0.28)]">
            <div className="grid lg:grid-cols-[360px_minmax(0,1fr)]">
              <div className="border-b border-zinc-100 p-8 lg:border-b-0 lg:border-r lg:p-10">
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
              </div>
              {/* Height cap + scroll: Cal's auto-resize is unpredictable (grew
                  past 2000px in testing), and overflow-hidden with no cap
                  silently clipped the times/details steps — this keeps every
                  step reachable without unbounded growth. */}
              <div className="relative max-h-[620px] overflow-y-auto p-3 sm:p-5">
                <InlineBookingCalendar
                  fallbackLabel={t("calendarFallback")}
                  fallbackHref={`/${locale}#book-demo`}
                />
                {/* Cal's "Cal.eu" branding footer lives inside a cross-origin
                    iframe we can't restyle directly — this masks it with a bar
                    matching the column's own background. Pinned to the column's
                    bottom, so it only lines up in the common, unscrolled state
                    (content height under the cap, true for every state observed
                    in testing). pointer-events-none so it can never block a real
                    click if the estimate is ever slightly off. */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-9 bg-white"
                />
              </div>
            </div>
          </Reveal>
        </div>
      </section>
    </MarketingShell>
  );
}
