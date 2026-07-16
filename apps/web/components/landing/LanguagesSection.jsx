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
    <section className="border-t border-zinc-100 bg-zinc-50 px-5 py-24">
      <div className="mx-auto max-w-5xl">
        <SectionHeading kicker={t("kicker")} title={t("title")} subtitle={t("body")} />
        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          {SAMPLES.map(({ lang, text }, i) => (
            <Reveal
              key={lang}
              delay={i * 80}
              className="rounded-2xl border border-zinc-200 bg-white p-5 text-left"
            >
              <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{lang}</p>
              <p className="mt-2 text-sm leading-relaxed text-zinc-700">{text}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
