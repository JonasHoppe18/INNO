import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import { DashboardPageShell } from "@/components/dashboard-page-shell";
import { CopyField } from "@/components/guides/CopyField";

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
    intro: "Connect Shopify to sync orders, customers, and policies.",
    overview: [
      "Connect Shopify so Sona can read orders, customers, and policies.",
      "Works with custom distribution and read all orders access.",
      "Requires a Shopify Partner app with Admin API access.",
    ],
    prerequisites: [
      "A Shopify Partner account.",
      "Access to the store admin you want to connect.",
      "Client ID and Client Secret from your Shopify app.",
    ],
    steps: [
      {
        title: "Step 1: Access Sona Integrations",
        items: [
          "Go to Integrations in Sona.",
          "Click “Connect Shopify” to open the dialog.",
          "You will need Shop Domain, Client ID, and Client Secret.",
        ],
      },
      {
        title: "Step 2: Create app in Shopify Developer Dashboard",
        items: [
          "Open Shopify Partner Dashboard in a different browser than your store admin.",
          "Click App distribution and then Visit Dev Dashboard.",
          "Click Create an app, name it (e.g., “Sona Integration”), and click Create.",
        ],
      },
      {
        title: "Step 3: Configure app settings",
        items: [
          "Set App URL to the Sona app URL.",
          "Ensure Embed app in Shopify admin is NOT checked.",
          "Choose the oldest available API version.",
          "Select all Admin API scopes.",
        ],
        fields: [
          { label: "App URL", value: "https://sona-ai.dk" },
          { label: "Redirect URL", value: "https://sona-ai.dk/api/integrations/shopify/callback" },
        ],
      },
      {
        title: "Step 4: Release the app version",
        items: ["Click Release and give the version a name (e.g., “1”)."],
      },
      {
        title: "Step 5: Set up Custom Distribution",
        items: [
          "Go back to Partner Dashboard and choose Custom Distribution.",
          "Copy your shop domain from Settings → Domains.",
          "Paste the domain and click Generate link.",
        ],
      },
      {
        title: "Step 6: Request Read all orders access",
        items: [
          "Open API access requests.",
          "Request Read all orders with a short reason (e.g., “Sona AI helpdesk integration”).",
          "Verify it says your app can access full order history.",
        ],
      },
      {
        title: "Step 7: Create a new app version",
        items: ["Create a new version and Release it again (e.g., “2”)."],
      },
      {
        title: "Step 8: Connect in Sona",
        items: [
          "In Developer Dashboard → Settings, copy Client ID and Client Secret.",
          "In Sona, enter Shop Domain, Client ID, and Client Secret.",
          "Click Connect and complete the Shopify install screen.",
        ],
      },
    ],
    troubleshooting: [
      {
        title: "This installation link for this app is invalid",
        items: [
          "Copy the install link from Partner Dashboard → Distribution.",
          "Open it once in your store admin browser, then close it without installing.",
          "Try Connect in Sona again.",
        ],
      },
      {
        title: "Other common issues",
        items: [
          "Invalid API credentials: verify Client ID and Client Secret.",
          "Store not found: ensure domain ends with .myshopify.com.",
          "Insufficient permissions: ensure Admin API scopes and Read all orders are approved.",
        ],
      },
    ],
    features: [
      {
        title: "Customer Data",
        items: ["Profiles and order history", "Events and interactions", "Contact information"],
      },
      {
        title: "Product Information",
        items: ["Details, inventory, pricing, variants"],
      },
      {
        title: "Order Management",
        items: ["Status and tracking", "Shipping information", "Payment details"],
      },
      {
        title: "Security & Privacy",
        items: [
          "Data encryption at rest and in transit.",
          "No sensitive data stored in plain text.",
          "Access scoped to your team with audit logging.",
        ],
      },
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

      {guide.overview ? (
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Overview</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            {guide.overview.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {guide.prerequisites ? (
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Before you start</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            {guide.prerequisites.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-slate-400" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Step-by-step setup</h2>
        <div className="mt-4 space-y-4">
          {Array.isArray(guide.steps) &&
            guide.steps.map((step) => {
              if (typeof step === "string") {
                return (
                  <div key={step} className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-sm text-slate-600">{step}</p>
                  </div>
                );
              }
              return (
                <div
                  key={step.title}
                  className="rounded-xl border border-slate-200 bg-white p-5"
                >
                  <h3 className="text-sm font-semibold text-slate-900">{step.title}</h3>
                  <ul className="mt-3 space-y-2 text-sm text-slate-600">
                    {step.items.map((item) => (
                      <li key={item} className="flex gap-2">
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-slate-400" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                  {Array.isArray(step.fields) && step.fields.length ? (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {step.fields.map((field) => (
                        <CopyField key={field.label} label={field.label} value={field.value} />
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
        </div>
      </section>

      {guide.troubleshooting ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
          <h2 className="text-base font-semibold text-amber-900">Troubleshooting</h2>
          <div className="mt-4 space-y-4">
            {guide.troubleshooting.map((block) => (
              <div key={block.title} className="rounded-lg border border-amber-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-amber-900">{block.title}</h3>
                <ul className="mt-3 space-y-2 text-sm text-amber-900/80">
                  {block.items.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {guide.features ? (
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Integration features</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {guide.features.map((block) => (
              <div key={block.title} className="rounded-lg border border-slate-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-slate-900">{block.title}</h3>
                <ul className="mt-3 space-y-2 text-sm text-slate-600">
                  {block.items.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-slate-400" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </DashboardPageShell>
  );
}
