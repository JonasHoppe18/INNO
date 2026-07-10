"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Copy, Mail, RotateCw, ShieldCheck, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SendingIdentityPanel } from "@/components/mailboxes/SendingIdentityPanel";
import gmailLogo from "../../../../assets/Gmail-logo.webp";
import outlookLogo from "../../../../assets/Outlook-logo.png";

const PROVIDER_CONFIG = {
  gmail: {
    label: "Gmail",
    logo: gmailLogo,
    logoAlt: "Gmail logo",
  },
  outlook: {
    label: "Outlook",
    logo: outlookLogo,
    logoAlt: "Outlook logo",
  },
  smtp: {
    label: "Other email",
    logo: null,
    logoAlt: "Other email",
  },
};

export function MailboxRow({
  provider,
  email,
  isActive,
  status,
  mailboxId,
  inboundSlug,
  sendingType,
  sendingDomain,
  domainStatus,
  domainDns,
  fromEmail,
  fromName,
  sharedFromEmail,
  managedSenderStatus = "unprovisioned",
  managedSenderDomain,
  managedSenderEmail,
  managedSenderDkimVerified = false,
  managedSenderReturnPathVerified = false,
  // Optional: fires alongside router.refresh() so client-fetched consumers
  // (the Settings page's Mailboxes tab, which has no server-rendered data
  // for router.refresh() to re-run) can refetch instead of relying on it.
  onChanged,
}) {
  const router = useRouter();
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [copyingForwarding, setCopyingForwarding] = useState(false);
  const [forwardingCopied, setForwardingCopied] = useState(false);
  const [checkingManagedSender, setCheckingManagedSender] = useState(false);

  const config = PROVIDER_CONFIG[provider] || {
    label: provider,
    logo: null,
    logoAlt: "Mailbox provider",
  };

  const handleDisconnect = async () => {
    if (!provider || isDisconnecting) return;
    const confirmed = window.confirm("Are you sure you want to disconnect this mailbox?");
    if (!confirmed) return;
    setIsDisconnecting(true);
    try {
      const res = await fetch("/api/integrations/mail-accounts/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, id: mailboxId }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "Disconnect failed.");
      }
      toast.success(`${config.label} disconnected.`);
      router.refresh();
      onChanged?.();
    } catch (error) {
      toast.error(error?.message || "Disconnect failed.");
    } finally {
      setIsDisconnecting(false);
    }
  };

  const isForwarding = provider === "smtp";
  const isDisconnected = status === "disconnected";
  const forwardingAddress = inboundSlug ? `${inboundSlug}@inbound.sona-ai.dk` : "";

  const forwardingLabel = isDisconnected ? "Disconnected" : "Active";
  const forwardingStyles = isDisconnected
    ? "border-rose-200 bg-rose-50 text-rose-700"
    : "border-emerald-200 bg-emerald-50 text-emerald-700";
  const forwardingDot = isDisconnected ? "bg-rose-500" : "bg-emerald-500";

  const statusLabel = isForwarding
    ? forwardingLabel
    : isDisconnected
    ? "Disconnected"
    : isActive
    ? "Active"
    : "Disconnected";
  const statusStyles = isForwarding
    ? forwardingStyles
    : isDisconnected
    ? "border-rose-200 bg-rose-50 text-rose-700"
    : isActive
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-rose-200 bg-rose-50 text-rose-700";
  const dotStyles = isForwarding
    ? forwardingDot
    : isDisconnected
    ? "bg-rose-500"
    : isActive
    ? "bg-emerald-500"
    : "bg-rose-500";

  const usesCustomSender = sendingType === "custom";
  const customSenderVerified = usesCustomSender && domainStatus === "verified";
  const managedSenderVerified =
    !usesCustomSender &&
    managedSenderStatus === "verified" &&
    managedSenderDkimVerified &&
    managedSenderReturnPathVerified;
  const managedSenderPending =
    !usesCustomSender && ["pending", "provisioning"].includes(managedSenderStatus);
  const senderVerified = customSenderVerified || managedSenderVerified;
  const sendingAddress =
    (customSenderVerified && fromEmail) || sharedFromEmail || managedSenderEmail || "support@sona-ai.dk";
  const verificationLabel = senderVerified
    ? "Verified"
    : usesCustomSender || managedSenderPending
    ? "Verifying"
    : "Fallback active";
  const verificationDescription = customSenderVerified
    ? `${sendingDomain || "Your custom domain"} is authenticated for sending.`
    : usesCustomSender
    ? "Add the DNS records below, then check the verification status."
    : managedSenderVerified
    ? `${managedSenderDomain} is authenticated and managed by Sona.`
    : managedSenderPending
    ? `${managedSenderDomain || "Your Sona sender domain"} is being verified. Replies use ${sendingAddress} until it is ready.`
    : `Replies currently send safely from ${sendingAddress}. Set up a branded Sona sender when you are ready.`;

  const handleCopyForwarding = async () => {
    if (!forwardingAddress || copyingForwarding) return;
    setCopyingForwarding(true);
    try {
      await navigator.clipboard.writeText(forwardingAddress);
      toast.success("Forwarding address copied.");
      setForwardingCopied(true);
      setTimeout(() => setForwardingCopied(false), 1500);
    } catch {
      toast.error("Could not copy forwarding address.");
    } finally {
      setCopyingForwarding(false);
    }
  };

  const handleCheckManagedSender = async () => {
    if (!mailboxId || checkingManagedSender) return;
    setCheckingManagedSender(true);
    try {
      const response = await fetch(
        `/api/mail-accounts/${mailboxId}/managed-domain/status`,
        { method: "POST" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not check the sender domain.");
      }
      toast.success(
        payload?.managed_sender?.status === "verified"
          ? "Sender domain verified."
          : "Verification is still in progress.",
      );
      router.refresh();
      onChanged?.();
    } catch (error) {
      toast.error(error?.message || "Could not check the sender domain.");
      router.refresh();
      onChanged?.();
    } finally {
      setCheckingManagedSender(false);
    }
  };

  return (
    <>
      <div
        className={cn(
          "flex flex-col gap-4 px-4 py-4 transition-colors hover:bg-gray-50/50",
          isDisconnected && "opacity-60"
        )}
      >
        <div className="flex items-center justify-between gap-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border bg-white">
              {config.logo ? (
                <Image
                  src={config.logo}
                  alt={config.logoAlt}
                  width={28}
                  height={28}
                  className="object-contain"
                />
              ) : provider === "smtp" ? (
                <Mail className="h-5 w-5 text-slate-500" />
              ) : (
                <span className="text-xs font-medium text-slate-500">{config.label}</span>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900" title={email}>
                {email || "Unknown address"}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs text-gray-500">{config.label}</p>
                {isForwarding && forwardingAddress ? (
                  <>
                    <span className="text-[11px] text-gray-300">•</span>
                    <code className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">
                      {forwardingAddress}
                    </code>
                    <button
                      type="button"
                      onClick={handleCopyForwarding}
                      className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-700"
                    >
                      <Copy className="h-3 w-3" />
                      {forwardingCopied ? "Copied!" : "Copy"}
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium ${statusStyles}`}
            >
              <span className={`h-2 w-2 rounded-full ${dotStyles}`} />
              {statusLabel}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleDisconnect}
              disabled={isDisconnecting}
              aria-label="Disconnect mailbox"
              className="text-gray-400 hover:text-red-600"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {isForwarding ? (
          <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div
                className={cn(
                  "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border",
                  senderVerified
                    ? "border-primary/20 bg-primary/10 text-primary"
                    : "border-border bg-muted text-muted-foreground",
                )}
              >
                <ShieldCheck className="size-4" />
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Sending identity
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="break-all text-sm font-medium text-foreground">
                    {fromName && customSenderVerified ? `${fromName} ` : ""}
                    {sendingAddress}
                  </p>
                  <Badge
                    variant={senderVerified ? "default" : "secondary"}
                    className={cn(
                      senderVerified && "bg-primary/10 text-primary shadow-none hover:bg-primary/10",
                    )}
                  >
                    {verificationLabel}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {verificationDescription}
                </p>
              </div>
            </div>
            {!usesCustomSender && !managedSenderVerified ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCheckManagedSender}
                disabled={checkingManagedSender}
              >
                <RotateCw data-icon="inline-start" />
                {checkingManagedSender
                  ? "Checking…"
                  : managedSenderStatus === "unprovisioned"
                  ? "Set up sender"
                  : "Check status"}
              </Button>
            ) : null}
          </div>
        ) : null}

        {isForwarding ? (
          <SendingIdentityPanel
            mailboxId={mailboxId}
            initialSendingType={sendingType}
            initialSendingDomain={sendingDomain}
            initialDomainStatus={domainStatus}
            initialDomainDns={domainDns}
            initialFromEmail={fromEmail}
            initialFromName={fromName}
            sharedFromEmail={sharedFromEmail}
            onChanged={() => {
              router.refresh();
              onChanged?.();
            }}
          />
        ) : null}
      </div>
    </>
  );
}
