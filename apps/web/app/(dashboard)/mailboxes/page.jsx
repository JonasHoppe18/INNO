import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { DashboardPageShell } from "@/components/dashboard-page-shell";
import { MailboxRow } from "@/components/mailboxes/MailboxRow";
import { MailboxesAddMenu } from "@/components/mailboxes/MailboxesAddMenu";
import { MailboxesHelpCard } from "@/components/mailboxes/MailboxesHelpCard";
import { MailboxesOnboardingTracker } from "@/components/onboarding/MailboxesOnboardingTracker";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";

const SUPABASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

async function loadMailAccounts(serviceClient, scope) {
  const { data, error } = await applyScope(
    serviceClient
    .from("mail_accounts")
    .select(
      "id, provider, provider_email, status, inbound_slug, sending_type, sending_domain, domain_status, domain_dns, from_email, from_name"
    )
    .in("provider", ["gmail", "outlook", "smtp"])
    .order("created_at", { ascending: true }),
    scope
  );
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

export default async function MailboxesPage() {
  const { userId: clerkUserId, orgId } = await auth();

  if (!clerkUserId) {
    redirect("/sign-in?redirect_url=/mailboxes");
  }

  const serviceClient = createServiceClient();
  let mailAccounts = [];
  if (serviceClient) {
    try {
      const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
      if (scope.workspaceId || scope.supabaseUserId) {
        mailAccounts = await loadMailAccounts(serviceClient, scope);
      }
    } catch (error) {
      console.error("Mailboxes mail account lookup failed:", error);
    }
  }

  const providerOrder = { gmail: 0, outlook: 1, smtp: 2 };
  const mailboxes = mailAccounts
    .filter((account) => account?.provider)
    .sort(
      (a, b) =>
        (providerOrder[a.provider] ?? 99) - (providerOrder[b.provider] ?? 99)
    )
    .map((account) => ({
      id: account.id,
      provider: account.provider,
      email: account.provider_email || "",
      isActive: Boolean(account.provider_email),
      status: account.status || null,
      inboundSlug: account.inbound_slug || null,
      sendingType: account.sending_type || "shared",
      sendingDomain: account.sending_domain || null,
      domainStatus: account.domain_status || "pending",
      domainDns: account.domain_dns || null,
      fromEmail: account.from_email || null,
      fromName: account.from_name || null,
    }));

  return (
    <DashboardPageShell className="space-y-10">
      <MailboxesOnboardingTracker />
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold">Mailboxes</h1>
          <p className="text-sm text-muted-foreground">
            Manage the email accounts Sona uses to draft replies.
          </p>
        </div>
        <MailboxesAddMenu />
      </header>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Connected accounts
          </h2>
          <p className="text-sm text-muted-foreground">
            Gmail, Outlook, and forwarded inboxes currently linked to Sona.
          </p>
        </div>
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          {mailboxes.length ? (
            <div className="divide-y divide-gray-100">
              {mailboxes.map((mailbox) => (
                <MailboxRow
                  key={`${mailbox.provider}-${mailbox.email}`}
                  provider={mailbox.provider}
                  email={mailbox.email}
                  isActive={mailbox.isActive}
                  status={mailbox.status}
                  mailboxId={mailbox.id}
                  inboundSlug={mailbox.inboundSlug}
                  sendingType={mailbox.sendingType}
                  sendingDomain={mailbox.sendingDomain}
                  domainStatus={mailbox.domainStatus}
                  domainDns={mailbox.domainDns}
                  fromEmail={mailbox.fromEmail}
                  fromName={mailbox.fromName}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
              <p className="text-base font-medium text-slate-900">
                No mailboxes connected yet. Connect your support email to start
                generating drafts.
              </p>
            </div>
          )}
        </div>
      </section>

      {mailboxes.length ? null : (
        <section>
          <MailboxesHelpCard />
        </section>
      )}
    </DashboardPageShell>
  );
}
