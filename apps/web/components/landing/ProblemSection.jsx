import { getTranslations } from "next-intl/server";
import SectionHeading from "./SectionHeading";
import Reveal from "./Reveal";

// Line icons (no emoji) — one per pain point.
const ICONS = {
  1: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  2: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 6v4l2.5 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  3: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3 5.5A1.5 1.5 0 014.5 4h11A1.5 1.5 0 0117 5.5V12a1.5 1.5 0 01-1.5 1.5H8l-4 3V13.5A1.5 1.5 0 013 12V5.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M7.5 9h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  4: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M5 3.5h7L15.5 7v9.5H5V3.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M11.5 3.5V7h4" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  ),
};

export default async function ProblemSection() {
  const t = await getTranslations("landing.problem");
  const cards = [1, 2, 3, 4];
  return (
    <section className="border-t border-zinc-100 bg-zinc-50 px-5 py-24">
      <div className="mx-auto max-w-5xl">
        <SectionHeading kicker={t("kicker")} title={t("title")} />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((n, i) => (
            <Reveal
              key={n}
              delay={i * 70}
              className="rounded-2xl border border-zinc-200 bg-white p-6"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500">
                {ICONS[n]}
              </div>
              <h3 className="mt-4 text-sm font-bold text-zinc-900">{t(`card${n}Title`)}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">{t(`card${n}Body`)}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
