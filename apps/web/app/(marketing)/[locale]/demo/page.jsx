import Link from "next/link";
import { getTranslations, unstable_setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import LandingNav from "@/components/landing/LandingNav";
import LandingFooter from "@/components/landing/LandingFooter";
import VideoEmbed from "@/components/landing/VideoEmbed";
import Reveal from "@/components/landing/Reveal";
import { marketingMetadata } from "@/lib/landing/metadata";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params: { locale } }) {
  const isDa = locale === "da";
  return marketingMetadata({
    locale,
    path: "/demo",
    title: isDa ? "Se Sona i aktion — demo" : "See Sona in action — demo",
    description: isDa
      ? "En kort gennemgang af hvordan Sona læser en ticket, finder ordren og skriver svaret, du godkender."
      : "A short walkthrough of how Sona reads a ticket, finds the order, and drafts the reply you approve.",
  });
}

export default async function DemoPage({ params: { locale } }) {
  unstable_setRequestLocale(locale);
  const t = await getTranslations("landing.demo");

  return (
    <main className="min-h-screen bg-white text-zinc-900">
      <LandingNav locale={locale} />

      <section className="px-5 pt-20 pb-24">
        <div className="mx-auto max-w-3xl text-center">
          <Reveal>
            <h1 className="text-balance text-4xl font-bold tracking-[-0.03em] text-zinc-950 sm:text-5xl">
              {t("title")}
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-zinc-600 sm:text-lg">
              {t("subtitle")}
            </p>
          </Reveal>
        </div>

        <Reveal delay={120} className="mx-auto mt-12 max-w-4xl">
          <VideoEmbed
            placeholderTitle={t("placeholderTitle")}
            placeholderBody={t("placeholderBody")}
            bookCta={t("bookCta")}
            bookHref={`/${locale}#book-demo`}
          />
        </Reveal>

        <Reveal delay={80} className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <a
            href={`/${locale}#book-demo`}
            className="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition-all duration-200 hover:bg-indigo-500 active:scale-[0.97]"
          >
            {t("bookCta")}
          </a>
          <Link
            href={`/${locale}#product`}
            className="text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900"
          >
            {t("tryInteractive")} →
          </Link>
        </Reveal>
      </section>

      <div className="bg-zinc-950 px-5 pt-16">
        <div className="mx-auto max-w-4xl">
          <LandingFooter locale={locale} />
        </div>
      </div>
    </main>
  );
}
