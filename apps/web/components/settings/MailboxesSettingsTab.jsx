"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  SettingsEmptyState,
  SettingsGroup,
  SettingsPage,
} from "@/components/settings/ui/settings-layout";
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
    <SettingsPage
      width="wide"
      title="Mailboxes"
      description="Manage where customer conversations enter Sona. Email is the first supported channel."
      actions={
        !loading && !error && mailboxes.length === 0 ? (
          <MailboxesAddMenu onCreated={loadMailboxes} buttonLabel="Connect email" buttonClassName="shrink-0" />
        ) : null
      }
    >
      <SettingsGroup title="Email" description="Your support inbox, forwarding address and sender identity.">
        {loading ? (
          <div className="space-y-3 py-6">
            <div className="h-4 w-48 animate-pulse rounded bg-muted" />
            <div className="h-3.5 w-72 max-w-full animate-pulse rounded bg-muted" />
          </div>
        ) : error ? (
          <div role="alert" className="py-3">
            <SettingsEmptyState
              title="Couldn’t load the email channel."
              description={error}
              action={
                <Button type="button" size="sm" variant="outline" onClick={loadMailboxes}>
                  Try again
                </Button>
              }
            />
          </div>
        ) : mailboxes.length ? (
          <div>
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
          <div className="py-3">
            <SettingsEmptyState
              title="Connect your support email"
              description="Forward your existing support inbox to Sona to receive conversations and generate replies."
              action={<MailboxesAddMenu onCreated={loadMailboxes} buttonLabel="Connect email" />}
            />
          </div>
        )}
      </SettingsGroup>
    </SettingsPage>
  );
}
