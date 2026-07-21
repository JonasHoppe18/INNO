import LandingNav from "./LandingNav";
import LandingFooter from "./LandingFooter";

// Shared chrome for standalone marketing pages (demo, security, integrations,
// legal): the nav on top, the page content, and the dark footer band. Keeps
// every sub-page consistent without repeating the layout.
export default function MarketingShell({ locale, children }) {
  return (
    <main className="min-h-screen bg-white text-zinc-900">
      <LandingNav locale={locale} />
      {children}
      <div className="bg-zinc-950 px-5 pt-16">
        <div className="mx-auto max-w-4xl">
          <LandingFooter locale={locale} />
        </div>
      </div>
    </main>
  );
}
