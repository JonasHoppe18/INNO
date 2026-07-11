"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Copy, Globe2, Mail, RotateCw, ShieldCheck, Unplug } from "lucide-react";
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
    label: "Email forwarding",
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
  domainMailboxId,
  domainInherited = false,
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
  const [domainExpanded, setDomainExpanded] = useState(false);

  const config = PROVIDER_CONFIG[provider] || {
    label: provider,
    logo: null,
    logoAlt: "Mailbox provider",
  };

  const handleDisconnect = async () => {
    if (!provider || isDisconnecting) return;
    const confirmed = window.confirm("Are you sure you want to disconnect this email channel?");
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
      toast.success("Email channel disconnected.");
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
    ? "bg-rose-50 text-rose-700"
    : "bg-emerald-50 text-emerald-700";
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
    ? "bg-rose-50 text-rose-700"
    : isActive
    ? "bg-emerald-50 text-emerald-700"
    : "bg-rose-50 text-rose-700";
  const dotStyles = isForwarding
    ? forwardingDot
    : isDisconnected
    ? "bg-rose-500"
    : isActive
    ? "bg-emerald-500"
    : "bg-rose-500";

  const usesCustomSender = sendingType === "custom";
  const hasSavedDomainSetup = Boolean(
    sendingDomain && Array.isArray(domainDns?.records) && domainDns.records.length,
  );
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
    <div className={cn(isDisconnected && "opacity-60")}>
      <div className="flex flex-col gap-4 border-b border-border/80 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
            {config.logo ? (
              <Image
                src={config.logo}
                alt={config.logoAlt}
                width={24}
                height={24}
                className="object-contain"
              />
            ) : provider === "smtp" ? (
              <Mail className="h-4 w-4 text-primary" />
            ) : (
              <span className="text-xs font-medium text-primary">{config.label}</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">Support email</p>
            <p className="truncate text-xs text-muted-foreground" title={email}>
              {email || "Unknown address"} · {config.label}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <span
            className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium ${statusStyles}`}
          >
            <span className={`h-2 w-2 rounded-full ${dotStyles}`} />
            {statusLabel}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleDisconnect}
            disabled={isDisconnecting}
            aria-label="Disconnect email channel"
            className="gap-1.5 text-muted-foreground transition-transform duration-150 hover:bg-red-50 hover:text-red-600 active:scale-[0.97]"
          >
            <Unplug className="h-3.5 w-3.5" />
            {isDisconnecting ? "Disconnecting…" : "Disconnect"}
          </Button>
        </div>
      </div>

      {isForwarding && forwardingAddress ? (
        <div className="flex flex-col gap-3 border-b border-border/80 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Mail className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Forwarding address</p>
              <p className="text-xs text-muted-foreground">Forward customer emails to this address.</p>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-2 sm:max-w-[50%]">
            <code className="min-w-0 truncate rounded-md bg-muted px-2 py-1.5 text-xs text-foreground">
              {forwardingAddress}
            </code>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCopyForwarding}
              className="shrink-0 gap-1.5 text-muted-foreground"
            >
              <Copy className="h-3.5 w-3.5" />
              {forwardingCopied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      ) : null}

      {isForwarding ? (
        <div className="flex flex-col gap-3 border-b border-border/80 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <ShieldCheck className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Sending identity</p>
              <p className="break-all text-xs text-muted-foreground">
                {fromName && customSenderVerified ? `${fromName} · ` : ""}{sendingAddress}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <Badge
              variant="secondary"
              className={cn(
                "font-medium shadow-none",
                senderVerified && "bg-emerald-50 text-emerald-700 hover:bg-emerald-50",
              )}
            >
              {verificationLabel}
            </Badge>
            {!usesCustomSender && !managedSenderVerified ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleCheckManagedSender}
                disabled={checkingManagedSender}
                className="gap-1.5 text-muted-foreground"
              >
                <RotateCw className="h-3.5 w-3.5" />
                {checkingManagedSender
                  ? "Checking…"
                  : managedSenderStatus === "unprovisioned"
                  ? "Set up"
                  : "Check status"}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {isForwarding ? (
        <div>
          <button
            type="button"
            onClick={() => setDomainExpanded((current) => !current)}
            aria-expanded={domainExpanded}
            className="flex w-full items-center gap-4 py-5 text-left transition-colors hover:text-foreground active:scale-[0.995]"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Globe2 className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">Sending domain</p>
              <p className="text-xs text-muted-foreground">
                {customSenderVerified
                  ? `${sendingDomain} is verified.`
                  : hasSavedDomainSetup
                  ? `${sendingDomain} · DNS verification pending${domainInherited ? " (workspace setup)" : ""}.`
                  : usesCustomSender
                  ? "DNS verification is pending."
                  : "Use Sona's sender or connect your own domain."}
              </p>
            </div>
            <span className="mr-2 flex items-center gap-2 text-sm font-medium text-muted-foreground">
              {hasSavedDomainSetup ? (
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-medium",
                    domainStatus === "verified"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-amber-50 text-amber-700",
                  )}
                >
                  {domainStatus === "verified" ? "Verified" : "Pending"}
                </span>
              ) : null}
              Manage
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform duration-200",
                  domainExpanded && "rotate-180",
                )}
              />
            </span>
          </button>

          {domainExpanded ? (
            <div className="border-t border-border/80 pb-5">
              <SendingIdentityPanel
                mailboxId={domainMailboxId || mailboxId}
                initialSendingType={sendingType}
                initialSendingDomain={sendingDomain}
                initialDomainStatus={domainStatus}
                initialDomainDns={domainDns}
                initialFromEmail={fromEmail}
                initialFromName={fromName}
                sharedFromEmail={sharedFromEmail}
                hideHeader
                onChanged={() => {
                  router.refresh();
                  onChanged?.();
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
