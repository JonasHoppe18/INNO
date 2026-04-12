import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { DashboardPageShell } from "@/components/dashboard-page-shell";
import { KnowledgeProductDetail } from "@/components/knowledge/KnowledgeProductDetail";

export default async function KnowledgeProductPage({ params, searchParams }) {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in?redirect_url=/knowledge");
  }

  return (
    <DashboardPageShell>
      <KnowledgeProductDetail
        productId={decodeURIComponent(params.productId)}
        productTitle={searchParams?.title ? decodeURIComponent(searchParams.title) : null}
      />
    </DashboardPageShell>
  );
}
