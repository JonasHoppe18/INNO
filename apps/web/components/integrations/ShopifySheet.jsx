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
import { useAuth } from "@clerk/nextjs";
import { useClerkSupabase } from "@/lib/useClerkSupabase";

// Normaliserer brugerinput så vi gemmer et rent domæne.
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
  const { getToken } = useAuth();
  const supabase = useClerkSupabase();

  // Lokale form- og UI-states
  const [open, setOpen] = useState(false);
  const [domain, setDomain] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  // Vi kan kun disconnecte hvis der findes en shop_domain i Supabase.
  const existingDomain =
    initialConnection?.shop_domain || initialConnection?.store_domain || "";
  const hasExistingConnection = Boolean(existingDomain);

  // Synker feltværdier når sheetet åbnes og rydder fejl når man lukker det igen.
  useEffect(() => {
    if (open) {
      setDomain(existingDomain || "");
      setApiKey("");
      setError("");
    }
  }, [open, existingDomain]);

  // Forbinder eller opdaterer Shopify integrationen via Supabase functionen.
  const handleSubmit = async (event) => {
    event.preventDefault();
    const cleanDomain = normalizeDomain(domain);
    const tokenValue = apiKey.trim();

    if (!cleanDomain) {
      setError("Enter your Shopify domain.");
      return;
    }

    if (!tokenValue) {
      setError("Enter your Admin API access token.");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const clerkToken = await getToken();
      if (!clerkToken) {
        throw new Error("Could not fetch Clerk session token.");
      }

      // Brug server-side proxy for at undgå CORS på functions
      const response = await fetch("/api/shopify/connect", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${clerkToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          domain: cleanDomain,
          accessToken: tokenValue,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          typeof payload?.error === "string"
            ? payload.error
            : "Could not connect Shopify.";
        throw new Error(message);
      }

      setOpen(false);
      setApiKey("");
      setDomain(cleanDomain);
      await fetch("/api/onboarding/mark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "shopify_connected" }),
      }).catch(() => null);
      await onConnected?.();
    } catch (submitError) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : "Unknown error while connecting to Shopify.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  // Frakobler Shopify ved at slette butikken fra shops tabellen.
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
        .eq("shop_domain", existingDomain);

      if (deleteError) {
        throw deleteError;
      }

      setDomain("");
      setApiKey("");
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

  // Primær CTA skifter text afhængigt af state og om der findes data i forvejen.
  const primaryLabel = submitting
    ? hasExistingConnection
      ? "Updating..."
      : "Connecting..."
    : "Update";

  // Separat label til disconnect knappen for tydelig statusfeedback.
  const disconnectLabel = disconnecting
    ? "Disconnecting..."
    : "Disconnect integration";

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent side="right" className="sm:max-w-md overflow-y-auto">
        <SheetHeader className="mb-6">
          <SheetTitle>
            {hasExistingConnection ? "Update Shopify" : "Connect Shopify"}
          </SheetTitle>
          <SheetDescription>
            Enter your store domain and Admin API access token to connect Shopify.
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
            <Label htmlFor="shopify-api">Admin API access token</Label>
            <Input
              id="shopify-api"
              type="password"
              placeholder="shpat_..."
              autoComplete="off"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
            <p className="text-[10px] text-muted-foreground">
              Find it under Apps &gt; Develop apps &gt; API credentials.
            </p>
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
