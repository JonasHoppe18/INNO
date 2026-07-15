import { getTranslations } from "next-intl/server";
import SignupForm from "./SignupForm";
import { CheckIcon } from "./icons";

export default async function Hero({ locale, children }) {
  const t = await getTranslations("landing.hero");
  return (
    <section id="product" className="relative overflow-hidden px-5 pt-20 text-center">
      <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-600">
        <span className="h-1.5 w-1.5 rounded-full bg-indigo-600" />
        {t("badge")}
      </div>
      <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-bold leading-[1.05] tracking-[-0.035em] text-zinc-950 sm:text-6xl">
        {t("titleLine1")}
        <br />
        <span className="bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
          {t("titleLine2")}
        </span>
      </h1>
      <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-zinc-600 sm:text-lg">{t("subtitle")}</p>
      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <a
          href="#book-demo"
          className="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 hover:bg-indigo-500"
        >
          {t("ctaDemo")}
        </a>
        <SignupForm source="landing-hero" />
      </div>
      <ul className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-zinc-500">
        {["trust1", "trust2", "trust3"].map((key) => (
          <li key={key} className="flex items-center gap-1.5">
            <CheckIcon /> {t(key)}
          </li>
        ))}
      </ul>
      {/* DemoInbox flyder ind her (Task 6) med glød bagved */}
      <div className="relative mt-14">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-[radial-gradient(ellipse_at_50%_100%,rgba(99,102,241,0.18),rgba(147,51,234,0.08)_55%,transparent_80%)]"
        />
        {children}
      </div>
    </section>
  );
}
