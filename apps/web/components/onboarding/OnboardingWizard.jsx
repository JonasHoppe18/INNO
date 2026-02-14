"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ExternalLink, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useAgentAutomation } from "@/hooks/useAgentAutomation";
import gmailLogo from "../../../../assets/Gmail-logo.webp";
import outlookLogo from "../../../../assets/Outlook-logo.png";
import shopifyLogo from "../../../../assets/Shopify-Logo.png";

const GUIDE_LINKS = {
  gmail: "/guide/connect-gmail",
  outlook: "/guide/connect-outlook",
  other: "/guide/other-mail",
  shopify: "/guide/connect-shopify",
  ai: "/guide/ai-settings",
  self: "/guide/self-learning",
};

const DEFAULT_AI = {
  autoDraftEnabled: true,
  draftDestination: "sona_inbox",
  historicInboxAccess: false,
  learnFromEdits: false,
  orderUpdates: false,
  cancelOrders: false,
  automaticRefunds: false,
  minConfidence: "0.6",
};

export function OnboardingWizard() {
  const { settings, save } = useAgentAutomation();
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [aiConfig, setAiConfig] = useState(DEFAULT_AI);
  const [stepOverride, setStepOverride] = useState(null);

  const loadState = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/onboarding/state").catch(() => null);
    const payload = res?.ok ? await res.json().catch(() => null) : null;
    if (payload) {
      setState(payload);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!state?.steps) return;
    if (!state.steps.email_connected) {
      setStepOverride(1);
      return;
    }
    if (!state.steps.shopify_connected) {
      setStepOverride(2);
      return;
    }
    if (!state.steps.ai_configured) {
      setStepOverride(3);
      return;
    }
    if (!settings?.autoDraftEnabled) {
      setStepOverride(4);
      return;
    }
    if (!state.steps.first_draft_created) {
      setStepOverride(5);
      return;
    }
    setStepOverride(null);
  }, [state, settings?.autoDraftEnabled]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  useEffect(() => {
    if (!settings) return;
    setAiConfig((prev) => ({
      ...prev,
      autoDraftEnabled: settings.autoDraftEnabled ?? prev.autoDraftEnabled,
      draftDestination: settings.draftDestination ?? prev.draftDestination,
      historicInboxAccess: settings.historicInboxAccess ?? prev.historicInboxAccess,
      learnFromEdits: settings.learnFromEdits ?? prev.learnFromEdits,
      orderUpdates: settings.orderUpdates ?? prev.orderUpdates,
      cancelOrders: settings.cancelOrders ?? prev.cancelOrders,
      automaticRefunds: settings.automaticRefunds ?? prev.automaticRefunds,
    }));
  }, [settings]);

  const steps = useMemo(() => state?.steps || {}, [state?.steps]);
  const activeStep = useMemo(() => {
    if (stepOverride) return stepOverride;
    if (!steps.email_connected) return 1;
    if (!steps.shopify_connected) return 2;
    if (!steps.ai_configured) return 3;
    if (!settings?.autoDraftEnabled) return 4;
    if (!steps.first_draft_created) return 5;
    return 5;
  }, [steps, stepOverride, settings?.autoDraftEnabled]);

  useEffect(() => {
    if (activeStep !== 5 || steps.first_draft_created) return;
    const timer = setInterval(() => {
      loadState();
    }, 8000);
    return () => clearInterval(timer);
  }, [activeStep, steps.first_draft_created, loadState]);

  const markStep = async (step) => {
    await fetch("/api/onboarding/mark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step }),
    });
    await loadState();
  };

  const handleSaveAi = async () => {
    await save({
      autoDraftEnabled: aiConfig.autoDraftEnabled,
      draftDestination: aiConfig.draftDestination,
      historicInboxAccess: aiConfig.historicInboxAccess,
      learnFromEdits: aiConfig.learnFromEdits,
      orderUpdates: aiConfig.orderUpdates,
      cancelOrders: aiConfig.cancelOrders,
      automaticRefunds: aiConfig.automaticRefunds,
      minConfidence: Number(aiConfig.minConfidence || 0.6),
    });
    await markStep("ai_configured");
  };


  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Onboarding</h1>
          <p className="text-sm text-muted-foreground">
            Nothing is sent automatically. You control what Sona can do.
          </p>
        </div>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((step) => (
            <button
              key={step}
              type="button"
              className={`h-2.5 w-10 rounded-full ${
                activeStep >= step ? "bg-indigo-500" : "bg-slate-200"
              }`}
              onClick={() => setStepOverride(step)}
              aria-label={`Go to step ${step}`}
            />
          ))}
        </div>
      </div>

      {activeStep === 1 && (
        <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <CardContent className="space-y-4 p-6">
            <div>
              <p className="text-base font-semibold text-slate-900">Step 1: Connect email</p>
              <p className="text-sm text-slate-600">
                Connect Gmail or Outlook, or use forwarding for other providers.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-100 bg-slate-50">
                    <Image
                      src={gmailLogo}
                      alt="Gmail"
                      width={32}
                      height={32}
                      className="h-6 w-6 object-contain"
                    />
                  </div>
                  <p className="font-medium">Gmail</p>
                </div>
                <p className="text-xs text-slate-500">OAuth connection</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button asChild size="sm">
                    <Link href="/api/integrations/gmail/auth">Connect Gmail</Link>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link href={GUIDE_LINKS.gmail} target="_blank" rel="noreferrer">
                      <span className="inline-flex items-center gap-1.5">
                        View guide
                        <ExternalLink className="h-3 w-3 text-slate-400" />
                      </span>
                    </Link>
                  </Button>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-100 bg-slate-50">
                    <Image
                      src={outlookLogo}
                      alt="Outlook"
                      width={32}
                      height={32}
                      className="h-6 w-6 object-contain"
                    />
                  </div>
                  <p className="font-medium">Outlook</p>
                </div>
                <p className="text-xs text-slate-500">OAuth connection</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button asChild size="sm">
                    <Link href="/api/integrations/outlook/auth">Connect Outlook</Link>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link href={GUIDE_LINKS.outlook} target="_blank" rel="noreferrer">
                      <span className="inline-flex items-center gap-1.5">
                        View guide
                        <ExternalLink className="h-3 w-3 text-slate-400" />
                      </span>
                    </Link>
                  </Button>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-100 bg-slate-50 text-slate-600">
                    <Mail className="h-5 w-5" />
                  </div>
                  <p className="font-medium">Other mail</p>
                </div>
                <p className="text-xs text-slate-500">Forwarding + custom domain</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link href="/mailboxes/other">Other mail</Link>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link href={GUIDE_LINKS.other} target="_blank" rel="noreferrer">
                      <span className="inline-flex items-center gap-1.5">
                        View guide
                        <ExternalLink className="h-3 w-3 text-slate-400" />
                      </span>
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                onClick={loadState}
                disabled={loading}
                variant="outline"
              >
                {steps.email_connected ? "Connected ✓" : "Check status"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {activeStep === 2 && (
        <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <CardContent className="space-y-4 p-6">
            <div>
              <p className="text-base font-semibold text-slate-900">Step 2: Connect Shopify</p>
              <p className="text-sm text-slate-600">
                Sync orders and customers so the agent can reference them.
              </p>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-slate-100 bg-slate-50">
                <Image
                  src={shopifyLogo}
                  alt="Shopify"
                  width={36}
                  height={36}
                  className="h-7 w-7 object-contain"
                />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">Shopify</p>
                <p className="text-xs text-slate-500">Orders, customers, and policies</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href="/integrations">Connect Shopify</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={GUIDE_LINKS.shopify} target="_blank" rel="noreferrer">
                  <span className="inline-flex items-center gap-1.5">
                    View guide
                    <ExternalLink className="h-3 w-3 text-slate-400" />
                  </span>
                </Link>
              </Button>
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                onClick={loadState}
                disabled={loading}
                variant="outline"
              >
                {steps.shopify_connected ? "Connected ✓" : "Check status"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {activeStep === 3 && (
        <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <CardContent className="space-y-5 p-6">
            <div>
              <p className="text-base font-semibold text-slate-900">Step 3: Configure AI</p>
              <p className="text-sm text-slate-600">
                You control what Sona can do. You can change this anytime in Automation.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm">
                Historic inbox access
                <Switch
                  checked={aiConfig.historicInboxAccess}
                  onCheckedChange={(value) =>
                    setAiConfig((prev) => ({ ...prev, historicInboxAccess: Boolean(value) }))
                  }
                />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm">
                Draft destination
                <select
                  value={aiConfig.draftDestination}
                  onChange={(event) =>
                    setAiConfig((prev) => ({ ...prev, draftDestination: event.target.value }))
                  }
                  className="rounded-md border border-slate-200 px-2 py-1 text-sm"
                >
                  <option value="sona_inbox">Sona inbox</option>
                  <option value="provider_inbox">Gmail/Outlook</option>
                </select>
              </label>
              <label className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm">
                Allow order updates
                <Switch
                  checked={aiConfig.orderUpdates}
                  onCheckedChange={(value) =>
                    setAiConfig((prev) => ({ ...prev, orderUpdates: Boolean(value) }))
                  }
                />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm">
                Allow cancellations
                <Switch
                  checked={aiConfig.cancelOrders}
                  onCheckedChange={(value) =>
                    setAiConfig((prev) => ({ ...prev, cancelOrders: Boolean(value) }))
                  }
                />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm">
                Automatic refunds
                <Switch
                  checked={aiConfig.automaticRefunds}
                  onCheckedChange={(value) =>
                    setAiConfig((prev) => ({ ...prev, automaticRefunds: Boolean(value) }))
                  }
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button type="button" onClick={handleSaveAi}>
                Save & Continue
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {activeStep === 4 && (
        <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <CardContent className="space-y-4 p-6">
            <div>
              <p className="text-base font-semibold text-slate-900">Step 4: Activate agent</p>
              <p className="text-sm text-slate-600">
                Activating the agent turns on automatic drafts in your inbox.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button
                type="button"
                onClick={async () => {
                  await save({ autoDraftEnabled: true });
                  setAiConfig((prev) => ({ ...prev, autoDraftEnabled: true }));
                  await loadState();
                }}
                disabled={aiConfig.autoDraftEnabled}
              >
                {aiConfig.autoDraftEnabled ? "Agent active" : "Activate agent"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={loadState}
                disabled={loading}
              >
                Refresh
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {activeStep === 5 && (
        <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <CardContent className="space-y-4 p-6">
            <div>
              <p className="text-base font-semibold text-slate-900">Step 5: First draft</p>
              <p className="text-sm text-slate-600">
                Waiting for the first AI draft to be created.
              </p>
            </div>
            {steps.first_draft_created ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
                First draft created. You&apos;re all set.
              </div>
            ) : (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                Waiting for first draft… We will refresh automatically.
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href="/inbox">Go to Inbox</Link>
              </Button>
              <Button type="button" variant="outline" onClick={loadState} disabled={loading}>
                Refresh
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
