import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { DashboardPageShell } from "@/components/dashboard-page-shell";

export default async function OtherMailPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in?redirect_url=/mailboxes/other");
  }

  return (
    <DashboardPageShell className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Other mail</h1>
        <p className="text-sm text-muted-foreground">
          Use forwarding and your own domain to connect any email provider.
        </p>
      </header>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">How it works</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-600">
          <li>Forward inbound emails to your Sona address.</li>
          <li>Verify your domain (DKIM + Return-Path) for branded sending.</li>
          <li>Optional: add SMTP later if you need custom sending outside Postmark.</li>
        </ul>

        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href="/guides/other-mail"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-md border border-indigo-200 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
          >
            View guide
          </a>
          <a
            href="/mailboxes"
            className="inline-flex items-center rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Go to Mailboxes
          </a>
        </div>
      </div>
    </DashboardPageShell>
  );
}
