import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { integrationsByStatus } from "@/lib/landing/integrations";
import Reveal from "./Reveal";

// The row renders only what actually works (status: "available") — see
// lib/landing/integrations.js for the single source of truth. Roadmap items
// live on the /integrations page, clearly marked as coming soon.
export default async function IntegrationsSection({ locale }) {
  const t = await getTranslations("landing.integrations");
  const available = integrationsByStatus("available");
  return (
    <section className="px-5 py-20 text-center">
      <Reveal>
        <p className="text-sm text-zinc-500">{t("title")}</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
          {available.map(({ id, name }) => (
            <span
              key={id}
              className="text-base font-bold tracking-tight text-zinc-400 transition-colors duration-200 hover:text-zinc-700"
            >
              {name}
            </span>
          ))}
          <Link
            href={`/${locale}/integrations`}
            className="text-sm text-indigo-600 transition-colors hover:text-indigo-700"
          >
            + {t("moreSoon")}
          </Link>
        </div>
      </Reveal>
    </section>
  );
}
