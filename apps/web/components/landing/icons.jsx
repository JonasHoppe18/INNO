// Delte inline-SVG'er for landing-siden. Ingen emoji — kun stroke-ikoner.
export function SonaMark({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" stroke="#6366f1" strokeWidth="2.4" fill="none" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 11 11" aria-hidden="true">
      <circle cx="5.5" cy="5.5" r="5" fill="#eef2ff" />
      <path d="M3.4 5.6l1.4 1.4 2.8-3" stroke="#4f46e5" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
