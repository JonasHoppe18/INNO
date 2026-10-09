import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { TagsSettings } from "@/components/settings/TagsSettings";
import { DashboardPageShell } from "@/components/dashboard-page-shell";

export default async function TagsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/tags");

  return (
    <DashboardPageShell>
      <TagsSettings />
    </DashboardPageShell>
  );
}
