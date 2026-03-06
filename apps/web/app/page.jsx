import HeroSection from "@/components/hero-section";
import IntegrationsSection from "@/components/integrations-4";
import FAQsTwo from "@/components/faqs-2";
import ContentSection from "@/components/content-three";
import TrustLogos from "@/components/trust-logos";
import FeaturesGrid from "@/components/features-grid";
import Pricing from "@/components/pricing";
import FinalCta from "@/components/final-cta";
import FooterSection from "@/components/footer-four";

// Landing page viser TailArk-baseret hero og lader CTA'erne tage brugeren videre.
export default function HomePage() {
  return (
    <div className="dark relative min-h-screen overflow-hidden bg-slate-950 text-white">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_18%_20%,rgba(90,150,255,0.14),transparent_30%),radial-gradient(circle_at_82%_10%,rgba(56,189,248,0.12),transparent_32%),linear-gradient(180deg,#0b1220_0%,#060b14_100%)]" />
      <div className="relative z-10">
        {/* Hero + integrations section provides a fast intro to Sona */}
        <HeroSection />
        <TrustLogos />
        <ContentSection />
        <FeaturesGrid />
        <Pricing />
        <IntegrationsSection />
        <FAQsTwo />
        <FinalCta />
        <FooterSection />
      </div>
    </div>
  );
}
