import { unstable_setRequestLocale } from "next-intl/server";
import LandingNav from "@/components/landing/LandingNav";
import Hero from "@/components/landing/Hero";
import DemoInbox from "@/components/landing/demo-inbox/DemoInbox";
import HowItWorks from "@/components/landing/HowItWorks";
import TrustStrip from "@/components/landing/TrustStrip";
import ExploreProduct from "@/components/landing/ExploreProduct";
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

// Lean homepage: hook (hero + interactive demo) → the fast "what is this"
// (how it works) → a compact trust strip → cards into the deeper pages →
// pricing → book a demo. Product depth lives on /product.
export default async function LandingPage({ params: { locale } }) {
  unstable_setRequestLocale(locale);
  return (
    <main className="min-h-screen bg-white text-zinc-900">
      <LandingNav locale={locale} />
      <Hero locale={locale}>
        <DemoInbox />
      </Hero>
      <HowItWorks />
      <TrustStrip locale={locale} />
      <ExploreProduct locale={locale} />
      <PricingSection locale={locale} />
      <FinalCta locale={locale} />
    </main>
  );
}
