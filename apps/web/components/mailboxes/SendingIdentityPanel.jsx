"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Copy, Globe2, MailCheck, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function normalizeDomain(input) {
  return String(input || "").trim().toLowerCase().replace(/\.$/, "");
}

function getInitialStep(domainDns) {
  return domainDns && Array.isArray(domainDns.records) && domainDns.records.length > 0
    ? "dns"
    : "form";
}

export function SendingIdentityPanel({
  mailboxId,
  initialSendingType,
  initialSendingDomain,
  initialDomainStatus,
  initialDomainDns,
  initialFromEmail,
  initialFromName,
  sharedFromEmail,
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
  const activeFromEmail = isVerified
    ? resolvedFromEmail || initialFromEmail
    : sharedFromEmail || "kundeservice@webshop.sona-ai.dk";

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
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50/60">
      <div className="border-b bg-white px-4 py-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg border bg-slate-50 text-slate-700">
            <Globe2 className="h-4 w-4" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-slate-950">Sending domain</h3>
            <p className="text-sm text-slate-500">
              Verify your own domain, or keep sending from the branded Sona fallback.
            </p>
          </div>
        </div>
      </div>

      {hasDnsSetup ? (
        <div className="space-y-5 p-4">
            <div
              className={cn(
                "flex items-start gap-3 rounded-lg border px-4 py-3",
                isVerified
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-amber-200 bg-amber-50 text-amber-900"
              )}
            >
              <div
                className={cn(
                  "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white",
                  isVerified ? "text-emerald-600" : "text-amber-600"
                )}
              >
                {isVerified ? <CheckCircle2 className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
              </div>
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium">
                  {isVerified ? "Custom domain is verified" : "Waiting for DNS verification"}
                </p>
                <p className="text-sm leading-5">
                  {isVerified
                    ? `Sona will send from ${activeFromEmail}.`
                    : `Until DNS is verified, Sona sends from ${activeFromEmail}.`}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-medium text-slate-900">DNS records for {dnsData?.domain || domain}</h3>
                <p className="text-sm text-slate-500">
                  Add these at your DNS provider, then check the status.
                </p>
              </div>

              <div className="space-y-3">
                {records.map((record, index) => (
                  <div
                    key={`${record.type}-${record.host}-${index}`}
                    className="rounded-lg border bg-white p-3 shadow-sm"
                  >
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                        {record.type}
                      </span>
                      <span className="text-xs text-slate-400">Record {index + 1}</span>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
                      <div className="min-w-0 space-y-1">
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Host</p>
                        <div className="flex items-center gap-2 rounded-md bg-slate-50 px-2 py-1.5">
                          <code className="min-w-0 flex-1 truncate text-xs text-slate-800">{record.host}</code>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 shrink-0 px-2 text-xs"
                            onClick={() => copyText(record.host)}
                          >
                            <Copy className="h-3.5 w-3.5" />
                            {copiedKey === record.host ? "Copied!" : "Copy"}
                          </Button>
                        </div>
                      </div>
                      <div className="min-w-0 space-y-1">
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Value</p>
                        <div className="flex items-start gap-2 rounded-md bg-slate-50 px-2 py-1.5">
                          <code className="min-w-0 flex-1 break-all text-xs leading-5 text-slate-800">{record.value}</code>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 shrink-0 px-2 text-xs"
                            onClick={() => copyText(record.value)}
                          >
                            <Copy className="h-3.5 w-3.5" />
                            {copiedKey === record.value ? "Copied!" : "Copy"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
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
                {!isVerified ? (
                  <Button type="button" onClick={handleCheckStatus} disabled={checking} className="min-w-32">
                    {checking ? "Checking..." : "Check status"}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSetup} className="space-y-5 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border bg-slate-50 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-900">
                  <MailCheck className="h-4 w-4 text-slate-500" />
                  Current sender
                </div>
                <p className="break-all text-sm text-slate-700">
                  {sharedFromEmail || "kundeservice@webshop.sona-ai.dk"}
                </p>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  Used automatically until your own domain is verified.
                </p>
              </div>
              <div className="rounded-lg border bg-white p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-900">
                  <ShieldCheck className="h-4 w-4 text-slate-500" />
                  Custom sender
                </div>
                <p className="break-all text-sm text-slate-700">
                  {resolvedFromEmail || `support${domainSuffix || "@company.com"}`}
                </p>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  Becomes active after DNS verification.
                </p>
              </div>
            </div>

            <div className="space-y-4 rounded-lg border bg-white p-4">
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
                <label className="text-sm font-medium text-slate-700">From email</label>
                <div className="flex items-center overflow-hidden rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                  <Input
                    value={fromLocalPart}
                    onChange={(event) => setFromLocalPart(event.target.value.replace(/\s+/g, ""))}
                    placeholder="support"
                    autoComplete="off"
                    className="rounded-none border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                  <div className="shrink-0 border-l px-3 text-sm text-slate-500">{domainSuffix || "@domain.com"}</div>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">From name</label>
                <Input
                  value={fromName}
                  onChange={(event) => setFromName(event.target.value)}
                  placeholder="Customer Support"
                  autoComplete="off"
                />
              </div>
            </div>

            <div className="flex justify-end border-t pt-4">
              <Button type="submit" disabled={submitting}>
                {submitting ? "Starting..." : "Start domain setup"}
              </Button>
            </div>
          </form>
        )}
    </section>
  );
}
