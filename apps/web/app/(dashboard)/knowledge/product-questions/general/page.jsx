import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { DashboardPageShell } from "@/components/dashboard-page-shell";
import { SnippetTwoPanel } from "@/components/knowledge/SnippetTwoPanel";

export default async function GeneralKnowledgePage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in?redirect_url=/knowledge/product-questions/general");
  }

  return (
    <DashboardPageShell>
      <SnippetTwoPanel
        category="product-questions"
        productTitle="General"
        backHref="/knowledge/product-questions"
        headerSubtitle="Applies across all products"
        productScope="general"
      />
    </DashboardPageShell>
  );
}
