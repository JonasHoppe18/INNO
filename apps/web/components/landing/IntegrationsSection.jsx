import { getTranslations } from "next-intl/server";
import Reveal from "./Reveal";

const INTEGRATIONS = ["Shopify", "WooCommerce", "Magento", "Zendesk", "Gmail", "Outlook"];

export default async function IntegrationsSection() {
  const t = await getTranslations("landing.integrations");
  return (
    <section className="px-5 py-20 text-center">
      <Reveal>
        <p className="text-sm text-zinc-500">{t("title")}</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
          {INTEGRATIONS.map((name) => (
            <span
              key={name}
              className="text-base font-bold tracking-tight text-zinc-400 transition-colors duration-200 hover:text-zinc-700"
            >
              {name}
            </span>
          ))}
          <span className="text-sm text-zinc-400">+ {t("moreSoon")}</span>
        </div>
      </Reveal>
    </section>
  );
}
