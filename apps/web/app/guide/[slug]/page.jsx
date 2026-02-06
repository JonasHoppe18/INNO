import { auth } from "@clerk/nextjs/server";
import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SonaLogo } from "@/components/ui/SonaLogo";
import shopifyLogo from "../../../../../assets/Shopify-Logo.png";
import gmailLogo from "../../../../../assets/Gmail-logo.webp";
import outlookLogo from "../../../../../assets/Outlook-logo.png";

const INBOUND_FORMAT = "inbound+{team-slug}@inbound.sona-ai.dk";

const GUIDE_CONTENT = {
  gmail: {
    title: "Connect Gmail",
    intro: "Authorize Gmail with Google OAuth and start syncing inbox activity.",
    logoSrc: gmailLogo,
    logoAlt: "Gmail",
    steps: [
      {
        title: "Step 1: Open Mailboxes in Sona",
        items: ["Go to Mailboxes in Sona.", "Click “Connect Gmail”."],
      },
      {
        title: "Step 2: Authorize Google",
        items: [
          "Choose the Gmail account to connect.",
          "Review the permissions and click “Allow”.",
        ],
      },
      {
        title: "Step 3: Confirm sync",
        items: [
          "Return to Sona and wait for the mailbox to sync.",
          "You will see incoming emails in the Inbox.",
        ],
      },
    ],
  },
  outlook: {
    title: "Connect Outlook",
    intro: "Authorize Outlook with Microsoft OAuth and start syncing inbox activity.",
    logoSrc: outlookLogo,
    logoAlt: "Outlook",
    steps: [
      {
        title: "Step 1: Open Mailboxes in Sona",
        items: ["Go to Mailboxes in Sona.", "Click “Connect Outlook”."],
      },
      {
        title: "Step 2: Authorize Microsoft",
        items: [
          "Choose the Outlook account to connect.",
          "Review the permissions and click “Accept”.",
        ],
      },
      {
        title: "Step 3: Confirm sync",
        items: [
          "Return to Sona and wait for the mailbox to sync.",
          "You will see incoming emails in the Inbox.",
        ],
      },
    ],
  },
  forwarding: {
    title: "Forwarding Setup",
    intro: "Use forwarding if you are not connecting Gmail or Outlook directly.",
    logoAlt: "Sona",
    prerequisites: [
      "Access to your mailbox settings (admin or owner).",
      `Your team’s inbound address: ${INBOUND_FORMAT}.`,
    ],
    steps: [
      {
        title: "Step 1: Open mailbox settings",
        items: [
          "Open your email provider’s admin or mailbox settings.",
          "Find the forwarding section.",
        ],
      },
      {
        title: "Step 2: Add the forwarding address",
        items: [
          "Click “Add a forwarding address”.",
          `Enter your team’s inbound address: ${INBOUND_FORMAT}.`,
          "Confirm any prompts from your provider.",
        ],
      },
      {
        title: "Step 3: Verification & completion",
        items: [
          "Your provider may send a verification email.",
          "Our system automatically detects and confirms it.",
          "You’ll see status updates inside Sona.",
        ],
      },
      {
        title: "Optional: Enable forwarding rules",
        items: [
          "Forward a copy of incoming mail to the Sona address.",
          "Keep a copy in your inbox as backup.",
          "Save changes.",
        ],
      },
      {
        title: "Test your setup (optional)",
        items: [
          "Send a test email to your mailbox.",
          "Confirm it appears in Sona and becomes a ticket.",
        ],
      },
    ],
    troubleshooting: [
      {
        title: "Forwarding not working",
        items: [
          "Check spam for verification emails.",
          "Confirm the inbound address format is correct.",
          "Review forwarding rules and spam filters.",
          "Wait for propagation (can take up to 24 hours).",
        ],
      },
      {
        title: "Still having issues?",
        items: [
          "Remove and re-add the forwarding address.",
          "Some providers allow only one external forwarding address.",
          "Contact your team admin to verify the inbound address.",
        ],
      },
    ],
    notes: [
      "Forwarding typically happens within seconds.",
      "Emails are sent securely through your provider.",
      "Keep original emails in your mailbox as a backup.",
    ],
  },
  "custom-domain": {
    title: "Set up Custom Domain",
    intro: "Verify your domain in DNS and send from your own address.",
    logoAlt: "Sona",
    steps: [
      {
        title: "Step 1: Start domain setup",
        items: [
          "Go to Mailboxes in Sona.",
          "Open “Sending Identity” and choose “Use my own domain”.",
          "Enter your domain and preferred From address.",
        ],
      },
      {
        title: "Step 2: Add DNS records",
        items: [
          "Copy the DKIM TXT record into your DNS provider.",
          "Copy the Return-Path CNAME record into your DNS provider.",
        ],
      },
      {
        title: "Step 3: Verify",
        items: [
          "Click “Check status” in Sona.",
          "Once verified, you can send from your custom domain.",
        ],
      },
    ],
  },
  shopify: {
    title: "Shopify Setup",
    intro: "Connect Shopify and sync orders, customers, and policies.",
    logoSrc: shopifyLogo,
    logoAlt: "Shopify",
    steps: [
      {
        title: "Step 1: Connect Shopify",
        items: ["Go to Integrations in Sona.", "Click “Connect Shopify”."],
      },
      {
        title: "Step 2: Authorize",
        items: ["Log in to your Shopify store.", "Approve the app permissions."],
      },
      {
        title: "Step 3: Confirm sync",
        items: [
          "Return to Sona and wait for the sync to complete.",
          "Orders and customers will appear in the Inbox context.",
        ],
      },
    ],
  },
};

export default async function GuideDetailPage({ params }) {
  const { userId } = await auth();

  if (!userId) {
    redirect(`/sign-in?redirect_url=/guide/${params.slug}`);
  }

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

        {guide.prerequisites ? (
          <section className="mt-12">
            <h2 className="text-lg font-semibold">Prerequisites</h2>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
              {guide.prerequisites.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mt-10">
          <h2 className="text-lg font-semibold">Step-by-step setup</h2>
          <div className="mt-4 space-y-4">
            {guide.steps.map((step) => (
              <div key={step.title} className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="text-sm font-semibold text-slate-900">{step.title}</div>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                  {step.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {guide.troubleshooting ? (
          <section className="mt-10">
            <h2 className="text-lg font-semibold">Troubleshooting</h2>
            <div className="mt-3 space-y-4 text-sm text-slate-700">
              {guide.troubleshooting.map((section) => (
                <div key={section.title}>
                  <div className="font-semibold text-slate-900">{section.title}</div>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {section.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {guide.notes ? (
          <section className="mt-10">
            <h2 className="text-lg font-semibold">Important notes</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
              {guide.notes.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </div>
  );
}
