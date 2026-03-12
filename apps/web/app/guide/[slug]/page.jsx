import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Mail } from "lucide-react";
import { SonaLogo } from "@/components/ui/SonaLogo";
import { CopyField } from "@/components/guides/CopyField";
import shopifyLogo from "../../../../../assets/Shopify-Logo.png";
import webshipperLogo from "../../../../../assets/Webshipper_logo.png";
import glsLogo from "../../../../../assets/GLS logo.png";
import zendeskLogo from "../../../../../assets/Zendesk_logo.webp";

const GUIDE_CONTENT = {
  "connect-mail": {
    title: "Connect Mail",
    intro: "Use forwarding to connect any provider, including Gmail and Outlook.",
    icon: "mail",
    videoEmbedUrl: "https://www.loom.com/embed/c7e7434554ad4f92b92a728d360e6810",
    steps: [
      "Create a forwarding address in your email provider.",
      "Forward inbound emails to your Sona address.",
      "Verify your domain if you want branded sending.",
    ],
  },
  "connect-shopify": {
    title: "Connect Shopify",
    intro: "Connect Shopify to sync orders, customers, and policies.",
    logoSrc: shopifyLogo,
    logoAlt: "Shopify",
    videoEmbedUrl: "https://www.loom.com/embed/25b94ef8ec4c4dc4899c466a208f09f2",
    overview: [
      "Connect Shopify so Sona can read orders, customers, and policies.",
      "Works with custom distribution and read all orders access.",
      "Requires a Shopify Partner app with Admin API access.",
    ],
    prerequisites: [
      "A Shopify Partner account.",
      {
        label: "Create a Shopify Partner account",
        href: "https://www.shopify.com/dk/partnere",
      },
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
          "Click Create an app, name it (e.g., “Sona AI), and click Create.",
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
          "Request Read all orders with a short reason (e.g., “Sona AI integration”).",
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
  "connect-webshipper": {
    title: "Connect Webshipper",
    intro: "Connect Webshipper to sync shipment data and automate shipping-related replies.",
    logoSrc: webshipperLogo,
    logoAlt: "Webshipper",
    videoEmbedUrl: "https://www.loom.com/embed/a879bc12da8d44aea5281f526b3e07dd",
    overview: [
      "Sync shipment and carrier data from Webshipper.",
      "Enable automated responses based on shipment status.",
      "Use shipment details for ticket handling and routing.",
    ],
    prerequisites: [
      "Access to your Webshipper workspace.",
      "Permission to create API tokens in Webshipper.",
      "Your Webshipper domain and API token ready for Sona.",
    ],
    steps: [
      {
        title: "Step 1: Open Integrations in Sona",
        items: [
          "Go to Settings -> Integrations in Sona.",
          "Find the Webshipper card.",
          "Click Connect to open the setup dialog.",
        ],
      },
      {
        title: "Step 2: Create an API token in Webshipper",
        items: [
          "Open Webshipper and go to Settings -> Access and tokens.",
          "Click Create API token.",
          "Set Expires to Never.",
          "Select all required scopes and click Save.",
          "Copy the token immediately. You cannot view it again later.",
        ],
      },
      {
        title: "Step 3: Add credentials in Sona",
        items: [
          "Enter your Webshipper Domain (for example: team-name.webshipper.io).",
          "Paste your API Access Token.",
          "Click Connect.",
          "Sona validates credentials and tests the integration connection.",
        ],
        fields: [
          { label: "Webshipper Domain", value: "team-name.webshipper.io" },
          { label: "API Access Token", value: "Paste token from Webshipper" },
        ],
      },
    ],
    troubleshooting: [
      {
        title: "Authentication fails",
        items: [
          "Confirm the domain format is correct (without https://).",
          "Create a new token if you did not copy the previous one.",
          "Verify token scopes include shipment and order read access.",
        ],
      },
      {
        title: "No shipment data appears",
        items: [
          "Recheck that the Webshipper account has active shipments.",
          "Reconnect the integration to refresh credentials.",
          "Contact support if sync remains empty after reconnecting.",
        ],
      },
    ],
    features: [
      {
        title: "Shipment Data",
        items: ["Shipment status", "Carrier and service details", "Tracking references"],
      },
      {
        title: "Automation",
        items: ["Shipping-related auto replies", "Status-aware suggestions", "Faster ticket resolution"],
      },
    ],
  },
  "connect-gls": {
    title: "Connect GLS Tracking",
    intro: "Enable GLS tracking so Sona can fetch live shipment updates.",
    logoSrc: glsLogo,
    logoAlt: "GLS",
    overview: [
      "Use GLS tracking for shipment status lookups directly in Sona.",
      "Improves shipping-related draft quality with fresher tracking signals.",
      "Can be enabled/disabled from Integrations at any time.",
    ],
    prerequisites: [
      "At least one order with a GLS tracking number or GLS tracking link.",
      "A connected storefront (for example Shopify) so tracking data reaches Sona.",
      "GLS selected under Integrations -> Carrier tracking.",
    ],
    steps: [
      {
        title: "Step 1: Open Carrier tracking",
        items: [
          "Go to Integrations in Sona.",
          "Scroll to Carrier tracking.",
          "Find the GLS card.",
        ],
      },
      {
        title: "Step 2: Enable GLS",
        items: [
          "Click Connect on the GLS card.",
          "Wait until status changes to Active.",
          "If needed, click Disconnect to disable again.",
        ],
      },
      {
        title: "Step 3: Validate on an order",
        items: [
          "Open an order or ticket with a GLS tracking number.",
          "Confirm tracking status appears in Sona-generated context.",
          "Use the tracking link when you need full carrier details.",
        ],
      },
    ],
    troubleshooting: [
      {
        title: "GLS card does not show Active",
        items: [
          "Refresh Integrations and try Connect again.",
          "Verify your workspace has permissions to edit integrations.",
          "If issue persists, check API logs for /api/settings/carriers.",
        ],
      },
      {
        title: "No tracking status in replies",
        items: [
          "Confirm the shipment uses a GLS tracking number/link.",
          "Ensure the order data includes fulfillments with tracking fields.",
          "Retry after a minute in case tracking data is still propagating.",
        ],
      },
    ],
    features: [
      {
        title: "Shipment visibility",
        items: ["Current GLS status", "Latest tracking event", "Direct link to tracking page"],
      },
      {
        title: "Support automation",
        items: ["Better shipping replies", "Faster agent triage", "More consistent status messaging"],
      },
    ],
  },
  "connect-zendesk": {
    title: "Connect Zendesk",
    intro: "Connect Zendesk and run a one-time import of solved/closed ticket history.",
    logoSrc: zendeskLogo,
    logoAlt: "Zendesk",
    overview: [
      "Sona imports historical solved/closed tickets once during setup.",
      "The domain can be entered with or without https://.",
      "Import runs in background batches and can skip duplicates or low-quality auto-replies.",
    ],
    prerequisites: [
      "Zendesk admin access.",
      "An agent email address in Zendesk.",
      "A Zendesk API token generated under Admin Center -> Apps and integrations -> APIs.",
    ],
    steps: [
      {
        title: "Step 1: Open Zendesk integration in Sona",
        items: [
          "Go to Integrations in Sona.",
          "Open Zendesk and click Connect.",
          "Keep this page open while entering credentials.",
        ],
      },
      {
        title: "Step 2: Enter credentials",
        items: [
          "Paste your Zendesk domain (example: company.zendesk.com).",
          "Enter your Zendesk agent email.",
          "Paste API token from Zendesk.",
          "Click Connect & Import Once.",
        ],
      },
      {
        title: "How to get Zendesk API token",
        items: [
          "Open Zendesk Admin Center.",
          "Go to Apps and integrations -> APIs -> Zendesk API.",
          "Enable Token access if it is not already enabled.",
          "Under API tokens, click Add API token.",
          "Give it a clear label (for example: Sona Import).",
          "Copy the token immediately and store it securely.",
          "Use your Zendesk agent email + this token in Sona.",
        ],
      },
      {
        title: "Step 3: Confirm import progress",
        items: [
          "The card will show Importing with imported/skipped counters.",
          "When finished, status changes to Initial import complete.",
          "If import fails, open Manage, verify credentials, then reconnect.",
        ],
      },
    ],
    troubleshooting: [
      {
        title: "Importing stays at 0",
        items: [
          "Most common cause is failed Zendesk auth or missing permissions.",
          "Check domain, agent email, and API token carefully.",
          "Try reconnecting Zendesk to start a clean import job.",
        ],
      },
      {
        title: "Do I need https:// in the domain?",
        items: [
          "No. Both company.zendesk.com and https://company.zendesk.com are accepted.",
          "Sona normalizes the URL automatically before calling Zendesk APIs.",
        ],
      },
      {
        title: "Why are some tickets skipped?",
        items: [
          "Already imported tickets are skipped to avoid duplicates.",
          "Very short or auto-reply style content is filtered out.",
          "This is expected and helps keep training data high quality.",
        ],
      },
    ],
    features: [
      {
        title: "Historical tone learning",
        items: ["Learns from real historical ticket conversations", "Improves draft style consistency"],
      },
      {
        title: "Safe one-time import",
        items: ["No continuous ticket sync", "Background processing with progress counters"],
      },
    ],
  },
};

export default function GuideDetailPage({ params }) {
  const resolvedSlug =
    params.slug === "connect-gmail" ||
    params.slug === "connect-outlook" ||
    params.slug === "other-mail" ||
    params.slug === "custom-domain"
      ? "connect-mail"
      : params.slug;
  const guide = GUIDE_CONTENT[resolvedSlug];
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
            ) : guide.icon === "mail" ? (
              <Mail className="h-6 w-6 text-slate-600" />
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
          {guide.videoEmbedUrl ? (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <iframe
                src={guide.videoEmbedUrl}
                title={`${guide.title} video guide`}
                className="aspect-video w-full"
                allow="fullscreen; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-10 text-center text-sm text-slate-500">
              Video guide
            </div>
          )}
        </section>

        {guide.overview ? (
          <section className="mt-10">
            <h2 className="text-lg font-semibold">Overview</h2>
            <ul className="mt-3 space-y-2 text-sm text-slate-700">
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
          <section className="mt-10">
            <h2 className="text-lg font-semibold">Before you start</h2>
            <ul className="mt-3 space-y-2 text-sm text-slate-700">
              {guide.prerequisites.map((item, index) => (
                <li
                  key={
                    typeof item === "string"
                      ? item
                      : `${item?.label || "prerequisite"}-${item?.href || index}`
                  }
                  className="flex gap-2"
                >
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-slate-400" />
                  <span>
                    {typeof item === "string" ? (
                      item
                    ) : (
                      <Link
                        href={item?.href || "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
                      >
                        {item?.label || item?.href}
                      </Link>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mt-10">
          <h2 className="text-lg font-semibold">Step-by-step setup</h2>
          <div className="mt-4 space-y-5">
            {Array.isArray(guide.steps) &&
              guide.steps.map((step) => {
                if (typeof step === "string") {
                  return (
                    <div key={step} className="rounded-xl border border-slate-200 bg-white p-5">
                      <p className="text-sm text-slate-700">{step}</p>
                    </div>
                  );
                }
                return (
                  <div
                    key={step.title}
                    className="rounded-2xl border border-slate-200 bg-white p-6"
                  >
                    <h3 className="text-sm font-semibold text-slate-900">{step.title}</h3>
                    <ul className="mt-3 space-y-2 text-sm text-slate-700">
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
          <section className="mt-10">
            <h2 className="text-lg font-semibold">Troubleshooting</h2>
            <div className="mt-4 space-y-4">
              {guide.troubleshooting.map((block) => (
                <div
                  key={block.title}
                  className="rounded-2xl border border-amber-200 bg-amber-50 p-5"
                >
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
          <section className="mt-10">
            <h2 className="text-lg font-semibold">Integration features</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {guide.features.map((block) => (
                <div
                  key={block.title}
                  className="rounded-2xl border border-slate-200 bg-white p-5"
                >
                  <h3 className="text-sm font-semibold text-slate-900">{block.title}</h3>
                  <ul className="mt-3 space-y-2 text-sm text-slate-700">
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
      </main>
    </div>
  );
}
