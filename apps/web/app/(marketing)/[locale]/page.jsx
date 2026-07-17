import Link from "next/link";
import { getTranslations, unstable_setRequestLocale } from "next-intl/server";
import LandingNav from "@/components/landing/LandingNav";
import Hero from "@/components/landing/Hero";
import DemoInbox from "@/components/landing/demo-inbox/DemoInbox";
import HowItWorks from "@/components/landing/HowItWorks";
import FeatureDives from "@/components/landing/FeatureDives";
import LanguagesSection from "@/components/landing/LanguagesSection";
import Reveal from "@/components/landing/Reveal";
import TrustStrip from "@/components/landing/TrustStrip";
import PricingSection from "@/components/landing/PricingSection";
import FinalCta from "@/components/landing/FinalCta";

export async function generateMetadata({ params: { locale } }) {
  const isDa = locale === "da";
  return {
    title: isDa
      ? "Sona — AI-support til webshops. Du godkender hvert svar."
      : "Sona — AI support for webshops. You approve every reply.",
    description: isDa
      ? "Sona læser hver kundemail, slår ordren op i din butik og skriver det rigtige svar — klar til godkendelse med ét klik."
      : "Sona reads every customer email, looks up the order in your store, and drafts the right reply — ready for one-click approval.",
    alternates: {
      canonical: `/${locale}`,
      languages: { en: "/en", da: "/da" },
    },
  };
}

// Homepage: it explains the product in full — the interactive demo shows Sona
// working, then how-it-works, then what it actually does (grounded answers,
// real store actions, every language), a trust strip, pricing, and book-a-demo.
// The deepest detail (problem framing, the three control modes, FAQ) lives on
// /product, reachable from the "see the full product" link and the nav.
export default async function LandingPage({ params: { locale } }) {
  unstable_setRequestLocale(locale);
  const t = await getTranslations("landing.productPage");
  return (
    <main className="min-h-screen bg-white text-zinc-900">
      <LandingNav locale={locale} />
      <Hero locale={locale}>
        <DemoInbox />
      </Hero>
      <HowItWorks />
      <FeatureDives />
      <LanguagesSection />
      <Reveal className="px-5 pb-8 text-center">
        <Link
          href={`/${locale}/product`}
          className="text-sm font-semibold text-indigo-600 transition-colors hover:text-indigo-700"
        >
          {t("seeAll")} →
        </Link>
      </Reveal>
      <PricingSection locale={locale} />
      {/* Trust signals sit right before the ask — reassure, then book. */}
      <TrustStrip locale={locale} />
      <FinalCta locale={locale} />
    </main>
  );
}
