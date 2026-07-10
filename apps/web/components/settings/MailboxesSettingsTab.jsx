"use client";

import { useCallback, useEffect, useState } from "react";
import { MailboxRow } from "@/components/mailboxes/MailboxRow";
import { MailboxesAddMenu } from "@/components/mailboxes/MailboxesAddMenu";

// Settings-page equivalent of app/(dashboard)/mailboxes/page.jsx — that page
// stays as-is (it's still the OAuth/forwarding callback target, redirected to
// as /mailboxes?success=true), this is an additional client-fetched view of
// the same data via GET /api/mail-accounts, for browsing/managing mailboxes
// without leaving Settings. Deliberately skips MailboxesOnboardingTracker —
// that component's redirect target is hardcoded to /mailboxes and only ever
// matters right after the OAuth callback, which lands on that route directly.
export function MailboxesSettingsTab() {
  const [mailboxes, setMailboxes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadMailboxes = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/mail-accounts", { cache: "no-store" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "Could not load connected mailboxes.");
      }
      setMailboxes(Array.isArray(payload?.mailboxes) ? payload.mailboxes : []);
    } catch (loadError) {
      setMailboxes([]);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load connected mailboxes.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMailboxes();
  }, [loadMailboxes]);

  return (
    <div className="max-w-3xl space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Mailboxes</h1>
          <p className="text-sm text-muted-foreground">
            Manage the email accounts Sona uses to draft replies.
          </p>
        </div>
        <MailboxesAddMenu onCreated={loadMailboxes} />
      </header>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Connected accounts</h2>
          <p className="text-sm text-muted-foreground">
            Gmail, Outlook, and forwarded inboxes currently linked to Sona.
          </p>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-background">
          {loading ? (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">Loading…</div>
          ) : error ? (
            <div role="alert" className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <p className="text-base font-medium text-foreground">Couldn’t load connected mailboxes.</p>
              <p className="text-sm text-muted-foreground">{error}</p>
              <button
                type="button"
                onClick={loadMailboxes}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                Try again
              </button>
            </div>
          ) : mailboxes.length ? (
            <div className="divide-y divide-border">
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
                  sharedFromEmail={mailbox.sharedFromEmail}
                  onChanged={loadMailboxes}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
              <p className="text-base font-medium text-foreground">
                No mailboxes connected yet. Connect your support email to start
                generating drafts.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
