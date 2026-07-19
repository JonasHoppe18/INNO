import { unstable_setRequestLocale } from "next-intl/server";
import { marketingMetadata } from "@/lib/landing/metadata";
import LandingNav from "@/components/landing/LandingNav";
import Hero from "@/components/landing/Hero";
import DemoInbox from "@/components/landing/demo-inbox/DemoInbox";
import HowItWorks from "@/components/landing/HowItWorks";
import FeatureDives from "@/components/landing/FeatureDives";
import LanguagesSection from "@/components/landing/LanguagesSection";
import PricingSection from "@/components/landing/PricingSection";
import FaqSection from "@/components/landing/FaqSection";
import TrustStrip from "@/components/landing/TrustStrip";
import FinalCta from "@/components/landing/FinalCta";

export async function generateMetadata({ params: { locale } }) {
  const isDa = locale === "da";
  return marketingMetadata({
    locale,
    title: isDa
      ? "Sona — AI-support til webshops. Du beholder kontrollen."
      : "Sona — AI support for webshops. You stay in control.",
    description: isDa
      ? "Sona læser hver kundemail, slår ordren op i din butik og skriver det rigtige svar — klar til godkendelse med ét klik."
      : "Sona reads every customer email, looks up the order in your store, and drafts the right reply — ready for one-click approval.",
  });
}

// Homepage: the interactive demo shows Sona working, then how-it-works, then
// what it actually does (grounded answers, real store actions, every language),
// pricing, objection-handling FAQ, a trust strip, and book-a-demo. The deepest
// detail (problem framing, the three control modes) lives on /product, reachable
// from the nav.
export default async function LandingPage({ params: { locale } }) {
  unstable_setRequestLocale(locale);
  return (
    <main className="min-h-screen bg-white text-zinc-900">
      <LandingNav locale={locale} />
      <Hero locale={locale}>
        <DemoInbox />
      </Hero>
      <HowItWorks />
      <FeatureDives />
      <LanguagesSection />
      <PricingSection locale={locale} />
      <FaqSection />
      {/* Trust signals sit right before the ask — reassure, then book. */}
      <TrustStrip locale={locale} />
      <FinalCta locale={locale} />
    </main>
  );
}
