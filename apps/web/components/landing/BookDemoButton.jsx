"use client";

import { useEffect } from "react";
import { getCalApi } from "@calcom/embed-react";
import { CONTACT_EMAIL } from "@/lib/landing/contact";

// Booking config. NEXT_PUBLIC_CAL_LINK is "<team-or-user>/<event-slug>";
// NEXT_PUBLIC_CAL_ORIGIN is only needed when the booking page isn't on cal.com
// (e.g. Cal's EU instance, https://cal.eu). Both are baked in at build time.
const CAL_LINK = process.env.NEXT_PUBLIC_CAL_LINK || "";
const CAL_ORIGIN = process.env.NEXT_PUBLIC_CAL_ORIGIN || "";
const NAMESPACE = "sona-demo";

// "Book a demo" as a popup: clicking opens the Cal calendar in an overlay
// instead of embedding the whole calendar inline on the page. Keeps the page
// short and the booking one click away. Without a configured link it degrades
// to a plain link (mailto, or a caller-provided href).
export default function BookDemoButton({ label, className, fallbackHref }) {
  useEffect(() => {
    if (!CAL_LINK) return;
    let cancelled = false;
    (async () => {
      const cal = await getCalApi({
        namespace: NAMESPACE,
        ...(CAL_ORIGIN ? { embedJsUrl: `${CAL_ORIGIN}/embed/embed.js` } : {}),
      });
      if (cancelled) return;
      cal("ui", { theme: "light", hideEventTypeDetails: false });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!CAL_LINK) {
    return (
      <a href={fallbackHref || `mailto:${CONTACT_EMAIL}?subject=Demo`} className={className}>
        {label}
      </a>
    );
  }

  return (
    <button
      type="button"
      className={className}
      data-cal-namespace={NAMESPACE}
      data-cal-link={CAL_LINK}
      data-cal-config='{"theme":"light"}'
      {...(CAL_ORIGIN ? { "data-cal-origin": CAL_ORIGIN } : {})}
    >
      {label}
    </button>
  );
}
