import Link from "next/link";
import { getTranslations } from "next-intl/server";
import SectionHeading from "./SectionHeading";
import Reveal from "./Reveal";

const ICONS = {
  1: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M9 2l5.5 2v4c0 3.4-2.3 6.4-5.5 7.5C5.8 14.4 3.5 11.4 3.5 8V4L9 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M6.6 8.6l1.7 1.7 3.1-3.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  2: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.5 9h13M9 2.5c2 2.3 2 10.7 0 13M9 2.5c-2 2.3-2 10.7 0 13" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  ),
  3: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="9" cy="6" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 15.5c.9-3 3.2-4.5 6-4.5s5.1 1.5 6 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
};

export default async function TrustSection({ locale }) {
  const t = await getTranslations("landing.trust");
  const pillars = [1, 2, 3];
  return (
    <section className="px-5 py-24">
      <div className="mx-auto max-w-5xl">
        <SectionHeading kicker={t("kicker")} title={t("title")} subtitle={t("body")} />
        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          {pillars.map((n, i) => (
            <Reveal key={n} delay={i * 80} className="rounded-2xl border border-zinc-200 bg-white p-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                {ICONS[n]}
              </div>
              <h3 className="mt-4 text-sm font-bold text-zinc-900">{t(`pillar${n}Title`)}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">{t(`pillar${n}Body`)}</p>
            </Reveal>
          ))}
        </div>
        <Reveal delay={80} className="mt-8 text-center">
          <Link
            href={`/${locale}/security`}
            className="text-sm font-medium text-indigo-600 transition-colors hover:text-indigo-700"
          >
            {t("securityLink")} →
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
