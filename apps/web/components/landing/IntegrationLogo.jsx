import Image from "next/image";
import shopifyLogo from "../../../../assets/Shopify-Logo.png";
import webshipperLogo from "../../../../assets/Webshipper_logo.png";
import zendeskLogo from "../../../../assets/Zendesk_logo.webp";

// Real brand assets we already ship in the product (same files the dashboard
// connect cards use). Only the ones we actually have — no hand-drawn marks.
const LOGOS = {
  shopify: shopifyLogo,
  webshipper: webshipperLogo,
  zendesk: zendeskLogo,
};

// Brand-tinted lettermark fallback for integrations we don't ship a logo asset
// for yet. Approximate brand hues — deliberate placeholders, not the real mark.
const FALLBACK = {
  woocommerce: { initial: "W", className: "bg-[#7f54b3]" },
  magento: { initial: "M", className: "bg-[#f26322]" },
};

function MailGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="#6366f1" strokeWidth="1.7" />
      <path d="M4 7l8 6 8-6" stroke="#6366f1" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// A 40×40 logo tile: the real brand image when we have it, a mail glyph for the
// generic Email connector, or a tinted lettermark otherwise.
export default function IntegrationLogo({ id, name }) {
  const logo = LOGOS[id];
  if (logo) {
    return (
      <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <Image src={logo} alt={`${name} logo`} fill sizes="40px" className="object-contain p-1.5" />
      </span>
    );
  }
  if (id === "email") {
    return (
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white">
        <MailGlyph />
      </span>
    );
  }
  const fb = FALLBACK[id] || { initial: (name?.[0] || "?").toUpperCase(), className: "bg-zinc-400" };
  return (
    <span
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-base font-bold text-white ${fb.className}`}
    >
      {fb.initial}
    </span>
  );
}
