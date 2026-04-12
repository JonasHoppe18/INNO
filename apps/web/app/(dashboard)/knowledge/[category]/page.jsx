import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { DashboardPageShell } from "@/components/dashboard-page-shell";
import { KnowledgeCategoryDetail } from "@/components/knowledge/KnowledgeCategoryDetail";

export default async function KnowledgeCategoryPage({ params }) {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in?redirect_url=/knowledge");
  }

  return (
    <DashboardPageShell>
      <KnowledgeCategoryDetail categorySlug={params.category} />
    </DashboardPageShell>
  );
}
