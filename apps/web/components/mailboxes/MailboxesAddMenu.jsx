"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { useClerkSupabase } from "@/lib/useClerkSupabase";

const INBOUND_DOMAIN = "inbound.sona-ai.dk";

export function MailboxesAddMenu({ buttonClassName = "" }) {
  const router = useRouter();
  const { supabase } = useClerkSupabase();
  const { settings: automationSettings, loading: automationLoading, refresh, save } =
    useAgentAutomation();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [shops, setShops] = useState([]);
  const [shopId, setShopId] = useState(null);
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

  const loadShops = useCallback(async () => {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from("shops")
      .select("id, shop_domain, created_at")
      .is("uninstalled_at", null)
      .order("created_at", { ascending: false });
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    setShops(rows);
    setShopId((current) => {
      if (current && rows.some((shop) => shop.id === current)) return current;
      if (rows.length === 1) return rows[0].id;
      return null;
    });
    return rows;
  }, [supabase]);

  useEffect(() => {
    if (!open) return;
    loadShops().catch((error) => {
      console.warn("MailboxesAddMenu load shops failed", error);
      toast.error("Could not load shops.");
    });
  }, [loadShops, open]);

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
    if (!shopId) {
      toast.error("Select the shop this mailbox should belong to.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/mail-accounts/forwarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider_email: email.trim(), shop_id: shopId }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "Could not create forwarding address.");
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
      <Button
        className={cn("w-full lg:w-auto", buttonClassName)}
        onClick={() => setOpen(true)}
      >
        Connect mail
      </Button>

      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Connect email (forwarding)</DialogTitle>
            <DialogDescription>
              Use the same forwarding setup for Gmail, Outlook, one.com, Simply, and other providers.
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
                <Label htmlFor="mailbox-shop-selector">Shop</Label>
                <Select value={shopId || ""} onValueChange={(value) => setShopId(value || null)}>
                  <SelectTrigger id="mailbox-shop-selector">
                    <SelectValue placeholder={shops.length > 1 ? "Select shop" : "No shop connected"} />
                  </SelectTrigger>
                  <SelectContent>
                    {shops.map((shop) => (
                      <SelectItem key={shop.id} value={shop.id}>
                        {String(shop.shop_domain || "Unnamed shop")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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
                <Button type="submit" disabled={submitting || !shopId}>
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
