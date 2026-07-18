import { getTranslations } from "next-intl/server";
import SectionHeading from "./SectionHeading";
import Reveal from "./Reveal";

const ICONS = {
  1: "M2.5 4.5h13v9h-13v-9zM2.5 7.5h13M6 4.5V3.2M12 4.5V3.2",
  2: "M10 2L3 10.5h5L8 16l7-8.5h-5L10 2z",
  3: "M9 2.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM2.5 9h13M9 2.5c2.2 2.4 2.2 10.6 0 13M9 2.5c-2.2 2.4-2.2 10.6 0 13",
  4: "M5 2.5h6L14 5.5v10h-9v-13zM11 2.5V5.5h3M7 9h5M7 12h5",
  5: "M9 6a3 3 0 100 6 3 3 0 000-6zM9 2v1.5M9 14.5V16M2 9h1.5M14.5 9H16",
  6: "M2.5 15V9.5M6.5 15V6M10.5 15V3M14.5 15V7.5",
};

export default async function CapabilitiesGrid() {
  const t = await getTranslations("landing.capabilities");
  const caps = [1, 2, 3, 4, 5, 6];
  return (
    <section className="px-5 py-24">
      <div className="mx-auto max-w-5xl">
        <SectionHeading kicker={t("kicker")} title={t("title")} />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {caps.map((n, i) => (
            <Reveal
              key={n}
              delay={(i % 3) * 70}
              className="rounded-2xl border border-zinc-200 bg-white p-6"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                  <path d={ICONS[n]} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h3 className="mt-4 text-sm font-bold text-zinc-900">{t(`cap${n}Title`)}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">{t(`cap${n}Body`)}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
