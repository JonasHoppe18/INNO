import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import createIntlMiddleware from "next-intl/middleware";
import { NextResponse } from "next/server";
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
const isAuthRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

function getDashboardUrl() {
  const value = String(process.env.NEXT_PUBLIC_DASHBOARD_URL || "").trim();
  if (!value) return null;

  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export default clerkMiddleware((auth, request) => {
  const dashboardUrl = getDashboardUrl();
  const requestHost = String(
    request.headers.get("x-forwarded-host") ||
      request.headers.get("host") ||
      request.nextUrl.host
  )
    .split(",")[0]
    .trim()
    .toLowerCase();
  const isApiRoute = request.nextUrl.pathname.startsWith("/api/");
  const shouldUseDashboardDomain =
    isAuthRoute(request) || (!isPublicRoute(request) && !isApiRoute);

  if (
    dashboardUrl &&
    requestHost !== dashboardUrl.host.toLowerCase() &&
    shouldUseDashboardDomain
  ) {
    const destination = new URL(
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
      dashboardUrl.origin
    );
    return NextResponse.redirect(destination);
  }

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
