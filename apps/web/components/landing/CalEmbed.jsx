"use client";

import Cal from "@calcom/embed-react";

// Booking link, without the host: "<team-or-user>/<event-slug>".
const CAL_LINK = process.env.NEXT_PUBLIC_CAL_LINK || "";
// Only needed when the booking page isn't on cal.com — e.g. Cal's EU instance
// (https://cal.eu) or a self-hosted one. Left empty, the embed defaults to
// cal.com. When it is set we also load embed.js from that host, otherwise the
// embed script still comes from cal.com and can't resolve the booking page.
const CAL_ORIGIN = process.env.NEXT_PUBLIC_CAL_ORIGIN || "";

// Inline Cal booking. Uden et link vises fallback-anker i stedet
// (deploy må aldrig vise en tom boks).
export default function CalEmbed({ fallbackLabel }) {
  if (!CAL_LINK) {
    return (
      <a
        href="mailto:hello@sona.ai?subject=Demo"
        className="inline-block rounded-lg bg-white px-6 py-3 text-sm font-semibold text-zinc-950 hover:bg-zinc-100"
      >
        {fallbackLabel}
      </a>
    );
  }

  const originProps = CAL_ORIGIN
    ? { calOrigin: CAL_ORIGIN, embedJsUrl: `${CAL_ORIGIN}/embed/embed.js` }
    : {};

  return (
    <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl bg-white">
      <Cal
        calLink={CAL_LINK}
        {...originProps}
        config={{ theme: "light" }}
        style={{ width: "100%", height: "560px" }}
      />
    </div>
  );
}
