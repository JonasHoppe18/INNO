import { getTranslations } from "next-intl/server";
import SectionHeading from "./SectionHeading";
import Reveal from "./Reveal";

export default async function FaqSection() {
  const t = await getTranslations("landing.faq");
  return (
    <section className="bg-zinc-50 px-5 pt-12 pb-24">
      <div className="mx-auto max-w-2xl">
        <SectionHeading title={t("title")} />
        <div className="mt-10 space-y-2.5">
          {[1, 2, 3, 4, 5, 6].map((n, i) => (
            <Reveal key={n} delay={i * 40}>
              <details className="group rounded-xl border border-zinc-200 bg-white px-5 py-4 transition-colors duration-200 hover:border-zinc-300 open:border-zinc-300">
                <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-zinc-900 [&::-webkit-details-marker]:hidden">
                  {t(`q${n}`)}
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    className="shrink-0 text-zinc-400 transition-transform duration-200 group-open:rotate-45"
                    aria-hidden="true"
                  >
                    <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-zinc-600">{t(`a${n}`)}</p>
              </details>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
