"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useClerkSupabase } from "@/lib/useClerkSupabase";

const normalizeDomain = (value) =>
  value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .toLowerCase();

export function ShopifySheet({
  children,
  onConnected,
  initialConnection = null,
}) {
  const supabase = useClerkSupabase();

  const [open, setOpen] = useState(false);
  const [domain, setDomain] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const existingDomain =
    initialConnection?.shop_domain || initialConnection?.store_domain || "";
  const hasExistingConnection = Boolean(existingDomain);

  useEffect(() => {
    if (open) {
      setDomain(existingDomain || "");
      setClientId("");
      setClientSecret("");
      setError("");
    }
  }, [open, existingDomain]);

  const handleSubmit = async (event) => {
    event.preventDefault();

    const cleanDomain = normalizeDomain(domain);
    const cleanClientId = clientId.trim();
    const cleanClientSecret = clientSecret.trim();

    if (!cleanDomain) {
      setError("Enter your Shopify domain.");
      return;
    }

    if (!cleanClientId || !cleanClientSecret) {
      setError("Enter Shopify Client ID and Client Secret.");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const credentialsResponse = await fetch("/api/shopify/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop_domain: cleanDomain,
          client_id: cleanClientId,
          client_secret: cleanClientSecret,
        }),
      });

      const credentialsPayload = await credentialsResponse.json().catch(() => ({}));
      if (!credentialsResponse.ok) {
        throw new Error(credentialsPayload?.error || "Could not save Shopify credentials.");
      }

      const connectResponse = await fetch("/api/shopify/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop_domain: cleanDomain,
        }),
      });

      const connectPayload = await connectResponse.json().catch(() => ({}));
      if (!connectResponse.ok || !connectPayload?.authorizeUrl) {
        throw new Error(connectPayload?.error || "Could not start Shopify OAuth.");
      }

      window.location.assign(connectPayload.authorizeUrl);
    } catch (submitError) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : "Unknown error while connecting Shopify.";
      setError(message);
      setSubmitting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!supabase) {
      setError("Supabase client is not ready yet.");
      return;
    }

    if (!existingDomain) {
      setError("There is no active Shopify connection to remove.");
      return;
    }

    setDisconnecting(true);
    setError("");

    try {
      const { error: deleteError } = await supabase
        .from("shops")
        .delete()
        .eq("platform", "shopify")
        .eq("shop_domain", existingDomain);

      if (deleteError) {
        throw deleteError;
      }

      setDomain("");
      setClientId("");
      setClientSecret("");
      setOpen(false);
      await onConnected?.();
    } catch (disconnectError) {
      const message =
        disconnectError instanceof Error
          ? disconnectError.message
          : "Could not remove the Shopify integration.";
      setError(message);
    } finally {
      setDisconnecting(false);
    }
  };

  const primaryLabel = submitting
    ? hasExistingConnection
      ? "Starting OAuth..."
      : "Starting OAuth..."
    : hasExistingConnection
    ? "Update and reconnect"
    : "Connect Shopify";

  const disconnectLabel = disconnecting
    ? "Disconnecting..."
    : "Disconnect integration";

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent side="right" className="sm:max-w-md overflow-y-auto">
        <SheetHeader className="mb-6">
          <SheetTitle>
            {hasExistingConnection ? "Update Shopify OAuth" : "Connect Shopify OAuth"}
          </SheetTitle>
          <SheetDescription>
            Enter shop domain, app client ID and client secret, then complete OAuth in Shopify.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="shopify-domain">Shopify domain</Label>
            <Input
              id="shopify-domain"
              placeholder="your-store.myshopify.com"
              autoComplete="off"
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="shopify-client-id">Client ID</Label>
            <Input
              id="shopify-client-id"
              placeholder="Shopify app client ID"
              autoComplete="off"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="shopify-client-secret">Client secret</Label>
            <Input
              id="shopify-client-secret"
              type="password"
              placeholder="Shopify app client secret"
              autoComplete="off"
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <SheetFooter className="pt-2 flex-col gap-3 sm:flex-col">
            <Button
              type="submit"
              className="w-full"
              disabled={submitting || disconnecting}
            >
              {primaryLabel}
            </Button>
            {hasExistingConnection && (
              <Button
                type="button"
                variant="outline"
                className="w-full border-red-200 text-red-600 hover:bg-red-50"
                disabled={disconnecting || submitting}
                onClick={handleDisconnect}
              >
                {disconnectLabel}
              </Button>
            )}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
