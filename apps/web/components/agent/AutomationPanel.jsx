"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Archive, DollarSign, Inbox, Mail, Package, SlidersHorizontal, XCircle } from "lucide-react";
import { useAgentAutomation } from "@/hooks/useAgentAutomation";
import { toast } from "sonner";

// Definition af de tilstande vi lader brugeren styre fra automation-panelet.
const toggles = [
  {
    key: "orderUpdates",
    icon: Package,
    label: "Order updates",
    description: "Allow the agent to look up tracking and share status updates with customers.",
  },
  {
    key: "cancelOrders",
    icon: XCircle,
    label: "Allow cancellations",
    description: "Allow the agent to cancel orders if they have not shipped yet.",
  },
  {
    key: "automaticRefunds",
    icon: DollarSign,
    label: "Automatic refunds",
    description: "Allow the agent to process small refunds automatically.",
  },
  {
    key: "historicInboxAccess",
    icon: Archive,
    label: "Historical inbox",
    description: "Allow access to old emails so the agent can reference past conversations.",
  },
];

const draftDestinations = [
  {
    id: "sona_inbox",
    label: "Drafts stay in Sona AI dashboard - Answer directly in your inbox",
    icon: Inbox,
  },
  {
    id: "email_provider",
    label: "Drafts appear directly in Gmail or Outlook",
    icon: Mail,
  },
];

const AutomationPanelContext = createContext(null);

export function useAutomationPanelActions() {
  const ctx = useContext(AutomationPanelContext);
  if (!ctx) {
    throw new Error("useAutomationPanelActions must be used within AutomationPanel");
  }
  return ctx;
}

export function AutomationPanel({ children = null }) {
  const { settings, loading, saving, error, save } = useAgentAutomation();
  // Lokalt spejl af Supabase settings så vi kan optimistisk toggle switches.
  const [local, setLocal] = useState(settings || {});
  // Skjult input i UI (ikke gemt endnu), placeholder for fremtidig funktionalitet.
  const [refundMax, setRefundMax] = useState("500");

  useEffect(() => {
    setLocal(settings || {});
  }, [settings]);

  const draftDestination = local?.draftDestination || settings?.draftDestination || "email_provider";

  // Hver switch får sin egen change handler der opdaterer lokale state felter.
  const handleToggle = useCallback(
    (key) => (next) => {
      setLocal((s) => ({ ...(s || {}), [key]: Boolean(next) }));
    },
    []
  );

  const handleSave = useCallback(async () => {
    try {
      // Sender kun de kendte boolean felter til hooken for at undgå utilsigtede updates.
      await save({
        orderUpdates: Boolean(local?.orderUpdates),
        cancelOrders: Boolean(local?.cancelOrders),
        automaticRefunds: Boolean(local?.automaticRefunds),
        historicInboxAccess: Boolean(local?.historicInboxAccess),
      });
    } catch (_) {
      // swallow here; the hook surfaces `error` already
    }
  }, [local, save]);

  // dirty bruges både af header knappen og lokale CTA'er.
  const dirty = useMemo(() => {
    const baseDirty = toggles.some(
      ({ key }) => Boolean(local?.[key]) !== Boolean(settings?.[key])
    );
    const draftDirty = Boolean(local?.autoDraftEnabled) !== Boolean(settings?.autoDraftEnabled);
    const destinationDirty = local?.draftDestination !== settings?.draftDestination;
    return baseDirty || draftDirty || destinationDirty;
  }, [local, settings]);

  // Samlet API der deles via context så headeren kan gengemme ændringer.
  const contextValue = useMemo(
    () => ({
      save: handleSave,
      saving,
      loading,
      dirty,
    }),
    [handleSave, saving, loading, dirty]
  );

  const handleToggleAutoDraft = useCallback(async () => {
    const next = !Boolean(local?.autoDraftEnabled);
    setLocal((s) => ({ ...(s || {}), autoDraftEnabled: next }));
    try {
      await save({ autoDraftEnabled: next });
    } catch (_) {
      // error already handled by hook
    }
  }, [local?.autoDraftEnabled, save]);

  const handleDestinationPick = useCallback(
    async (next) => {
      if (!next || next === draftDestination) return;
      setLocal((s) => ({ ...(s || {}), draftDestination: next }));
      const toastId = toast.loading("Updating draft destination...");
      try {
        await save({ draftDestination: next });
        toast.success("Draft destination updated.", { id: toastId });
      } catch (err) {
        toast.error("Could not update draft destination.", { id: toastId });
        setLocal((s) => ({ ...(s || {}), draftDestination }));
      }
    },
    [draftDestination, save]
  );

  const handleResetLearning = useCallback(async () => {
    const toastId = toast.loading("Resetting learning...");
    try {
      const res = await fetch("/api/learning/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "all" }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "Could not reset learning.");
      }
      toast.success("Learning reset.", { id: toastId });
    } catch (err) {
      toast.error(err?.message || "Could not reset learning.", { id: toastId });
    }
  }, []);

  const selectedDestination = useMemo(
    () => draftDestinations.find((destination) => destination.id === draftDestination),
    [draftDestination]
  );

  return (
    <AutomationPanelContext.Provider value={contextValue}>
      {children}

      <Card className="mb-4 rounded-2xl border border-indigo-200/60 bg-white shadow-sm">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div>
            <p className="text-sm font-semibold text-slate-900">Auto-draft agent</p>
            <p className="text-sm text-slate-600">
              Toggle AI drafts on/off. When enabled, the agent automatically creates drafts in your inbox.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
                local?.autoDraftEnabled
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              {local?.autoDraftEnabled ? "Active" : "Inactive"}
            </span>
            <Button
              type="button"
              size="sm"
              onClick={handleToggleAutoDraft}
              disabled={loading || saving}
              variant={local?.autoDraftEnabled ? "outline" : "default"}
              className={
                local?.autoDraftEnabled
                  ? "border-slate-200 text-slate-700 hover:bg-slate-50"
                  : "bg-slate-900 text-white shadow-lg shadow-slate-900/20 hover:bg-slate-800"
              }
            >
              {local?.autoDraftEnabled ? "Disable" : "Enable"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4 rounded-2xl border border-indigo-200/60 bg-white shadow-sm">
        <CardContent className="px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-slate-100 p-2 text-slate-700">
              <SlidersHorizontal className="h-4 w-4" />
            </div>
            <div>
              <p className="text-base font-semibold text-slate-900">Draft Destination</p>
              <p className="text-sm text-slate-600">
                Choose where you want AI drafts to appear.
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {draftDestinations.map((destination) => {
              const Icon = destination.icon;
              const isActive = destination.id === draftDestination;
              return (
                <button
                  key={destination.id}
                  type="button"
                  onClick={() => handleDestinationPick(destination.id)}
                  className={`group flex w-full items-center gap-4 rounded-2xl border p-5 text-left transition ${
                    isActive
                      ? "border-slate-900 bg-slate-50 ring-2 ring-slate-900"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div
                    className={`flex h-12 w-12 items-center justify-center rounded-2xl ${
                      isActive
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-900">{destination.label}</p>
                  </div>
                  <div
                    className={`flex h-6 w-6 items-center justify-center rounded-full border ${
                      isActive
                        ? "border-slate-900 text-slate-900"
                        : "border-slate-300 text-slate-400"
                    }`}
                    aria-hidden="true"
                  >
                    {isActive && <span className="h-2.5 w-2.5 rounded-full bg-slate-900" />}
                  </div>
                </button>
              );
            })}
          </div>

          {selectedDestination && (
            <div className="mt-3 text-xs text-slate-600">
              Selected: {selectedDestination.label}
            </div>
          )}

        </CardContent>
      </Card>

      <Card className="rounded-xl border border-border bg-white shadow-sm">
        <CardContent className="p-0">
          <div className="divide-y divide-border/70">
            {toggles.map((t) => {
              const Icon = t.icon;
              const isOn = Boolean(local?.[t.key]);
              return (
                <div key={t.key} className="px-5 py-5 transition hover:bg-muted/40">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 rounded-full bg-slate-100 p-2 text-slate-700">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="font-medium text-foreground">{t.label}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{t.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center">
                      <Switch
                        checked={isOn}
                        onCheckedChange={handleToggle(t.key)}
                        disabled={loading || saving}
                      />
                    </div>
                  </div>

                  {t.key === "automaticRefunds" && (
                    <div
                      className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
                        isOn
                          ? "mt-4 grid-rows-[1fr] opacity-100"
                          : "grid-rows-[0fr] opacity-0"
                      }`}
                      aria-hidden={!isOn}
                    >
                      <div className="overflow-hidden">
                        <div className="rounded-lg border border-border/80 bg-white px-4 py-3 text-sm shadow-inner">
                          <label
                            htmlFor="automation-refund-max"
                            className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                          >
                            Maximum amount (DKK)
                          </label>
                          <input
                            id="automation-refund-max"
                            type="number"
                            inputMode="numeric"
                            placeholder="500"
                            value={refundMax}
                            onChange={(event) => setRefundMax(event.target.value)}
                            className="mt-2 w-32 rounded-md border border-input px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {error && (
            <div className="px-5 py-4">
              <p className="text-sm text-destructive">
                {error.message ?? "Could not save automation settings."}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4 rounded-xl border border-border bg-white shadow-sm">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-foreground">Learning profile</p>
            <p className="text-sm text-muted-foreground">
              Clear saved writing preferences and rebuild from future edits.
            </p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={handleResetLearning}>
            Reset learning
          </Button>
        </CardContent>
      </Card>
    </AutomationPanelContext.Provider>
  );
}
