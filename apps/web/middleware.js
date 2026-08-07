import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import createIntlMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

const intlMiddleware = createIntlMiddleware(routing);

const publicRoutes = [
  "/",
  "/en(/.*)?",
  "/da(/.*)?",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/landing-signups(.*)",
  "/api/outlook/webhook(.*)",
  "/api/webhooks/(.*)",
  "/api/admin/register-webhooks",
  "/csat/(.*)",
  "/api/csat/(.*)",
];
const isPublicRoute = createRouteMatcher(publicRoutes);
const isCustomerSatisfactionPath = (pathname) => /^\/(?:api\/)?csat(?:\/|$)/.test(pathname);
// Kun marketing-stier skal gennem next-intl (redirect / → /en, locale-detektion).
// NB: "(/.*)?" (ikke "(.*)") så "/en"/"/da" ikke matcher som prefix mod fx "/dashboard".
const isMarketingRoute = createRouteMatcher(["/", "/en(/.*)?", "/da(/.*)?"]);

export default clerkMiddleware((auth, request) => {
  if (!isPublicRoute(request) && !isCustomerSatisfactionPath(request.nextUrl.pathname)) {
    auth().protect();
  }
  if (isMarketingRoute(request)) {
    return intlMiddleware(request);
  }
});

export const config = {
  matcher: [
    "/((?!.*\\..*|_next).*)",
    "/",
    "/(api|trpc)(.*)",
  ],
};
