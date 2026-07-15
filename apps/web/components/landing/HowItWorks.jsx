import { getTranslations } from "next-intl/server";

export default async function HowItWorks() {
  const t = await getTranslations("landing.how");
  const steps = [1, 2, 3];
  return (
    <section id="how" className="border-t border-zinc-100 bg-zinc-50 px-5 py-20">
      <div className="mx-auto max-w-5xl">
        <p className="text-center text-xs font-bold tracking-[0.1em] text-indigo-600">{t("kicker")}</p>
        <h2 className="mt-2 text-center text-3xl font-bold tracking-tight text-zinc-950">{t("title")}</h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {steps.map((n) => (
            <div key={n} className="rounded-xl border border-zinc-200 bg-white p-6">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-sm font-bold text-indigo-600">{n}</div>
              <h3 className="mt-4 text-sm font-bold text-zinc-900">{t(`step${n}Title`)}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">{t(`step${n}Body`)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
