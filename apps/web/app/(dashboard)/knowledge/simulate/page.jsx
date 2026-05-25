import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { SimulateConversationClient } from "@/components/knowledge/SimulateConversationClient";
import { DashboardPageShell } from "@/components/dashboard-page-shell";

export default async function SimulateConversationPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in?redirect_url=/knowledge/simulate");
  }

  return (
    <DashboardPageShell>
      <SimulateConversationClient />
    </DashboardPageShell>
  );
}
