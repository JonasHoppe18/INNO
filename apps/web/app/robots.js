const SITE = process.env.APP_URL || "https://sona-ai.dk";

// Marketing pages (/en, /da and their sub-pages) are crawlable; the
// authenticated app routes (the (dashboard) group and friends) and APIs are
// not. The dashboard's /integrations route is distinct from the marketing
// /en/integrations pages — locale-prefixed paths stay crawlable.
export default function robots() {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/analytics",
          "/automation",
          "/dashboard",
          "/documents",
          "/eval",
          "/feedback",
          "/guides",
          "/inbox",
          "/integrations",
          "/knowledge",
          "/knowledge-hub",
          "/mailboxes",
          "/persona",
          "/playground",
          "/settings",
          "/tags",
          "/onboarding",
          "/sign-in",
          "/sign-up",
        ],
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
