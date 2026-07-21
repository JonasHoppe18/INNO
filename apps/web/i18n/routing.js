import { defineRouting } from "next-intl/routing";

// Marketing-sidens locales. Dashboardet er ikke omfattet — se middleware.js.
export const routing = defineRouting({
  locales: ["en", "da"],
  defaultLocale: "en",
  localePrefix: "always",
});
