import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { EvalPanel } from "@/components/agent/EvalPanel";

export default async function EvalPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in?redirect_url=/eval");
  }

  return (
    <main className="min-w-0 w-full">
      <EvalPanel fullPage />
    </main>
  );
}
