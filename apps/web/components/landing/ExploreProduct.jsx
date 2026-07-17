import Link from "next/link";
import { getTranslations } from "next-intl/server";
import SectionHeading from "./SectionHeading";
import Reveal from "./Reveal";

// "Explore" cards that carry the buyer from the lean homepage into the deeper
// pages (Fibery/Navattic pattern) — the depth lives there, not on the homepage.
const CARDS = [
  { n: 1, href: (l) => `/${l}/product` },
  { n: 2, href: (l) => `/${l}/integrations` },
  { n: 3, href: (l) => `/${l}/security` },
];

const ICONS = {
  1: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="2.5" y="3.5" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.5 15.5h5M9 12.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  2: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M7 11l-2 2a2.5 2.5 0 01-3.5-3.5l2-2M11 7l2-2a2.5 2.5 0 013.5 3.5l-2 2M6.5 11.5l5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  3: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M9 2l5.5 2v4c0 3.4-2.3 6.4-5.5 7.5C5.8 14.4 3.5 11.4 3.5 8V4L9 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M6.6 8.6l1.7 1.7 3.1-3.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

export default async function ExploreProduct({ locale }) {
  const t = await getTranslations("landing.explore");
  return (
    <section className="border-t border-zinc-100 bg-zinc-50 px-5 py-24">
      <div className="mx-auto max-w-5xl">
        <SectionHeading kicker={t("kicker")} title={t("title")} />
        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          {CARDS.map(({ n, href }, i) => (
            <Reveal key={n} delay={i * 80}>
              <Link
                href={href(locale)}
                className="group flex h-full flex-col rounded-2xl border border-zinc-200 bg-white p-6 transition-shadow duration-300 hover:shadow-[0_12px_40px_-16px_rgba(0,0,0,0.12)]"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                  {ICONS[n]}
                </div>
                <h3 className="mt-4 text-base font-bold text-zinc-900">{t(`card${n}Title`)}</h3>
                <p className="mt-1.5 flex-1 text-sm leading-relaxed text-zinc-500">{t(`card${n}Body`)}</p>
                <span className="mt-4 text-sm font-medium text-indigo-600">
                  {t("learnMore")} <span className="transition-transform group-hover:translate-x-0.5 inline-block">→</span>
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
