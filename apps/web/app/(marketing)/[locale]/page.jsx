import { unstable_setRequestLocale } from "next-intl/server";
import LandingNav from "@/components/landing/LandingNav";
import Hero from "@/components/landing/Hero";
import DemoInbox from "@/components/landing/demo-inbox/DemoInbox";
import HowItWorks from "@/components/landing/HowItWorks";
import FeatureDives from "@/components/landing/FeatureDives";
import LanguagesSection from "@/components/landing/LanguagesSection";
import ControlSection from "@/components/landing/ControlSection";
import PricingSection from "@/components/landing/PricingSection";
import IntegrationsSection from "@/components/landing/IntegrationsSection";
import FaqSection from "@/components/landing/FaqSection";
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
      <ControlSection />
      <PricingSection locale={locale} />
      <IntegrationsSection />
      <FaqSection />
      <FinalCta locale={locale} />
    </main>
  );
}
