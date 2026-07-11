import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { DashboardPageShell } from "@/components/dashboard-page-shell";
import { ZendeskDetailsPage } from "@/components/integrations/ZendeskDetailsPage";

export default async function ZendeskIntegrationPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in?redirect_url=/integrations/zendesk");
  }

  return (
    <DashboardPageShell>
      <ZendeskDetailsPage />
    </DashboardPageShell>
  );
}
