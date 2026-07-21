import { routing } from "@/i18n/routing";

const SITE = process.env.APP_URL || "https://sona-ai.dk";

// Public marketing paths (locale-prefixed). /demo is intentionally omitted —
// it still shows a "coming soon" placeholder, so we don't invite crawlers or
// share it until there's a real video. Add it back here once it ships.
const PATHS = [
  "",
  "/product",
  "/integrations",
  "/security",
  "/privacy",
  "/terms",
];

export default function sitemap() {
  const now = new Date();
  const entries = [];
  for (const path of PATHS) {
    for (const locale of routing.locales) {
      entries.push({
        url: `${SITE}/${locale}${path}`,
        lastModified: now,
        changeFrequency: path === "" ? "weekly" : "monthly",
        priority: path === "" ? 1 : 0.7,
        alternates: {
          languages: Object.fromEntries(
            routing.locales.map((l) => [l, `${SITE}/${l}${path}`])
          ),
        },
      });
    }
  }
  return entries;
}
