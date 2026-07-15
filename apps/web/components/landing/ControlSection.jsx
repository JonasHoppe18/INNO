import { getTranslations } from "next-intl/server";

export default async function ControlSection() {
  const t = await getTranslations("landing.control");
  const toggles = [
    { n: 1, on: true },
    { n: 2, on: true },
    { n: 3, on: false },
  ];
  return (
    <section className="px-5 py-20">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-10 md:flex-row">
        <div className="flex-1">
          <p className="text-xs font-bold tracking-[0.1em] text-indigo-600">{t("kicker")}</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-zinc-950">{t("title")}</h2>
          <p className="mt-3 text-sm leading-relaxed text-zinc-600">{t("body")}</p>
        </div>
        <div className="w-full max-w-sm flex-1 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          {toggles.map(({ n, on }) => (
            <div key={n} className="flex items-center justify-between border-b border-zinc-50 py-3 last:border-0">
              <div>
                <p className="text-sm font-semibold text-zinc-900">{t(`toggle${n}Title`)}</p>
                <p className="text-xs text-zinc-400">{t(`toggle${n}Sub`)}</p>
              </div>
              <span className={`relative inline-block h-5 w-9 rounded-full ${on ? "bg-indigo-600" : "bg-zinc-200"}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white ${on ? "right-0.5" : "left-0.5"}`} />
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
