import { getTranslations } from "next-intl/server";

export default async function FaqSection() {
  const t = await getTranslations("landing.faq");
  return (
    <section className="border-t border-zinc-100 bg-zinc-50 px-5 py-20">
      <div className="mx-auto max-w-2xl">
        <h2 className="text-center text-3xl font-bold tracking-tight text-zinc-950">{t("title")}</h2>
        <div className="mt-8 space-y-2.5">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <details key={n} className="group rounded-xl border border-zinc-200 bg-white px-5 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-zinc-900 [&::-webkit-details-marker]:hidden">
                {t(`q${n}`)}
                <svg width="12" height="12" viewBox="0 0 12 12" className="shrink-0 text-zinc-400 transition-transform group-open:rotate-45" aria-hidden="true">
                  <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-zinc-600">{t(`a${n}`)}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
