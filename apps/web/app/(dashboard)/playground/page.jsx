import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { GreenfieldPlayground } from "@/components/agent/GreenfieldPlayground";
import { DashboardPageShell } from "@/components/dashboard-page-shell";
import { isGreenfieldPlaygroundEnabled } from "@/lib/server/greenfield-playground";

export default async function PlaygroundPage() {
  if (!isGreenfieldPlaygroundEnabled()) notFound();
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in?redirect_url=/playground");
  }

  return (
    <DashboardPageShell>
      <GreenfieldPlayground />
    </DashboardPageShell>
  );
}
