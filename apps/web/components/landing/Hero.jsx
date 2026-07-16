import Link from "next/link";
import { getTranslations } from "next-intl/server";
import SignupForm from "./SignupForm";
import Reveal from "./Reveal";
import { CheckIcon } from "./icons";

export default async function Hero({ locale, children }) {
  const t = await getTranslations("landing.hero");
  const tDemo = await getTranslations("landing.demo");
  return (
    <section id="product" className="relative overflow-hidden px-5 pt-24 text-center">
      <div
        className="landing-enter mx-auto inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-600"
        style={{ "--enter-delay": "0ms" }}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-indigo-600" />
        {t("badge")}
      </div>
      <h1
        className="landing-enter mx-auto mt-6 max-w-3xl text-balance text-4xl font-bold leading-[1.05] tracking-[-0.035em] text-zinc-950 sm:text-6xl"
        style={{ "--enter-delay": "70ms" }}
      >
        {t("titleLine1")}
        <br />
        <span className="bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
          {t("titleLine2")}
        </span>
      </h1>
      <p
        className="landing-enter mx-auto mt-5 max-w-xl text-base leading-relaxed text-zinc-600 sm:text-lg"
        style={{ "--enter-delay": "140ms" }}
      >
        {t("subtitle")}
      </p>
      <div
        className="landing-enter mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
        style={{ "--enter-delay": "210ms" }}
      >
        <a
          href="#book-demo"
          className="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition-all duration-200 hover:bg-indigo-500 active:scale-[0.97]"
        >
          {t("ctaDemo")}
        </a>
        <SignupForm source="landing-hero" />
      </div>
      <div
        className="landing-enter mt-5 flex justify-center"
        style={{ "--enter-delay": "280ms" }}
      >
        <Link
          href={`/${locale}/demo`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 transition-colors hover:text-indigo-700"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <circle cx="7" cy="7" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <path d="M5.6 4.5v5l4-2.5-4-2.5z" fill="currentColor" />
          </svg>
          {tDemo("watchLink")}
        </Link>
      </div>

      {/* Interactive product demo, with a soft glow behind it. */}
      <Reveal className="relative mx-auto mt-14 max-w-5xl" delay={120}>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 top-16 bg-[radial-gradient(ellipse_at_50%_55%,rgba(99,102,241,0.16),rgba(147,51,234,0.07)_55%,transparent_80%)]"
        />
        <div className="relative">{children}</div>
      </Reveal>

      {/* Trust signals — moved below the demo so the top stays uncluttered. */}
      <ul className="mx-auto mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-zinc-500">
        {["trust1", "trust2", "trust3"].map((key) => (
          <li key={key} className="flex items-center gap-1.5">
            <CheckIcon /> {t(key)}
          </li>
        ))}
      </ul>

      <div className="h-24" />
    </section>
  );
}
