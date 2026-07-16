import { getTranslations, unstable_setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import MarketingShell from "@/components/landing/MarketingShell";
import SectionHeading from "@/components/landing/SectionHeading";
import Reveal from "@/components/landing/Reveal";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params: { locale } }) {
  const t = await getTranslations({ locale, namespace: "landing.integrationsPage" });
  return {
    title: `Sona — ${t("title")}`,
    description: t("subtitle"),
    alternates: { canonical: `/${locale}/integrations`, languages: { en: "/en/integrations", da: "/da/integrations" } },
  };
}

function IntegrationCard({ name, category, body, comingSoon, comingSoonLabel }) {
  return (
    <div className={`rounded-2xl border p-6 ${comingSoon ? "border-dashed border-zinc-200 bg-zinc-50/60" : "border-zinc-200 bg-white"}`}>
      <div className="flex items-center justify-between">
        <span className="text-base font-bold tracking-tight text-zinc-900">{name}</span>
        {comingSoon ? (
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-500">{comingSoonLabel}</span>
        ) : (
          <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600">{category}</span>
        )}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-zinc-500">{body}</p>
    </div>
  );
}

export default async function IntegrationsPage({ params: { locale } }) {
  unstable_setRequestLocale(locale);
  const t = await getTranslations("landing.integrationsPage");

  const available = [
    { name: "Shopify", category: t("ecommerce"), body: t("shopifyBody") },
    { name: t("email"), category: t("email"), body: t("emailBody") },
    { name: "Zendesk", category: t("helpdesk"), body: t("zendeskBody") },
  ];
  const roadmap = [
    { name: "WooCommerce", body: t("wooBody") },
    { name: "Magento", body: t("magentoBody") },
    { name: "…", body: t("moreBody") },
  ];

  return (
    <MarketingShell locale={locale}>
      <section className="px-5 pt-20 pb-24">
        <div className="mx-auto max-w-4xl">
          <SectionHeading title={t("title")} subtitle={t("subtitle")} />

          <Reveal className="mt-12">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-indigo-600">{t("availableKicker")}</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {available.map((it) => (
                <IntegrationCard key={it.name} {...it} />
              ))}
            </div>
          </Reveal>

          <Reveal delay={80} className="mt-12">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-400">{t("roadmapKicker")}</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {roadmap.map((it) => (
                <IntegrationCard key={it.name} {...it} comingSoon comingSoonLabel={t("roadmapLabel")} />
              ))}
            </div>
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
