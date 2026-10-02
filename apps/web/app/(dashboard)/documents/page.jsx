import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { DashboardPageShell } from "@/components/dashboard-page-shell";


export default async function DocumentPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in?redirect_url=/documents");
  }

  return (
    <DashboardPageShell>
      <header className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-page-heading font-semibold">Upload dine dokumenter til Sona</h1>
        </div>
      </header>
    </DashboardPageShell>
  );
}
