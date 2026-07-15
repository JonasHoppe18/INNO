import { getTranslations } from "next-intl/server";
import CalEmbed from "./CalEmbed";
import SignupForm from "./SignupForm";
import LandingFooter from "./LandingFooter";

export default async function FinalCta({ locale }) {
  const t = await getTranslations("landing.finalCta");
  return (
    <section id="book-demo" className="relative overflow-hidden bg-zinc-950 px-5 pt-20">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[32rem] -translate-x-1/2 bg-[radial-gradient(ellipse,rgba(99,102,241,0.35),transparent_70%)]"
      />
      <div className="relative mx-auto max-w-4xl text-center">
        <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">{t("title")}</h2>
        <p className="mt-3 text-sm text-zinc-400">{t("subtitle")}</p>
        <div className="mt-8">
          <CalEmbed fallbackLabel={t("ctaDemo")} />
        </div>
        <div className="mt-8 flex justify-center">
          <SignupForm source="landing-footer" variant="dark" />
        </div>
        <div className="mt-14">
          <LandingFooter locale={locale} />
        </div>
      </div>
    </section>
  );
}
