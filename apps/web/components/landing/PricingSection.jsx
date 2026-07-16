import { getTranslations } from "next-intl/server";
import { PRICING_TIERS, formatTierPrice } from "@/lib/landing/pricing";
import SectionHeading from "./SectionHeading";
import Reveal from "./Reveal";
import { CheckIcon } from "./icons";

export default async function PricingSection({ locale }) {
  const t = await getTranslations("landing.pricing");
  const countFmt = new Intl.NumberFormat(locale === "da" ? "da-DK" : "en-IE");
  return (
    <section id="pricing" className="border-t border-zinc-100 bg-zinc-50 px-5 py-24">
      <div className="mx-auto max-w-6xl">
        <SectionHeading kicker={t("kicker")} title={t("title")} subtitle={t("subtitle")} />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PRICING_TIERS.map((tier, i) => (
            <Reveal
              key={tier.id}
              delay={i * 70}
              className={`relative rounded-2xl border bg-white p-6 text-left transition-shadow duration-300 ${
                tier.highlighted
                  ? "border-indigo-300 shadow-[0_20px_50px_-24px_rgba(79,70,229,0.5)] ring-1 ring-indigo-200"
                  : "border-zinc-200 hover:shadow-[0_12px_40px_-20px_rgba(0,0,0,0.15)]"
              }`}
            >
              {tier.highlighted ? (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-indigo-600 px-3 py-0.5 text-[11px] font-semibold text-white shadow-sm">
                  {t("mostPopular")}
                </span>
              ) : null}
              <h3 className="text-sm font-bold text-zinc-900">{t(tier.nameKey)}</h3>
              <p className="mt-3 text-3xl font-bold tracking-tight text-zinc-950">
                {formatTierPrice(tier, locale)}
                <span className="text-sm font-normal text-zinc-400">{t("perMonth")}</span>
              </p>
              <p className="mt-1 text-xs text-zinc-500">{t("ticketsLabel", { count: countFmt.format(tier.tickets) })}</p>
              <ul className="mt-4 space-y-2">
                {["feature1", "feature2", "feature3"].map((f) => (
                  <li key={f} className="flex items-center gap-2 text-xs text-zinc-600">
                    <CheckIcon /> {t(f)}
                  </li>
                ))}
              </ul>
              <a
                href="#book-demo"
                className={`mt-6 block rounded-lg py-2.5 text-center text-sm font-semibold transition-all duration-200 active:scale-[0.98] ${
                  tier.highlighted
                    ? "bg-indigo-600 text-white hover:bg-indigo-500"
                    : "border border-zinc-200 text-zinc-900 hover:bg-zinc-50"
                }`}
              >
                {t("cta")}
              </a>
            </Reveal>
          ))}
        </div>
        <p className="mt-8 text-center text-xs text-zinc-500">{t("pilotNote")} · {t("enterprise")}</p>
      </div>
    </section>
  );
}
