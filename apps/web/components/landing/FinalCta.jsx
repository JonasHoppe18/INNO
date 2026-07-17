import { getTranslations } from "next-intl/server";
import BookDemoButton from "./BookDemoButton";
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
        <Reveal delay={100} className="mt-9 flex flex-col items-center gap-5">
          <BookDemoButton
            label={t("ctaDemo")}
            className="rounded-lg bg-white px-6 py-3 text-sm font-semibold text-zinc-950 shadow-lg transition-all duration-200 hover:bg-zinc-100 active:scale-[0.97]"
          />
          <SignupForm source="landing-footer" variant="dark" />
        </Reveal>
        <div className="mt-16">
          <LandingFooter locale={locale} />
        </div>
      </div>
    </section>
  );
}
