import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SonaLogo } from "@/components/ui/SonaLogo";
import shopifyLogo from "../../../../../assets/Shopify-Logo.png";
import gmailLogo from "../../../../../assets/Gmail-logo.webp";
import outlookLogo from "../../../../../assets/Outlook-logo.png";

const GUIDE_CONTENT = {
  "connect-gmail": {
    title: "Connect Gmail",
    intro: "Authorize Gmail with Google OAuth and start syncing inbox activity.",
    logoSrc: gmailLogo,
    logoAlt: "Gmail",
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
    logoSrc: outlookLogo,
    logoAlt: "Outlook",
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
    logoSrc: shopifyLogo,
    logoAlt: "Shopify",
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

export default function GuideDetailPage({ params }) {
  const guide = GUIDE_CONTENT[params.slug];
  if (!guide) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-white">
      <main className="mx-auto max-w-5xl px-6 pb-16 pt-16">
        <Link
          href="/guides"
          className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400"
        >
          Back to Guides
        </Link>

        <header className="mt-6 flex items-start gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-100 bg-slate-50">
            {guide.logoSrc ? (
              <Image
                src={guide.logoSrc}
                alt={guide.logoAlt || guide.title}
                width={48}
                height={48}
                className="h-10 w-10 object-contain"
              />
            ) : (
              <SonaLogo size={34} />
            )}
          </div>
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">{guide.title}</h1>
            <p className="mt-2 text-sm text-slate-600">{guide.intro}</p>
          </div>
        </header>

        <section className="mt-10">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-10 text-center text-sm text-slate-500">
            Video guide
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">Step-by-step setup</h2>
          <div className="mt-4 space-y-3">
            {guide.steps.map((step) => (
              <div key={step} className="rounded-xl border border-slate-200 bg-white p-5">
                <p className="text-sm text-slate-700">{step}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
