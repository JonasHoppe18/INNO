import { getTranslations } from "next-intl/server";
import SectionHeading from "./SectionHeading";
import Reveal from "./Reveal";

export default async function HowItWorks() {
  const t = await getTranslations("landing.how");
  const steps = [1, 2, 3];
  return (
    <section id="how" className="border-t border-zinc-100 bg-zinc-50 px-5 py-24">
      <div className="mx-auto max-w-5xl">
        <SectionHeading kicker={t("kicker")} title={t("title")} />
        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          {steps.map((n, i) => (
            <Reveal
              key={n}
              delay={i * 80}
              className="rounded-2xl border border-zinc-200 bg-white p-6 transition-shadow duration-300 hover:shadow-[0_12px_40px_-16px_rgba(0,0,0,0.12)]"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-sm font-bold text-indigo-600">
                {n}
              </div>
              <h3 className="mt-4 text-base font-bold text-zinc-900">{t(`step${n}Title`)}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">{t(`step${n}Body`)}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
