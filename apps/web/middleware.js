import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const publicRoutes = ["/", "/sign-in(.*)", "/sign-up(.*)", "/api/landing-signups(.*)", "/api/outlook/webhook(.*)", "/api/webhooks/(.*)", "/api/admin/register-webhooks"];
const isPublicRoute = createRouteMatcher(publicRoutes);

export default clerkMiddleware((auth, request) => {
  if (!isPublicRoute(request)) {
    auth().protect();
  }
});

export const config = {
  matcher: [
    "/((?!.*\\..*|_next).*)",
    "/",
    "/(api|trpc)(.*)",
  ],
};
