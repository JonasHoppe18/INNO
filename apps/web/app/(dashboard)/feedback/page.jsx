import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { FeedbackSuggestionsPanel } from "@/components/agent/FeedbackSuggestionsPanel";

export default async function FeedbackPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in?redirect_url=/feedback");
  }

  return (
    <main className="min-w-0 w-full p-6">
      <FeedbackSuggestionsPanel />
    </main>
  );
}
