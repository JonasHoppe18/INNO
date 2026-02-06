import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import { DashboardPageShell } from "@/components/dashboard-page-shell";

const GUIDE_CONTENT = {
  "connect-gmail": {
    title: "Connect Gmail",
    intro: "Authorize Gmail with Google OAuth and start syncing inbox activity.",
    steps: [
      "Go to Mailboxes in Sona.",
      "Click “Connect Gmail”.",
      "Choose your Gmail account and approve permissions.",
      "Return to Sona and wait for sync to finish.",
    ],
  },
  "connect-outlook": {
    title: "Connect Outlook",
    intro: "Authorize Outlook with Microsoft OAuth and start syncing inbox activity.",
    steps: [
      "Go to Mailboxes in Sona.",
      "Click “Connect Outlook”.",
      "Choose your Outlook account and approve permissions.",
      "Return to Sona and wait for sync to finish.",
    ],
  },
  "other-mail": {
    title: "Other mail",
    intro: "Use forwarding when you are not connecting Gmail or Outlook directly.",
    steps: [
      "Create a forwarding address in your email provider.",
      "Forward inbound emails to your Sona address.",
      "Verify your domain if you want branded sending.",
    ],
  },
  "connect-shopify": {
    title: "Connect Shopify",
    intro: "Sync orders, customers, and policies for smarter replies.",
    steps: [
      "Go to Integrations in Sona.",
      "Click “Connect Shopify”.",
      "Log in to Shopify and approve permissions.",
      "Wait for the sync to complete.",
    ],
  },
  "custom-domain": {
    title: "Set up Custom Domain",
    intro: "Verify DNS and send from your own address.",
    steps: [
      "Open Sending Identity in Mailboxes.",
      "Add DKIM TXT and Return-Path CNAME records.",
      "Click “Check status” to verify.",
    ],
  },
};

export default async function GuideDetailPage({ params }) {
  const { userId } = await auth();
  if (!userId) {
    redirect(`/sign-in?redirect_url=/guides/${params.slug}`);
  }

  const guide = GUIDE_CONTENT[params.slug];
  if (!guide) {
    notFound();
  }

  return (
    <DashboardPageShell className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{guide.title}</h1>
        <p className="text-sm text-muted-foreground">{guide.intro}</p>
      </header>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-sm font-semibold text-slate-900">Video guide</div>
        <div className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-8 text-xs font-medium text-slate-500">
          Add video here
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Step-by-step setup</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-600">
          {guide.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>
    </DashboardPageShell>
  );
}
