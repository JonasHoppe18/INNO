import { unstable_setRequestLocale } from "next-intl/server";
import LandingNav from "@/components/landing/LandingNav";
import Hero from "@/components/landing/Hero";
import DemoInbox from "@/components/landing/demo-inbox/DemoInbox";
import HowItWorks from "@/components/landing/HowItWorks";
import FeatureDives from "@/components/landing/FeatureDives";
import LanguagesSection from "@/components/landing/LanguagesSection";
import ControlSection from "@/components/landing/ControlSection";

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
    </main>
  );
}
