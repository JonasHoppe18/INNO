import { getTranslations, unstable_setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import MarketingShell from "@/components/landing/MarketingShell";
import SectionHeading from "@/components/landing/SectionHeading";
import Reveal from "@/components/landing/Reveal";
import { marketingMetadata } from "@/lib/landing/metadata";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params: { locale } }) {
  const t = await getTranslations({ locale, namespace: "landing.security" });
  return marketingMetadata({
    locale,
    path: "/security",
    title: `Sona — ${t("title")}`,
    description: t("subtitle"),
  });
}

function RegionBadge({ region }) {
  const tone =
    region === "EU"
      ? "bg-emerald-50 text-emerald-700"
      : region === "US"
      ? "bg-zinc-100 text-zinc-600"
      : "bg-amber-50 text-amber-700";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{region}</span>;
}

export default async function SecurityPage({ params: { locale } }) {
  unstable_setRequestLocale(locale);
  const t = await getTranslations("landing.security");
  const points = [1, 2, 3, 4, 5];
  // Provider names are proper nouns (hardcoded); roles/regions are honest and
  // reviewed with the team.
  const subprocessors = [
    { name: "DigitalOcean", role: t("roleHosting"), region: "EU" },
    { name: "Supabase", role: t("roleDatabase"), region: "EU" },
    { name: "OpenAI", role: t("roleAi"), region: "US" },
    { name: "Postmark", role: t("roleEmail"), region: "EU" },
    { name: "Shopify", role: t("roleStore"), region: "—" },
    { name: "Clerk", role: t("roleAuth"), region: "US" },
  ];
  return (
    <MarketingShell locale={locale}>
      <section className="px-5 pt-20 pb-24">
        <div className="mx-auto max-w-4xl">
          <SectionHeading title={t("title")} subtitle={t("subtitle")} />
          <div className="mt-12 grid gap-4 sm:grid-cols-2">
            {points.map((n, i) => (
              <Reveal key={n} delay={i * 60} className="rounded-2xl border border-zinc-200 bg-white p-6">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M8 1.5l5 1.8v3.4c0 3.1-2.1 5.9-5 6.8-2.9-.9-5-3.7-5-6.8V3.3L8 1.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                    <path d="M5.8 7.8l1.5 1.5 2.9-3.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <h2 className="mt-4 text-base font-bold text-zinc-900">{t(`p${n}Title`)}</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">{t(`p${n}Body`)}</p>
              </Reveal>
            ))}
          </div>
          <Reveal delay={80} className="mt-12">
            <h2 className="text-xl font-bold tracking-tight text-zinc-950">{t("subTitle")}</h2>
            <p className="mt-2 text-sm text-zinc-500">{t("subIntro")}</p>
            <div className="mt-5 divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200">
              {subprocessors.map((s) => (
                <div key={s.name} className="flex items-center justify-between gap-4 px-5 py-3.5">
                  <div className="min-w-0">
                    <span className="text-sm font-semibold text-zinc-900">{s.name}</span>
                    <span className="ml-2 text-sm text-zinc-500">{s.role}</span>
                  </div>
                  <RegionBadge region={s.region} />
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-zinc-500">{t("aiNote")}</p>
          </Reveal>

          <Reveal delay={80} className="mt-8 rounded-2xl border border-zinc-200 bg-zinc-50 p-6 text-center">
            <p className="text-sm leading-relaxed text-zinc-600">{t("note")}</p>
            <a
              href={`/${locale}#book-demo`}
              className="mt-4 inline-block rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition-all duration-200 hover:bg-indigo-500 active:scale-[0.97]"
            >
              {t("cta")}
            </a>
          </Reveal>
        </div>
      </section>
    </MarketingShell>
  );
}
