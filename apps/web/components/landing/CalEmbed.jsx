"use client";

import Cal from "@calcom/embed-react";

const CAL_LINK = process.env.NEXT_PUBLIC_CAL_LINK || "";

// Inline Cal.com-booking. Uden env-link vises fallback-anker i stedet
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
  return (
    <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl bg-white">
      <Cal calLink={CAL_LINK} config={{ theme: "light" }} style={{ width: "100%", height: "560px" }} />
    </div>
  );
}
