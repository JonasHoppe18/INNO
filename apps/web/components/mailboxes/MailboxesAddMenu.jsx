"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAgentAutomation } from "@/hooks/useAgentAutomation";
import { buildInboundAddress } from "@/lib/inbound-domain";

export function MailboxesAddMenu({ buttonClassName = "", buttonLabel = "Connect mail", onCreated }) {
  const router = useRouter();
  const { settings: automationSettings, loading: automationLoading, refresh, save } =
    useAgentAutomation();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const forwardingAddress = useMemo(() => {
    return buildInboundAddress(result?.inbound_slug);
  }, [result?.inbound_slug]);

  const resetForm = () => {
    setEmail("");
    setResult(null);
    setSubmitting(false);
    setCopied(false);
  };

  const handleClose = (nextOpen) => {
    setOpen(nextOpen);
    if (!nextOpen) resetForm();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!email.trim()) {
      toast.error("Email address is required.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/mail-accounts/forwarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider_email: email.trim() }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "Could not connect the email channel.");
      }
      setResult(payload);
      await fetch("/api/onboarding/mark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "email_connected" }),
      }).catch(() => null);
      if (automationLoading) {
        await refresh().catch(() => null);
      }
      if (automationSettings?.draftDestination !== "sona_inbox") {
        await save({ draftDestination: "sona_inbox" });
      }
      toast.success("Email channel created.");
      router.refresh();
      onCreated?.();
    } catch (error) {
      toast.error(error?.message || "Could not connect the email channel.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async () => {
    if (!forwardingAddress) return;
    try {
      await navigator.clipboard.writeText(forwardingAddress);
      toast.success("Copied to clipboard.");
      setCopied(true);
    } catch {
      toast.error("Could not copy.");
    }
  };

  return (
    <>
      <Button
        className={cn("w-full lg:w-auto", buttonClassName)}
        onClick={() => setOpen(true)}
      >
        {buttonLabel}
      </Button>

      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Connect email channel</DialogTitle>
            <DialogDescription>
              Forward your existing support inbox from Gmail, Outlook or another provider into Sona.
            </DialogDescription>
          </DialogHeader>

          {result ? (
            <div className="space-y-4">
              <div className="rounded-lg border bg-slate-50 px-4 py-3">
                <p className="text-xs uppercase text-slate-400">
                  Forwarding address
                </p>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <code className="text-sm font-semibold text-slate-900">
                    {forwardingAddress}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleCopy}
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    {copied ? "Copied!" : "Copy"}
                  </Button>
                </div>
              </div>
              <p className="text-sm text-slate-600">
                Forward emails sent to your support address to this email to
                receive them in Sona.
              </p>
              <div className="space-y-2 text-sm text-slate-500">
                <p className="font-medium text-slate-700">Quick setup tips</p>
                <ul className="list-disc space-y-1 pl-4">
                  <li>one.com: Add a forwarder under Email settings.</li>
                  <li>Simply: Enable forwarding in your mailbox controls.</li>
                  <li>Other providers: Look for “forwarding” in settings.</li>
                </ul>
              </div>
              <DialogFooter>
                <Button type="button" onClick={() => handleClose(false)}>
                  I&apos;ve set up forwarding
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="mailbox-support-email">
                    Support email address
                  </FieldLabel>
                  <Input
                    id="mailbox-support-email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="support@company.com"
                    type="email"
                    required
                  />
                  <FieldDescription>
                    Shopify is optional. If this workspace has one shop, Sona links it automatically.
                  </FieldDescription>
                </Field>
              </FieldGroup>
              <DialogFooter>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Connecting..." : "Connect email"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
