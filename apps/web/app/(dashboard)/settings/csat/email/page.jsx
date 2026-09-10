import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { CsatEmailBuilder } from "@/components/csat/CsatEmailBuilder";

export default async function CsatEmailSettingsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/settings/csat/email");
  return <CsatEmailBuilder />;
}
