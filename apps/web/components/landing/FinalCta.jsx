import { getTranslations } from "next-intl/server";
import CalEmbed from "./CalEmbed";
import SignupForm from "./SignupForm";
import LandingFooter from "./LandingFooter";
import Reveal from "./Reveal";

export default async function FinalCta({ locale }) {
  const t = await getTranslations("landing.finalCta");
  return (
    <section id="book-demo" className="relative overflow-hidden bg-zinc-950 px-5 pt-24">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[32rem] -translate-x-1/2 bg-[radial-gradient(ellipse,rgba(99,102,241,0.35),transparent_70%)]"
      />
      <div className="relative mx-auto max-w-4xl text-center">
        <Reveal>
          <h2 className="text-balance text-3xl font-bold tracking-tight text-white sm:text-4xl">{t("title")}</h2>
          <p className="mx-auto mt-3.5 max-w-lg text-base text-zinc-400">{t("subtitle")}</p>
        </Reveal>
        <Reveal delay={100} className="mt-9">
          <CalEmbed fallbackLabel={t("ctaDemo")} />
        </Reveal>
        <div className="mt-8 flex justify-center">
          <SignupForm source="landing-footer" variant="dark" />
        </div>
        <div className="mt-16">
          <LandingFooter locale={locale} />
        </div>
      </div>
    </section>
  );
}
