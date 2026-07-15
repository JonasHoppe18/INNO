import { getTranslations } from "next-intl/server";

// Samme svar på tre sprog — demo-indhold, bevidst ikke i messages-filerne.
const SAMPLES = [
  { lang: "Dansk", text: "Hej Sofia, din nye vase er afsendt i dag — beklager besværet!" },
  { lang: "Deutsch", text: "Hallo Sofia, deine neue Vase wurde heute versandt — entschuldige die Umstände!" },
  { lang: "Italiano", text: "Ciao Sofia, il tuo nuovo vaso è stato spedito oggi — scusa il disagio!" },
];

export default async function LanguagesSection() {
  const t = await getTranslations("landing.languages");
  return (
    <section className="border-t border-zinc-100 bg-zinc-50 px-5 py-20">
      <div className="mx-auto max-w-5xl text-center">
        <p className="text-xs font-bold tracking-[0.1em] text-indigo-600">{t("kicker")}</p>
        <h2 className="mt-2 text-3xl font-bold tracking-tight text-zinc-950">{t("title")}</h2>
        <p className="mx-auto mt-3 max-w-lg text-sm text-zinc-600">{t("body")}</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {SAMPLES.map(({ lang, text }) => (
            <div key={lang} className="rounded-xl border border-zinc-200 bg-white p-4 text-left">
              <p className="text-[10px] font-bold tracking-wider text-zinc-400">{lang.toUpperCase()}</p>
              <p className="mt-2 text-sm leading-relaxed text-zinc-700">{text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
