import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { CsatThankYouSettings } from "@/components/csat/CsatThankYouSettings";

export default async function CsatThankYouSettingsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/settings/csat/thank-you");
  return <CsatThankYouSettings />;
}
