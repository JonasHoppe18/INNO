import Script from "next/script";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, unstable_setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// metadataBase makes the relative canonical/hreflang/OG URLs in
// lib/landing/metadata.js (and the opengraph-image file convention) resolve
// to absolute production URLs. APP_URL is set in env (https://sona-ai.dk).
export const metadata = {
  metadataBase: new URL(process.env.APP_URL || "https://sona-ai.dk"),
};

// Privacy-friendly analytics (Plausible), marketing pages only — inactive
// until NEXT_PUBLIC_PLAUSIBLE_DOMAIN is set (e.g. "sona-ai.dk"), so nothing
// loads or phones home before the account exists. Self-hosted/EU proxy can be
// pointed at via NEXT_PUBLIC_PLAUSIBLE_SRC if we ever move off plausible.io.
const PLAUSIBLE_DOMAIN = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN || "";
const PLAUSIBLE_SRC =
  process.env.NEXT_PUBLIC_PLAUSIBLE_SRC || "https://plausible.io/js/script.js";

// Marketing-gruppen: leverer messages til client-øer. Root-layoutet ejer <html>.
export default async function MarketingLayout({ children, params: { locale } }) {
  unstable_setRequestLocale(locale);
  const messages = await getMessages();
  return (
    <NextIntlClientProvider messages={messages}>
      {children}
      {PLAUSIBLE_DOMAIN ? (
        <Script
          defer
          data-domain={PLAUSIBLE_DOMAIN}
          src={PLAUSIBLE_SRC}
          strategy="afterInteractive"
        />
      ) : null}
    </NextIntlClientProvider>
  );
}
