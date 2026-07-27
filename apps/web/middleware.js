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
];
const isPublicRoute = createRouteMatcher(publicRoutes);
// Kun marketing-stier skal gennem next-intl (redirect / → /en, locale-detektion).
// NB: "(/.*)?" (ikke "(.*)") så "/en"/"/da" ikke matcher som prefix mod fx "/dashboard".
const isMarketingRoute = createRouteMatcher(["/", "/en(/.*)?", "/da(/.*)?"]);
const isAuthRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

function getDashboardOrigin() {
  const value = String(process.env.NEXT_PUBLIC_DASHBOARD_URL || "").trim();
  if (!value) return null;

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export default clerkMiddleware((auth, request) => {
  const dashboardOrigin = getDashboardOrigin();
  const isApiRoute = request.nextUrl.pathname.startsWith("/api/");
  const shouldUseDashboardDomain =
    isAuthRoute(request) || (!isPublicRoute(request) && !isApiRoute);

  if (
    dashboardOrigin &&
    request.nextUrl.origin !== dashboardOrigin &&
    shouldUseDashboardDomain
  ) {
    const destination = new URL(
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
      dashboardOrigin
    );
    return NextResponse.redirect(destination);
  }

  if (!isPublicRoute(request)) {
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
