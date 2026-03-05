"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, ChevronDown, Eye, EyeOff } from "lucide-react";

function StepDots({ current }) {
  return (
    <div className="mb-6 flex items-center justify-center gap-2">
      {[1, 2, 3].map((step) => (
        <span
          key={step}
          className={`h-2 rounded-full ${
            current === step ? "w-8 bg-indigo-600" : "w-2 bg-slate-200"
          }`}
        />
      ))}
    </div>
  );
}

export default function OnboardingShopifyPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [domain, setDomain] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [showHelper, setShowHelper] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const connectionStatus = connected ? "success" : "idle";

  const normalizeDomain = (value) =>
    String(value || "")
      .trim()
      .replace(/^https?:\/\//i, "")
      .replace(/\/+$/, "")
      .toLowerCase();

  const loadState = async () => {
    setLoading(true);
    const response = await fetch("/api/onboarding/state", { cache: "no-store" }).catch(
      () => null
    );
    const payload = response?.ok ? await response.json().catch(() => null) : null;
    const isConnected = Boolean(payload?.steps?.shopify_connected);
    const domainFromState = String(payload?.shop_domain || "").trim();
    if (domainFromState) {
      setDomain(domainFromState);
    }
    setConnected(isConnected);
    setLoading(false);
    return isConnected;
  };

  useEffect(() => {
    loadState().catch(() => setLoading(false));
  }, []);

  const handleConnectStore = async () => {
    setError("");
    const cleanDomain = normalizeDomain(domain);
    const cleanApiKey = apiKey.trim();
    const cleanAccessToken = accessToken.trim();

    if (!cleanDomain) {
      setError("Please enter your shop domain.");
      return;
    }
    if (!cleanAccessToken || !cleanApiKey) {
      setError("Please enter both Admin API Access Token and API Key.");
      return;
    }

    setSubmitting(true);

    try {
      const credentialsResponse = await fetch("/api/shopify/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop_domain: cleanDomain,
          client_secret: cleanAccessToken,
          client_id: cleanApiKey,
        }),
      });
      const credentialsPayload = await credentialsResponse.json().catch(() => ({}));
      if (!credentialsResponse.ok) {
        throw new Error(credentialsPayload?.error || "Could not save Shopify credentials.");
      }

      const connectResponse = await fetch("/api/shopify/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop_domain: cleanDomain }),
      });
      const connectPayload = await connectResponse.json().catch(() => ({}));
      if (!connectResponse.ok || !connectPayload?.authorizeUrl) {
        throw new Error(connectPayload?.error || "Could not start Shopify OAuth.");
      }

      window.location.assign(connectPayload.authorizeUrl);
      return;
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "Could not connect store.");
      setSubmitting(false);
      return;
    }
  };

  const handleContinue = async () => {
    setError("");
    const isConnected = await loadState();
    if (!isConnected) {
      setError("Connect Shopify first, then click Continue.");
      return;
    }
    router.push("/onboarding/email");
  };

  return (
    <div className="sona-onboarding-shell mx-auto w-full max-w-md">
      <StepDots current={2} />

      <div className="mt-6 space-y-2 text-center">
        <h1 className="text-2xl font-bold text-slate-900">Connect Shopify</h1>
        <p className="mb-8 text-slate-500">
          Connect your Shopify store so Sona can understand orders and policies.
        </p>
      </div>

      {connectionStatus === "success" ? (
        <div className="rounded-xl bg-white p-6 text-center">
          <h2 className="text-lg font-semibold text-gray-900">
            {domain?.trim() || "your-shop.myshopify.com"}
          </h2>
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
            <Check className="h-3 w-3" />
            Connected &amp; Syncing
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <Label htmlFor="shop-domain" className="text-sm font-medium text-slate-700">
              Shop Domain
            </Label>
            <Input
              id="shop-domain"
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              placeholder="your-shop.myshopify.com"
              className="h-11 rounded-xl border-slate-300"
            />
            <p className="text-xs text-slate-500">
              The URL you use to log in to Shopify Admin.
            </p>
          </div>

          <div className="mt-4 rounded-xl bg-slate-50 p-5">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="shop-token" className="text-sm font-medium text-slate-700">
                  Admin API Access Token
                </Label>
                <div className="relative">
                  <Input
                    id="shop-token"
                    type={showToken ? "text" : "password"}
                    value={accessToken}
                    onChange={(event) => setAccessToken(event.target.value)}
                    placeholder="shpat_..."
                    className="h-11 rounded-xl border-slate-300 pr-11"
                  />
                  <button
                    type="button"
                    aria-label={showToken ? "Hide token" : "Show token"}
                    onClick={() => setShowToken((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700"
                  >
                    {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="shop-api-key" className="text-sm font-medium text-slate-700">
                  API Key
                </Label>
                <Input
                  id="shop-api-key"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="API key / client ID"
                  className="h-11 rounded-xl border-slate-300"
                />
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowHelper((prev) => !prev)}
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
          >
            Where do I find my API keys?
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${showHelper ? "rotate-180" : ""}`}
            />
          </button>
          {showHelper ? (
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-slate-600">
              <li>Go to Shopify Admin -&gt; Settings -&gt; Apps.</li>
              <li>Click Develop apps -&gt; Create an app.</li>
              <li>Enable read_products and read_orders scopes.</li>
              <li>Copy the Admin API access token.</li>
            </ol>
          ) : null}
          <p className="mt-2 text-xs text-slate-500">
            Need screenshots?{" "}
            <Link
              href="/guide/connect-shopify"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
            >
              Open the Shopify setup guide
            </Link>
            .
          </p>
        </>
      )}

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {connectionStatus !== "success" ? (
          <div className="space-y-2">
            <Button
              type="button"
              className="h-12 w-full rounded-xl bg-indigo-700 font-semibold text-white shadow-lg shadow-indigo-700/30 transition-all hover:bg-indigo-800 active:scale-95"
              onClick={handleConnectStore}
              disabled={submitting}
            >
              {submitting ? "Connecting..." : "Connect Store"}
            </Button>
          </div>
        ) : null}
        <Button
          type="button"
          variant={connectionStatus === "success" ? "default" : "outline"}
          className={`h-12 rounded-xl ${
            connectionStatus === "success"
              ? "bg-indigo-600 text-white hover:bg-indigo-700 sm:col-span-2"
              : "border-slate-300"
          }`}
          disabled={loading}
          onClick={handleContinue}
        >
          Continue
        </Button>
      </div>
      {connectionStatus !== "success" ? (
        <button
          type="button"
          className="mt-4 w-full text-center text-sm text-slate-500 underline-offset-4 transition-colors hover:text-slate-800 hover:underline"
          onClick={() => router.push("/onboarding/email")}
        >
          Skip for now
        </button>
      ) : null}

      <style jsx>{`
        .sona-onboarding-shell {
          animation: fade-in-up 420ms ease-out;
        }
        @keyframes fade-in-up {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
