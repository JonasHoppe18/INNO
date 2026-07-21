// Delte inline-SVG'er for landing-siden. Ingen emoji — kun stroke-ikoner.
// Brand-mærket bruger den rigtige, animerede SonaLogo (components/ui/SonaLogo)
// — ikke et separat statisk mærke — se LandingNav/LandingFooter.

export function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 11 11" aria-hidden="true">
      <circle cx="5.5" cy="5.5" r="5" fill="#eef2ff" />
      <path d="M3.4 5.6l1.4 1.4 2.8-3" stroke="#4f46e5" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
