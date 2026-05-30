import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { DashboardPageShell } from "@/components/dashboard-page-shell";
import { InternalRulesClient } from "@/components/knowledge/InternalRulesClient";

export default async function InternalRulesPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in?redirect_url=/knowledge");
  }

  return (
    <DashboardPageShell>
      <InternalRulesClient />
    </DashboardPageShell>
  );
}
