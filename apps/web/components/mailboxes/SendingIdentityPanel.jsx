"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, Copy, Globe2, Loader2, ShieldCheck } from "lucide-react";
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
  hideHeader = false,
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
  const [verificationFlags, setVerificationFlags] = useState({
    dkim_verified: initialDomainStatus === "verified",
    return_path_verified: initialDomainStatus === "verified",
  });

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
    setVerificationFlags({
      dkim_verified: initialDomainStatus === "verified",
      return_path_verified: initialDomainStatus === "verified",
    });
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
    : sharedFromEmail || "support@sona-ai.dk";

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
      setVerificationFlags({ dkim_verified: false, return_path_verified: false });
      const payloadFromEmail = String(payload?.from_email || "").trim().toLowerCase();
      const normalizedPayloadDomain = normalizeDomain(domain);
      const payloadSuffix = normalizedPayloadDomain ? `@${normalizedPayloadDomain}` : "";
      if (payloadSuffix && payloadFromEmail.endsWith(payloadSuffix)) {
        setFromLocalPart(payloadFromEmail.slice(0, -payloadSuffix.length));
      }
      setSendingType("custom");
      toast.success("DNS records generated. Add them at your domain provider.");
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
      setVerificationFlags({
        dkim_verified: Boolean(payload?.raw_flags?.dkim_verified),
        return_path_verified: Boolean(payload?.raw_flags?.return_path_verified),
      });
      if (nextStatus === "verified") {
        toast.success("Domain verified. You can now send from your own email.");
        onChanged?.();
      } else {
        const verifiedCount = [
          payload?.raw_flags?.dkim_verified,
          payload?.raw_flags?.return_path_verified,
        ].filter(Boolean).length;
        toast.message("DNS verification is still pending", {
          description: `${verifiedCount} of 2 records verified. DNS changes can take some time to propagate.`,
        });
      }
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

  const isRecordVerified = (record) => {
    const type = String(record?.type || "").toUpperCase();
    if (type === "TXT") return Boolean(verificationFlags.dkim_verified);
    if (type === "CNAME") return Boolean(verificationFlags.return_path_verified);
    return isVerified;
  };

  return (
    <section className={cn(hideHeader ? "pt-5" : "mt-5 border-t border-border/70 pt-5")}>
      {!hideHeader ? <div>
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-background text-muted-foreground">
            <Globe2 className="h-4 w-4" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-foreground">Sending domain</h3>
            <p className="text-sm text-muted-foreground">
              Verify your own domain, or keep sending from the branded Sona fallback.
            </p>
          </div>
        </div>
      </div> : null}

      {hasDnsSetup ? (
        <div className={cn("space-y-5", !hideHeader && "mt-5")}>
            <div
              className={cn(
                "flex items-start gap-3 rounded-lg px-4 py-3",
                isVerified
                  ? "bg-emerald-50 text-emerald-800"
                  : "bg-amber-50 text-amber-900"
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
                <h3 className="text-sm font-medium text-foreground">DNS records for {dnsData?.domain || domain}</h3>
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  Add both records at your DNS provider. Changes can take up to 48 hours to propagate.
                </p>
              </div>

              <div className="overflow-hidden rounded-lg border border-border">
                {records.map((record, index) => {
                  const recordVerified = isRecordVerified(record);
                  return (
                    <div
                      key={`${record.type}-${record.host}-${index}`}
                      className={cn("space-y-3 p-4", index > 0 && "border-t border-border")}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="rounded-md bg-muted px-2 py-1 text-xs font-semibold text-foreground">
                          {record.type}
                        </span>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                            recordVerified
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-amber-50 text-amber-700",
                          )}
                        >
                          <span className={cn("h-1.5 w-1.5 rounded-full", recordVerified ? "bg-emerald-500" : "bg-amber-500")} />
                          {recordVerified ? "Verified" : "Pending"}
                        </span>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-[minmax(140px,0.65fr)_minmax(0,1.35fr)]">
                        {[
                          { label: "Host", value: record.host },
                          { label: "Value", value: record.value },
                        ].map((field) => (
                          <div key={field.label} className="min-w-0 space-y-1.5">
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{field.label}</p>
                            <div className="flex items-start gap-2 rounded-md bg-muted/60 px-2.5 py-2">
                              <code className="min-w-0 flex-1 break-all text-xs leading-5 text-foreground">{field.value}</code>
                              <button
                                type="button"
                                onClick={() => copyText(field.value)}
                                aria-label={`Copy ${field.label.toLowerCase()}`}
                                className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                              >
                                {copiedKey === field.value ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setStep("form")}
                  disabled={disabling || submitting || checking}
                  className="text-muted-foreground"
                >
                  Use another domain
                </Button>
                {sendingType === "custom" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleDisableCustom}
                    disabled={disabling || submitting || checking}
                    className="text-muted-foreground"
                  >
                    {disabling ? "Switching..." : "Use shared sending"}
                  </Button>
                ) : null}
              </div>
              {!isVerified ? (
                <Button
                  type="button"
                  onClick={handleCheckStatus}
                  disabled={checking}
                  className="min-w-32 gap-2 transition-transform duration-150 active:scale-[0.97]"
                >
                  {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  {checking ? "Verifying…" : "Verify DNS"}
                </Button>
              ) : (
                <div className="inline-flex items-center gap-2 text-sm font-medium text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" />
                  Domain verified
                </div>
              )}
            </div>
          </div>
        ) : (
          <form onSubmit={handleSetup} className={cn("max-w-3xl space-y-6", !hideHeader && "mt-5")}>
            <div className="flex items-center gap-3 text-xs font-medium">
              <span className="inline-flex items-center gap-2 text-foreground">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">1</span>
                Configure sender
              </span>
              <span className="h-px w-8 bg-border" />
              <span className="inline-flex items-center gap-2 text-muted-foreground">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted">2</span>
                Add & verify DNS
              </span>
            </div>

            <div>
              <h3 className="text-base font-semibold text-foreground">Set up a custom domain</h3>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                Choose the address customers will see. We’ll generate the TXT and CNAME records in the next step.
              </p>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Domain</label>
                <Input
                  value={domain}
                  onChange={(event) => setDomain(event.target.value)}
                  placeholder="yourcompany.com"
                  autoComplete="off"
                  required
                  className="max-w-xl"
                />
                <p className="text-xs text-muted-foreground">Enter the root domain without https:// or www.</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">From email</label>
                  <div className="flex items-center overflow-hidden rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                    <Input
                      value={fromLocalPart}
                      onChange={(event) => setFromLocalPart(event.target.value.replace(/\s+/g, ""))}
                      placeholder="support"
                      autoComplete="off"
                      className="rounded-none border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                    />
                    <div className="shrink-0 border-l border-border px-3 text-sm text-muted-foreground">{domainSuffix || "@yourcompany.com"}</div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">From name <span className="font-normal text-muted-foreground">(optional)</span></label>
                  <Input
                    value={fromName}
                    onChange={(event) => setFromName(event.target.value)}
                    placeholder="Customer Support"
                    autoComplete="off"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-md text-xs leading-5 text-muted-foreground">
                Your current sender, {sharedFromEmail || "support@sona-ai.dk"}, stays active until DNS verification succeeds.
              </p>
              <Button type="submit" disabled={submitting} className="shrink-0 gap-2 transition-transform duration-150 active:scale-[0.97]">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {submitting ? "Generating…" : "Continue to DNS records"}
                {!submitting ? <ArrowRight className="h-4 w-4" /> : null}
              </Button>
            </div>
          </form>
        )}
    </section>
  );
}
