import { AppSidebar } from "@/components/app-sidebar";
import { GlobalTestModeBanner } from "@/components/GlobalTestModeBanner";
import { SidebarProvider } from "@/components/ui/sidebar";
import { DashboardShell } from "@/components/dashboard-shell";
import { DashboardThemeProvider } from "@/components/theme/dashboard-theme-provider";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";
import { cookies } from "next/headers";

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

  const serviceClient = createServiceClient();
  if (serviceClient) {
    try {
      const scope = await resolveAuthScope(serviceClient, { clerkUserId: userId, orgId });

      // First-time heuristic: no Shopify + no mailbox yet => start onboarding flow.
      let hasShop = false;
      let hasMailbox = false;

      const shopCountQuery = applyScope(
        serviceClient.from("shops").select("id", { count: "exact", head: true }).is("uninstalled_at", null),
        scope,
        { workspaceColumn: "workspace_id", userColumn: "owner_user_id" }
      );
      const mailboxCountQuery = applyScope(
        serviceClient.from("mail_accounts").select("id", { count: "exact", head: true }),
        scope
      );

      const [{ count: shopCount }, { count: mailboxCount }] = await Promise.all([
        shopCountQuery,
        mailboxCountQuery,
      ]);

      hasShop = Number(shopCount || 0) > 0;
      hasMailbox = Number(mailboxCount || 0) > 0;

      if (!hasShop && !hasMailbox) {
        redirect("/onboarding");
      }
    } catch (_error) {
      // fail open: if onboarding check fails, keep user in dashboard
    }
  }

  let sidebarUser = null;
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  sidebarUser = mapClerkUser(user);
  const cookieStore = await cookies();
  const sidebarCookie = cookieStore.get("sidebar_state")?.value;
  const defaultSidebarOpen = sidebarCookie === "false" ? false : true;

  return (
    <DashboardThemeProvider>
      <div className="dashboard-theme flex min-h-svh flex-col">
        <GlobalTestModeBanner />
        <div className="flex min-h-0 flex-1">
          <SidebarProvider defaultOpen={defaultSidebarOpen}>
            <AppSidebar variant="inset" user={sidebarUser} />
            <DashboardShell>{children}</DashboardShell>
          </SidebarProvider>
        </div>
      </div>
    </DashboardThemeProvider>
  );
}
