import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Image from "next/image";
import { DashboardPageShell } from "@/components/dashboard-page-shell";
import { SonaLogo } from "@/components/ui/SonaLogo";
import { ExternalLink, Mail } from "lucide-react";
import shopifyLogo from "../../../../../assets/Shopify-Logo.png";
import webshipperLogo from "../../../../../assets/Webshipper_logo.png";
import glsLogo from "../../../../../assets/GLS logo.png";
import zendeskLogo from "../../../../../assets/Zendesk_logo.webp";

const GUIDES = [
  {
    slug: "connect-mail",
    title: "Connect Mail",
    description: "Forward emails to Sona from any provider.",
    icon: "mail",
    logoAlt: "Sona",
  },
  {
    slug: "connect-shopify",
    title: "Connect Shopify",
    description: "Connect Shopify and sync orders, customers, and policies.",
    logoSrc: shopifyLogo,
    logoAlt: "Shopify",
  },
  {
    slug: "connect-webshipper",
    title: "Connect Webshipper",
    description: "Connect Webshipper and sync shipment and carrier data.",
    logoSrc: webshipperLogo,
    logoAlt: "Webshipper",
  },
  {
    slug: "connect-gls",
    title: "Connect GLS Tracking",
    description: "Enable GLS tracking lookups for shipment status updates.",
    logoSrc: glsLogo,
    logoAlt: "GLS",
  },
  {
    slug: "connect-zendesk",
    title: "Connect Zendesk",
    description: "Import closed Zendesk tickets once to train Sona on historic replies.",
    logoSrc: zendeskLogo,
    logoAlt: "Zendesk",
  },
];

export default async function GuidesPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in?redirect_url=/guides");
  }

  return (
    <DashboardPageShell className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Guides</h1>
        <p className="text-sm text-muted-foreground">
          Short videos and step-by-step docs for common setup tasks.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {GUIDES.map((guide) => (
          <article
            key={guide.title}
            className="flex h-full flex-col rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-gray-100 bg-gray-50">
                {guide.logoSrc ? (
                  <Image
                    src={guide.logoSrc}
                    alt={guide.logoAlt || guide.title}
                    width={42}
                    height={42}
                    className="h-8 w-8 object-contain"
                  />
                ) : guide.icon === "mail" ? (
                  <Mail className="h-5 w-5 text-slate-600" />
                ) : (
                  <SonaLogo size={28} />
                )}
              </div>
              <div className="text-sm font-semibold text-gray-900">{guide.title}</div>
            </div>
            <p className="mt-1 text-sm text-gray-600">{guide.description}</p>
            <a
              href={`/guide/${guide.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-auto inline-flex items-center justify-center gap-1.5 self-end rounded-md border border-indigo-200 bg-white px-3 py-2 text-xs font-semibold text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-50"
            >
              Read Guide
              <ExternalLink className="h-3 w-3 text-slate-400" />
            </a>
          </article>
        ))}
      </section>
    </DashboardPageShell>
  );
}
