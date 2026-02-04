"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ChevronDown, Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const INBOUND_DOMAIN = "inbound.sona-ai.dk";

export function MailboxesAddMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const forwardingAddress = useMemo(() => {
    if (!result?.inbound_slug) return "";
    return `${result.inbound_slug}@${INBOUND_DOMAIN}`;
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
        throw new Error(payload?.error || "Could not create forwarding address.");
      }
      setResult(payload);
      toast.success("Forwarding address created.");
      router.refresh();
    } catch (error) {
      toast.error(error?.message || "Could not create forwarding address.");
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className="w-full justify-between lg:w-auto">
            Add Mail
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem asChild>
            <Link href="/api/integrations/gmail/auth">Connect Gmail</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/api/integrations/outlook/auth">Connect Outlook</Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setOpen(true)}>
            Other email
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Connect other email (forwarding)</DialogTitle>
            <DialogDescription>
              Use this if your email provider is not Gmail or Outlook.
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
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">
                  Email address
                </label>
                <Input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="support@company.com"
                  type="email"
                  required
                />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Creating..." : "Create forwarding address"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
