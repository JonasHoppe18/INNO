import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { PlaygroundPanel } from "@/components/agent/PlaygroundPanel";
import { PlaygroundPageHeader } from "@/components/agent/PlaygroundPageHeader";
import { DashboardPageShell } from "@/components/dashboard-page-shell";

export default async function PlaygroundPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in?redirect_url=/playground");
  }

  return (
    <DashboardPageShell>
      <PlaygroundPanel>
        <PlaygroundPageHeader />
      </PlaygroundPanel>
    </DashboardPageShell>
  );
}
