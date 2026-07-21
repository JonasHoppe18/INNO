import { getTranslations } from "next-intl/server";
import SectionHeading from "./SectionHeading";
import Reveal from "./Reveal";

export default async function ControlSection() {
  const t = await getTranslations("landing.control");
  // Three modes, set per ticket type. "Suggest" is the default starting point.
  const modes = [
    { n: 1, highlighted: false },
    { n: 2, highlighted: true },
    { n: 3, highlighted: false },
  ];
  return (
    <section className="px-5 py-24">
      <div className="mx-auto max-w-5xl">
        <SectionHeading kicker={t("kicker")} title={t("title")} subtitle={t("subtitle")} />
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {modes.map(({ n, highlighted }, i) => (
            <Reveal
              key={n}
              delay={i * 80}
              className={`relative rounded-2xl border bg-white p-6 ${
                highlighted
                  ? "border-indigo-300 shadow-[0_20px_50px_-24px_rgba(79,70,229,0.4)] ring-1 ring-indigo-200"
                  : "border-zinc-200"
              }`}
            >
              <div className="flex items-center gap-2.5">
                {/* Progress dots: how many of the three "hand-off" levels this mode fills */}
                <span className="flex gap-1" aria-hidden="true">
                  {[1, 2, 3].map((dot) => (
                    <span
                      key={dot}
                      className={`h-1.5 w-1.5 rounded-full ${dot <= n ? "bg-indigo-600" : "bg-zinc-200"}`}
                    />
                  ))}
                </span>
                <h3 className="text-base font-bold text-zinc-900">{t(`mode${n}Name`)}</h3>
                {highlighted ? (
                  <span className="ml-auto rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-600">
                    {t("defaultLabel")}
                  </span>
                ) : null}
              </div>
              <p className="mt-3 text-sm leading-relaxed text-zinc-500">{t(`mode${n}Body`)}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
