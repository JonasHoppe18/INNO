import { getTranslations } from "next-intl/server";
import SectionHeading from "./SectionHeading";
import Reveal from "./Reveal";

// Samme svar på tre sprog — demo-indhold, bevidst ikke i messages-filerne.
const SAMPLES = [
  { lang: "Dansk", text: "Hej Sofia, din nye vase er afsendt i dag — beklager besværet!" },
  { lang: "Deutsch", text: "Hallo Sofia, deine neue Vase wurde heute versandt — entschuldige die Umstände!" },
  { lang: "Italiano", text: "Ciao Sofia, il tuo nuovo vaso è stato spedito oggi — scusa il disagio!" },
];

export default async function LanguagesSection() {
  const t = await getTranslations("landing.languages");
  return (
    <section className="relative overflow-hidden bg-zinc-950 px-5 py-24">
      {/* Spotlight glow — a dark band mid-page breaks the light run and gives
          the "answers in every language" moment room to feel premium. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 left-1/2 h-72 w-[40rem] -translate-x-1/2 bg-[radial-gradient(ellipse,rgba(99,102,241,0.28),transparent_70%)]"
      />
      <div className="relative mx-auto max-w-5xl">
        <SectionHeading tone="dark" kicker={t("kicker")} title={t("title")} subtitle={t("body")} />
        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          {SAMPLES.map(({ lang, text }, i) => (
            <Reveal
              key={lang}
              delay={i * 80}
              className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-left shadow-[0_20px_60px_-30px_rgba(99,102,241,0.6)] backdrop-blur-sm transition-colors duration-300 hover:border-white/20 hover:bg-white/[0.07]"
            >
              <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-300/80">{lang}</p>
              <p className="mt-2 text-sm leading-relaxed text-zinc-300">{text}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
