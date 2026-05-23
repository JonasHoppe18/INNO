import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AllSnippetsClient } from "@/components/knowledge/AllSnippetsClient";
import { DashboardPageShell } from "@/components/dashboard-page-shell";

export default async function AllSnippetsPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in?redirect_url=/knowledge/all");
  }

  return (
    <DashboardPageShell>
      <AllSnippetsClient />
    </DashboardPageShell>
  );
}
