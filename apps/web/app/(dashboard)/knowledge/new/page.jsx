import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { DashboardPageShell } from "@/components/dashboard-page-shell";
import { GreenfieldKnowledgePageClient } from "@/components/knowledge/GreenfieldKnowledgePageClient";
import { isGreenfieldPlaygroundEnabled } from "@/lib/server/greenfield-playground";

export default async function NewKnowledgePage() {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in?redirect_url=/knowledge/new");
  }

  if (!isGreenfieldPlaygroundEnabled()) {
    notFound();
  }

  return (
    <DashboardPageShell>
      <GreenfieldKnowledgePageClient />
    </DashboardPageShell>
  );
}
