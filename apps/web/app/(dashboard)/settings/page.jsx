import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { SettingsPanel } from "@/components/settings/SettingsPanel";

export default async function SettingsPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in?redirect_url=/settings");
  }

  return <SettingsPanel />;
}
