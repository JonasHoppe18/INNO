import Link from "next/link";
import { getTranslations } from "next-intl/server";
import Reveal from "./Reveal";
import { CheckIcon } from "./icons";

// Compact one-row trust signal for the lean homepage. The full security story
// lives on /security (linked here).
export default async function TrustStrip({ locale }) {
  const t = await getTranslations("landing.trust");
  const items = ["pillar1Title", "pillar2Title", "pillar3Title"];
  return (
    <section className="px-5 py-12">
      <Reveal className="mx-auto flex max-w-4xl flex-col items-center gap-4 text-center">
        <ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-zinc-600">
          {items.map((key) => (
            <li key={key} className="flex items-center gap-2">
              <CheckIcon /> {t(key)}
            </li>
          ))}
        </ul>
        <Link
          href={`/${locale}/security`}
          className="text-sm font-medium text-indigo-600 transition-colors hover:text-indigo-700"
        >
          {t("securityLink")} →
        </Link>
      </Reveal>
    </section>
  );
}
