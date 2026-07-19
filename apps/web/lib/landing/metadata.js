// Shared metadata builder for the marketing pages: title/description plus
// canonical/hreflang alternates and Open Graph/Twitter cards, so links shared
// in email/LinkedIn/Slack render a proper preview. The OG image itself comes
// from the file convention (app/(marketing)/[locale]/opengraph-image.jsx),
// which applies to every nested marketing route automatically.
export function marketingMetadata({ locale, title, description, path = "" }) {
  const url = `/${locale}${path}`;
  return {
    title,
    description,
    alternates: {
      canonical: url,
      languages: { en: `/en${path}`, da: `/da${path}` },
    },
    openGraph: {
      title,
      description,
      url,
      siteName: "Sona AI",
      type: "website",
      locale: locale === "da" ? "da_DK" : "en_US",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}
