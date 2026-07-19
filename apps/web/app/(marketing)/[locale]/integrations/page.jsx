import { getTranslations, unstable_setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { integrationsByStatus, integrationBodyKey } from "@/lib/landing/integrations";
import MarketingShell from "@/components/landing/MarketingShell";
import SectionHeading from "@/components/landing/SectionHeading";
import Reveal from "@/components/landing/Reveal";
import { marketingMetadata } from "@/lib/landing/metadata";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params: { locale } }) {
  const t = await getTranslations({ locale, namespace: "landing.integrationsPage" });
  return marketingMetadata({
    locale,
    path: "/integrations",
    title: `Sona — ${t("title")}`,
    description: t("subtitle"),
  });
}

function IntegrationCard({ name, categoryLabel, body, comingSoon, comingSoonLabel }) {
  return (
    <div
      className={`rounded-2xl border p-6 ${
        comingSoon ? "border-dashed border-zinc-200 bg-zinc-50/60" : "border-zinc-200 bg-white"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-base font-bold tracking-tight text-zinc-900">{name}</span>
        {comingSoon ? (
          <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-500">
            {comingSoonLabel}
          </span>
        ) : (
          <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-indigo-600">
            {categoryLabel}
          </span>
        )}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-zinc-500">{body}</p>
    </div>
  );
}

export default async function IntegrationsPage({ params: { locale } }) {
  unstable_setRequestLocale(locale);
  const t = await getTranslations("landing.integrationsPage");

  const available = integrationsByStatus("available");
  const roadmap = integrationsByStatus("roadmap");

  return (
    <MarketingShell locale={locale}>
      <section className="px-5 pt-20 pb-24">
        <div className="mx-auto max-w-4xl">
          <SectionHeading title={t("title")} subtitle={t("subtitle")} />

          <Reveal className="mt-12">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-indigo-600">
              {t("availableKicker")}
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {available.map((integration) => (
                <IntegrationCard
                  key={integration.id}
                  name={integration.name}
                  categoryLabel={t(integration.category)}
                  body={t(integrationBodyKey(integration))}
                />
              ))}
            </div>
          </Reveal>

          {roadmap.length ? (
            <Reveal delay={80} className="mt-12">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-400">
                {t("roadmapKicker")}
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                {roadmap.map((integration) => (
                  <IntegrationCard
                    key={integration.id}
                    name={integration.name}
                    body={t(integrationBodyKey(integration))}
                    comingSoon
                    comingSoonLabel={t("roadmapLabel")}
                  />
                ))}
              </div>
            </Reveal>
          ) : null}

          {/* Demand capture: a mailto for now — swap for a form once there's an
              endpoint that can store the requested platform. */}
          <Reveal delay={80} className="mt-12 rounded-2xl border border-zinc-200 bg-zinc-50 p-8 text-center">
            <h2 className="text-xl font-bold tracking-tight text-zinc-950">{t("requestTitle")}</h2>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-zinc-500">
              {t("requestBody")}
            </p>
            <a
              href={`mailto:hello@sona-ai.dk?subject=${encodeURIComponent(t("requestCta"))}`}
              className="mt-5 inline-block rounded-lg border border-zinc-200 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-900 transition-all duration-200 hover:bg-zinc-50 active:scale-[0.97]"
            >
              {t("requestCta")}
            </a>
          </Reveal>

          <Reveal delay={80} className="mt-10 text-center">
            <a
              href={`/${locale}#book-demo`}
              className="inline-block rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition-all duration-200 hover:bg-indigo-500 active:scale-[0.97]"
            >
              {t("cta")}
            </a>
          </Reveal>
        </div>
      </section>
    </MarketingShell>
  );
}
