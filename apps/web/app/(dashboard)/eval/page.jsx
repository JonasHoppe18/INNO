import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { EvalPanel } from "@/components/agent/EvalPanel";
import { DashboardPageShell } from "@/components/dashboard-page-shell";

export default async function EvalPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in?redirect_url=/eval");
  }

  return (
    <DashboardPageShell>
      <EvalPanel fullPage />
    </DashboardPageShell>
  );
}
