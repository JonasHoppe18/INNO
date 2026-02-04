"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

function normalizeDomain(input) {
  return String(input || "").trim().toLowerCase().replace(/\.$/, "");
}

function getInitialStep(domainDns) {
  return domainDns && Array.isArray(domainDns.records) && domainDns.records.length > 0
    ? "dns"
    : "form";
}

export function SendingIdentityModal({
  open,
  onOpenChange,
  mailboxId,
  initialSendingType,
  initialSendingDomain,
  initialDomainStatus,
  initialDomainDns,
  initialFromEmail,
  initialFromName,
  onChanged,
}) {
  const [domain, setDomain] = useState(initialSendingDomain || "");
  const [fromLocalPart, setFromLocalPart] = useState("");
  const [fromName, setFromName] = useState(initialFromName || "");
  const [sendingType, setSendingType] = useState(initialSendingType || "shared");
  const [domainStatus, setDomainStatus] = useState(initialDomainStatus || "pending");
  const [dnsData, setDnsData] = useState(initialDomainDns || null);
  const [step, setStep] = useState(getInitialStep(initialDomainDns));
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [copiedKey, setCopiedKey] = useState(null);

  useEffect(() => {
    if (!open) return;
    setDomain(initialSendingDomain || "");
    const normalizedDomain = normalizeDomain(initialSendingDomain || "");
    const normalizedFromEmail = String(initialFromEmail || "").trim().toLowerCase();
    const domainSuffix = normalizedDomain ? `@${normalizedDomain}` : "";
    if (domainSuffix && normalizedFromEmail.endsWith(domainSuffix)) {
      setFromLocalPart(normalizedFromEmail.slice(0, -domainSuffix.length));
    } else {
      setFromLocalPart("");
    }
    setFromName(initialFromName || "");
    setSendingType(initialSendingType || "shared");
    setDomainStatus(initialDomainStatus || "pending");
    setDnsData(initialDomainDns || null);
    setStep(getInitialStep(initialDomainDns));
  }, [
    open,
    initialSendingType,
    initialSendingDomain,
    initialFromEmail,
    initialFromName,
    initialDomainStatus,
    initialDomainDns,
  ]);

  const records = useMemo(() => {
    if (!dnsData || !Array.isArray(dnsData.records)) return [];
    return dnsData.records;
  }, [dnsData]);

  const hasDnsSetup = step === "dns" && records.length > 0;
  const isVerified = domainStatus === "verified";
  const domainSuffix = domain ? `@${normalizeDomain(domain)}` : "";
  const resolvedFromEmail =
    fromLocalPart.trim() && domainSuffix
      ? `${fromLocalPart.trim().toLowerCase()}${domainSuffix}`
      : null;

  const handleSetup = async (event) => {
    event.preventDefault();
    if (!mailboxId) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/mail-accounts/${mailboxId}/domain/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: domain.trim(),
          from_email: resolvedFromEmail || undefined,
          from_name: fromName.trim() || undefined,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "Could not start domain setup.");
      }
      setDomainStatus(payload?.domain_status || "pending");
      setDnsData(payload?.domain_dns || null);
      setStep("dns");
      const payloadFromEmail = String(payload?.from_email || "").trim().toLowerCase();
      const normalizedPayloadDomain = normalizeDomain(domain);
      const payloadSuffix = normalizedPayloadDomain ? `@${normalizedPayloadDomain}` : "";
      if (payloadSuffix && payloadFromEmail.endsWith(payloadSuffix)) {
        setFromLocalPart(payloadFromEmail.slice(0, -payloadSuffix.length));
      }
      setSendingType("custom");
      toast.success("Domain setup started. Add the DNS records below.");
      onChanged?.();
    } catch (error) {
      toast.error(error?.message || "Could not start domain setup.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCheckStatus = async () => {
    if (!mailboxId) return;
    setChecking(true);
    try {
      const res = await fetch(`/api/mail-accounts/${mailboxId}/domain/status`, {
        method: "GET",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "Could not check domain status.");
      }
      const nextStatus = payload?.domain_status || "pending";
      setDomainStatus(nextStatus);
      if (nextStatus === "verified") {
        toast.success("Domain verified. You can now send from your own email.");
      } else {
        toast.message("Still pending", {
          description: "DNS has not propagated yet. Please try again in a few minutes.",
        });
      }
      onChanged?.();
    } catch (error) {
      toast.error(error?.message || "Could not check domain status.");
    } finally {
      setChecking(false);
    }
  };

  const handleDisableCustom = async () => {
    if (!mailboxId) return;
    setDisabling(true);
    try {
      const res = await fetch(`/api/mail-accounts/${mailboxId}/domain/disable`, {
        method: "POST",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "Could not switch to shared sending.");
      }
      setDomainStatus(initialDomainStatus || "pending");
      setSendingType("shared");
      toast.success("Shared sending enabled.");
      onChanged?.();
      onOpenChange(false);
    } catch (error) {
      toast.error(error?.message || "Could not switch to shared sending.");
    } finally {
      setDisabling(false);
    }
  };

  const copyText = async (value) => {
    try {
      await navigator.clipboard.writeText(String(value || ""));
      toast.success("Copied.");
      setCopiedKey(value);
      setTimeout(() => {
        setCopiedKey((current) => (current === value ? null : current));
      }, 1500);
    } catch {
      toast.error("Could not copy.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Use my own domain</DialogTitle>
          <DialogDescription>
            Verify your domain in DNS and then send replies from your own support email.
          </DialogDescription>
        </DialogHeader>

        {hasDnsSetup ? (
          <div className="space-y-4">
            <div className="rounded-lg border bg-slate-50 px-4 py-3 text-sm text-slate-700">
              Add these DNS records for <strong>{dnsData?.domain || domain}</strong>.
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[560px] table-fixed text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="w-24 px-3 py-2">Type</th>
                    <th className="w-56 px-3 py-2">Host</th>
                    <th className="px-3 py-2">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record, index) => (
                    <tr key={`${record.type}-${record.host}-${index}`} className="border-t">
                      <td className="px-3 py-2 font-medium">{record.type}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <code className="max-w-[190px] truncate">{record.host}</code>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => copyText(record.host)}
                          >
                            <Copy className="h-3.5 w-3.5" />
                            {copiedKey === record.host ? "Copied!" : "Copy"}
                          </Button>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <code className="max-w-[280px] break-all text-xs leading-5 sm:max-w-[320px]">
                            {record.value}
                          </code>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => copyText(record.value)}
                          >
                            <Copy className="h-3.5 w-3.5" />
                            {copiedKey === record.value ? "Copied!" : "Copy"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {isVerified ? (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                Custom domain verified. Sona will now send from {resolvedFromEmail || initialFromEmail}.
              </div>
            ) : null}

            <DialogFooter className="flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setStep("form")}
                  disabled={disabling || submitting || checking}
                  className="text-slate-600"
                >
                  Use another domain
                </Button>
                {sendingType === "custom" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleDisableCustom}
                    disabled={disabling || submitting || checking}
                    className="text-slate-600"
                  >
                    {disabling ? "Switching..." : "Use shared sending"}
                  </Button>
                ) : null}
              </div>
              <div className="flex w-full justify-end gap-2 sm:w-auto">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="min-w-24">
                  Close
                </Button>
                {!isVerified ? (
                  <Button type="button" onClick={handleCheckStatus} disabled={checking} className="min-w-32">
                    {checking ? "Checking..." : "Check status"}
                  </Button>
                ) : null}
              </div>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSetup} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Domain</label>
              <Input
                value={domain}
                onChange={(event) => setDomain(event.target.value)}
                placeholder="company.com"
                autoComplete="off"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">From email (optional)</label>
              <div className="flex items-center overflow-hidden rounded-md border border-input bg-background">
                <Input
                  value={fromLocalPart}
                  onChange={(event) => setFromLocalPart(event.target.value.replace(/\s+/g, ""))}
                  placeholder="support"
                  autoComplete="off"
                  className="rounded-none border-0 shadow-none focus-visible:ring-0"
                />
                <div className="px-3 text-sm text-slate-500">{domainSuffix || "@domain.com"}</div>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">From name (optional)</label>
              <Input
                value={fromName}
                onChange={(event) => setFromName(event.target.value)}
                placeholder="Customer Support"
                autoComplete="off"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Starting..." : "Start domain setup"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
