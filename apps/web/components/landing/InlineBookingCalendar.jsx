"use client";

import Cal from "@calcom/embed-react";
import { CONTACT_EMAIL } from "@/lib/landing/contact";

// Same env contract as BookDemoButton (NEXT_PUBLIC_CAL_LINK / _ORIGIN), but
// rendered inline instead of as a popup. Scoped to the /product closing
// section: everywhere else on the site keeps the popup pattern — an inline
// calendar full-width on a page previously read as an awkward, oversized
// block, but constrained to one column of a two-column layout it reads fine.
const CAL_LINK = process.env.NEXT_PUBLIC_CAL_LINK || "";
const CAL_ORIGIN = process.env.NEXT_PUBLIC_CAL_ORIGIN || "";

export default function InlineBookingCalendar({ fallbackLabel, fallbackHref }) {
  if (!CAL_LINK) {
    return (
      <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-sm text-zinc-500">{fallbackLabel}</p>
        <a
          href={fallbackHref || `mailto:${CONTACT_EMAIL}?subject=Demo`}
          className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-indigo-500 active:scale-[0.97]"
        >
          {fallbackLabel}
        </a>
      </div>
    );
  }

  const originProps = CAL_ORIGIN
    ? { calOrigin: CAL_ORIGIN, embedJsUrl: `${CAL_ORIGIN}/embed/embed.js` }
    : {};

  return (
    <Cal
      calLink={CAL_LINK}
      {...originProps}
      config={{ theme: "light" }}
      style={{ width: "100%", minHeight: "560px" }}
    />
  );
}
