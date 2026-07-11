"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mail } from "lucide-react";
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
  const checkedManagedSenders = useRef(new Set());

  const normalizeConnectedChannels = useCallback(
    (rows = []) =>
      (Array.isArray(rows) ? rows : [])
        .filter(
          (mailbox) =>
            String(mailbox?.status || "").toLowerCase() !== "disconnected" &&
            mailbox?.isActive !== false,
        )
        .slice(0, 1),
    [],
  );

  const loadMailboxes = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/mail-accounts", { cache: "no-store" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "Could not load the email channel.");
      }
      const nextMailboxes = normalizeConnectedChannels(payload?.mailboxes);
      setMailboxes(nextMailboxes);

      const pendingManagedSenders = nextMailboxes.filter(
        (mailbox) =>
          mailbox?.provider === "smtp" &&
          mailbox?.sendingType !== "custom" &&
          ["pending", "provisioning"].includes(mailbox?.managedSenderStatus) &&
          !checkedManagedSenders.current.has(mailbox.id),
      );
      for (const mailbox of pendingManagedSenders) {
        checkedManagedSenders.current.add(mailbox.id);
      }
      if (pendingManagedSenders.length) {
        void Promise.allSettled(
          pendingManagedSenders.map((mailbox) =>
            fetch(`/api/mail-accounts/${mailbox.id}/managed-domain/status`, {
              method: "POST",
            }),
          ),
        )
          .then(async () => {
            const refreshedResponse = await fetch("/api/mail-accounts", {
              cache: "no-store",
            });
            const refreshedPayload = await refreshedResponse.json().catch(() => ({}));
            if (refreshedResponse.ok && Array.isArray(refreshedPayload?.mailboxes)) {
              setMailboxes(normalizeConnectedChannels(refreshedPayload.mailboxes));
            }
          })
          .catch(() => {
            // The saved status remains visible and can still be refreshed manually.
          });
      }
    } catch (loadError) {
      setMailboxes([]);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load the email channel.",
      );
    } finally {
      setLoading(false);
    }
  }, [normalizeConnectedChannels]);

  useEffect(() => {
    loadMailboxes();
  }, [loadMailboxes]);

  return (
    <div className="w-full space-y-5">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Channels</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Manage where customer conversations enter Sona. Email is the first supported channel.
          </p>
        </div>
        {!loading && !error && mailboxes.length === 0 ? (
          <MailboxesAddMenu
            onCreated={loadMailboxes}
            buttonLabel="Connect email"
            buttonClassName="shrink-0 active:scale-[0.97]"
          />
        ) : null}
      </header>

      <section className="overflow-hidden rounded-xl border border-border/90 bg-card">
        <div className="px-6 pb-2 pt-5">
          <h2 className="text-base font-semibold text-foreground">Email</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Your support inbox, forwarding address and sender identity.
          </p>
        </div>
        <div className="px-6 pb-2">
          {loading ? (
            <div className="space-y-3 py-8">
              <div className="h-5 w-48 animate-pulse rounded bg-muted" />
              <div className="h-4 w-72 max-w-full animate-pulse rounded bg-muted" />
              <div className="h-16 animate-pulse rounded-lg bg-muted/70" />
            </div>
          ) : error ? (
            <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="text-base font-medium text-foreground">Couldn’t load the email channel.</p>
              <p className="text-sm text-muted-foreground">{error}</p>
              <button
                type="button"
                onClick={loadMailboxes}
                className="rounded-md bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-sm transition-transform duration-150 hover:bg-muted active:scale-[0.97]"
              >
                Try again
              </button>
            </div>
          ) : mailboxes.length ? (
            <div className="divide-y divide-border/80">
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
                  domainMailboxId={mailbox.domainMailboxId}
                  domainInherited={mailbox.domainInherited}
                  fromEmail={mailbox.fromEmail}
                  fromName={mailbox.fromName}
                  sharedFromEmail={mailbox.sharedFromEmail}
                  managedSenderStatus={mailbox.managedSenderStatus}
                  managedSenderDomain={mailbox.managedSenderDomain}
                  managedSenderEmail={mailbox.managedSenderEmail}
                  managedSenderDkimVerified={mailbox.managedSenderDkimVerified}
                  managedSenderReturnPathVerified={mailbox.managedSenderReturnPathVerified}
                  onChanged={loadMailboxes}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center py-10 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <Mail className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-foreground">Connect your support email</h3>
              <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
                Forward your existing support inbox to Sona to receive conversations and generate replies.
              </p>
            </div>
          )}
        </div>
      </section>

      <p className="text-xs leading-5 text-muted-foreground">
        Additional channel types, including chat and social, will appear here when available.
      </p>
    </div>
  );
}
