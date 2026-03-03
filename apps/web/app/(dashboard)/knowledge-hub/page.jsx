import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function KnowledgeHubPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in?redirect_url=/knowledge-hub");
  }
  redirect("/knowledge");
}
