import { AppSidebar } from "@/components/app-sidebar";
import { GlobalTestModeBanner } from "@/components/GlobalTestModeBanner";
import { SidebarProvider } from "@/components/ui/sidebar";
import { DashboardShell } from "@/components/dashboard-shell";
import { DashboardThemeProvider } from "@/components/theme/dashboard-theme-provider";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { loadDashboardShellData } from "@/lib/server/dashboard-shell-data";
import { cookies } from "next/headers";
import { isGreenfieldPlaygroundEnabled } from "@/lib/server/greenfield-playground";

function mapClerkUser(user) {
  if (!user) return null;
  return {
    name: user.fullName || user.username || user.primaryEmailAddress?.emailAddress || "Bruger",
    email: user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? "",
    avatar: user.imageUrl ?? "/avatars/shadcn.jpg",
  };
}

const SUPABASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

// Dashboard-layout henter Clerk-bruger til sidebar/header og wrapper børnene i sidebar/provider
export default async function DashboardLayout({ children }) {
  const { userId, orgId } = await auth();
  if (!userId) {
    redirect("/sign-in?redirect_url=/dashboard");
  }

  const shell = await loadDashboardShellData(
    createServiceClient(),
    { clerkUserId: userId, orgId },
    async () => {
      const client = await clerkClient();
      return mapClerkUser(await client.users.getUser(userId));
    },
  );
  if (shell.needsOnboarding) redirect("/onboarding");
  const sidebarUser = shell.user;
  const cookieStore = await cookies();
  const sidebarCookie = cookieStore.get("sidebar_state")?.value;
  const defaultSidebarOpen = sidebarCookie === "true";

  return (
    <DashboardThemeProvider>
      <div className="dashboard-theme flex min-h-svh flex-col">
        <GlobalTestModeBanner />
        <div className="flex min-h-0 flex-1">
          <SidebarProvider defaultOpen={defaultSidebarOpen}>
            <AppSidebar
              variant="inset"
              user={sidebarUser}
              showGreenfieldPlayground={isGreenfieldPlaygroundEnabled()}
            />
            <DashboardShell>{children}</DashboardShell>
          </SidebarProvider>
        </div>
      </div>
    </DashboardThemeProvider>
  );
}
