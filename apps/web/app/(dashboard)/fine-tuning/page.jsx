import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { FineTuningPanel } from "@/components/agent/FineTuningPanel";
import { FineTuningPageHeader } from "@/components/agent/FineTuningPageHeader";
import { DashboardPageShell } from "@/components/dashboard-page-shell";

export default async function FineTuningPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in?redirect_url=/fine-tuning");
  }

  return (
    <DashboardPageShell>
      <FineTuningPanel>
        <FineTuningPageHeader />
      </FineTuningPanel>
    </DashboardPageShell>
  );
}
