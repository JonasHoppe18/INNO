"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { StickySaveBar } from "@/components/ui/sticky-save-bar";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAgentAutomation } from "@/hooks/useAgentAutomation";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// Definition af de tilstande vi lader brugeren styre fra automation-panelet.
const toggles = [
  {
    key: "orderUpdates",
    label: "Order updates",
    description:
      "Allow Sona to automatically update customer orders. When disabled, Sona will suggest the change for review instead.",
  },
  {
    key: "cancelOrders",
    label: "Allow cancellations",
    description:
      "Allow Sona to automatically cancel unshipped orders. When disabled, cancellations require approval.",
    status: "comingSoon",
  },
  {
    key: "historicInboxAccess",
    label: "Historical inbox",
    description: "Allow Sona to use previous conversations as context when drafting replies.",
    status: "comingSoon",
  },
  {
    key: "automaticRefunds",
    label: "Automatic refunds",
    description:
      "Allow Sona to automatically process eligible refunds. When disabled, refunds require approval.",
    status: "comingSoon",
  },
];

const DEFAULT_RETURN_SETTINGS = {
  return_window_days: 30,
  return_shipping_mode: "customer_paid",
  return_address: "",
};

const returnSettingsSnapshot = (value = DEFAULT_RETURN_SETTINGS) =>
  JSON.stringify({
    return_window_days: Math.max(1, Number(value?.return_window_days || 30)),
    return_shipping_mode: String(value?.return_shipping_mode || "customer_paid"),
    return_address: String(value?.return_address || "").trim(),
  });

const formatReturnAddress = (value = "") => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\n{2,}/g, "\n").trim();
  // If user already uses multiple lines, keep those lines and just trim each line.
  if (normalized.includes("\n")) {
    return normalized
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");
  }
  // Convert comma-separated address into line-based format.
  const parts = normalized
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 1) return normalized;
  return parts.join("\n");
};

const AutomationPanelContext = createContext(null);

function SettingsSection({
  title,
  description,
  action,
  children,
  className,
  note,
  titleBadge,
  featured = false,
}) {
  return (
    <Card
      className={cn(
        "rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
        featured && "border-indigo-100 bg-gradient-to-b from-indigo-50/35 to-white",
        className,
      )}
    >
      <CardContent className="p-6 md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4 md:gap-6">
          <div className="max-w-3xl space-y-1.5">
            <div className="flex items-center gap-2.5">
              <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
              {titleBadge}
            </div>
            <p className="text-sm leading-relaxed text-slate-600">{description}</p>
            {note ? (
              <p className="text-xs text-slate-500">{note}</p>
            ) : null}
          </div>
          {action ? <div className="flex items-center gap-2 self-start">{action}</div> : null}
        </div>
        {children ? (
          <>
            <Separator className="my-6 bg-slate-200" />
            {children}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  badge,
  helper,
}) {
  return (
    <div className="px-4 py-4 md:px-5">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-slate-900">{label}</p>
            {badge}
          </div>
          <p className="text-sm text-slate-600">{description}</p>
          {helper ? <p className="text-xs text-slate-500">{helper}</p> : null}
        </div>
        <div className="flex justify-start sm:justify-end sm:pl-4">
          <Switch
            checked={checked}
            onCheckedChange={onCheckedChange}
            disabled={disabled}
            aria-label={label}
          />
        </div>
      </div>
    </div>
  );
}

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
  const [returnSettings, setReturnSettings] = useState(DEFAULT_RETURN_SETTINGS);
  const [initialReturnSettings, setInitialReturnSettings] = useState(DEFAULT_RETURN_SETTINGS);
  const [returnsLoading, setReturnsLoading] = useState(true);
  const [returnsSeededNotice, setReturnsSeededNotice] = useState(false);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [pendingHref, setPendingHref] = useState(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const dirtyRef = useRef(false);
  const returnAddressTextareaRef = useRef(null);

  useEffect(() => {
    setLocal(settings || {});
  }, [settings]);

  useEffect(() => {
    let active = true;
    const loadReturns = async () => {
      setReturnsLoading(true);
      try {
        const response = await fetch("/api/settings/returns", {
          method: "GET",
          cache: "no-store",
          credentials: "include",
        });
        const payload = await response.json().catch(() => ({}));
        if (!active || !response.ok) return;
        const settingsRow = payload?.settings || {};
        const next = {
          return_window_days: Number(settingsRow?.return_window_days || 30),
          return_shipping_mode: String(settingsRow?.return_shipping_mode || "customer_paid"),
          return_address: formatReturnAddress(String(settingsRow?.return_address || "")),
        };
        setReturnSettings(next);
        setInitialReturnSettings(next);
        const createdAt = String(settingsRow?.created_at || "");
        const updatedAt = String(settingsRow?.updated_at || "");
        setReturnsSeededNotice(Boolean(createdAt && updatedAt && createdAt === updatedAt));
      } finally {
        if (active) setReturnsLoading(false);
      }
    };
    loadReturns().catch(() => {
      if (active) setReturnsLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!loading) {
      setHasLoaded(true);
    }
  }, [loading]);

  // Hver switch får sin egen change handler der opdaterer lokale state felter.
  const handleToggle = useCallback(
    (key) => (next) => {
      setLocal((s) => ({ ...(s || {}), [key]: Boolean(next) }));
    },
    []
  );

  const handleSave = useCallback(async () => {
    if (!settings) return;
    const toastId = toast.loading("Saving changes...");
    try {
      const updates = {};

      toggles.forEach(({ key }) => {
        if (Boolean(local?.[key]) !== Boolean(settings?.[key])) {
          updates[key] = Boolean(local?.[key]);
        }
      });

      if (Boolean(local?.autoDraftEnabled) !== Boolean(settings?.autoDraftEnabled)) {
        updates.autoDraftEnabled = Boolean(local?.autoDraftEnabled);
      }

      const returnsDirty =
        returnSettingsSnapshot(returnSettings) !== returnSettingsSnapshot(initialReturnSettings);

      if (Object.keys(updates).length === 0 && !returnsDirty) {
        toast.success("Nothing to save.", { id: toastId });
        return;
      }

      if (Object.keys(updates).length > 0) {
        await save(updates);
      }
      if (returnsDirty) {
        const returnsResponse = await fetch("/api/settings/returns", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            return_window_days: Math.max(1, Number(returnSettings?.return_window_days || 30)),
            return_shipping_mode: String(returnSettings?.return_shipping_mode || "customer_paid"),
            return_address: formatReturnAddress(String(returnSettings?.return_address || "")),
          }),
        });
        const returnsPayload = await returnsResponse.json().catch(() => ({}));
        if (!returnsResponse.ok) {
          throw new Error(returnsPayload?.error || "Could not save return settings.");
        }
        const persisted = returnsPayload?.settings || {};
        const next = {
          return_window_days: Number(persisted?.return_window_days || returnSettings?.return_window_days || 30),
          return_shipping_mode: String(
            persisted?.return_shipping_mode || returnSettings?.return_shipping_mode || "customer_paid"
          ),
          return_address: formatReturnAddress(
            String(persisted?.return_address || returnSettings?.return_address || "")
          ),
        };
        setReturnSettings(next);
        setInitialReturnSettings(next);
      }
      toast.success("Saved.", { id: toastId });
    } catch (_) {
      toast.error("Could not save changes.", { id: toastId });
    }
  }, [initialReturnSettings, local, returnSettings, save, settings]);

  // dirty bruges både af header knappen og lokale CTA'er.
  const dirty = useMemo(() => {
    const baseDirty = toggles.some(
      ({ key }) => Boolean(local?.[key]) !== Boolean(settings?.[key])
    );
    const draftDirty =
      Boolean(local?.autoDraftEnabled) !== Boolean(settings?.autoDraftEnabled);
    const returnsDirty =
      returnSettingsSnapshot(returnSettings) !== returnSettingsSnapshot(initialReturnSettings);
    return baseDirty || draftDirty || returnsDirty;
  }, [initialReturnSettings, local, returnSettings, settings]);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  useEffect(() => {
    const handleClick = (event) => {
      if (!dirtyRef.current) return;
      const target = event.target;
      const anchor = target?.closest?.("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
        return;
      }
      if (anchor.target === "_blank" || anchor.dataset.noGuard) return;
      const nextUrl = new URL(href, window.location.href);
      const currentUrl = new URL(window.location.href);
      if (
        nextUrl.pathname === currentUrl.pathname &&
        nextUrl.search === currentUrl.search &&
        nextUrl.hash
      ) {
        return;
      }
      event.preventDefault();
      setPendingHref(nextUrl.toString());
      setLeaveDialogOpen(true);
    };
    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, []);

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

  const handleToggleAutoDraft = useCallback((next) => {
    setLocal((s) => ({ ...(s || {}), autoDraftEnabled: Boolean(next) }));
  }, []);

  const handleReturnFieldChange = useCallback((field, value) => {
    setReturnSettings((prev) => ({
      ...(prev || DEFAULT_RETURN_SETTINGS),
      [field]:
        field === "return_window_days" ? Math.max(1, Number(value || 30)) : value,
    }));
  }, []);

  const resizeReturnAddressTextarea = useCallback(() => {
    const el = returnAddressTextareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  const handleReturnAddressBlur = useCallback(() => {
    setReturnSettings((prev) => {
      const current = String(prev?.return_address || "");
      const formatted = formatReturnAddress(current);
      if (formatted === current) return prev;
      return {
        ...(prev || DEFAULT_RETURN_SETTINGS),
        return_address: formatted,
      };
    });
  }, []);

  useEffect(() => {
    resizeReturnAddressTextarea();
  }, [resizeReturnAddressTextarea, returnSettings?.return_address]);

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

  const handleResetLocal = useCallback(() => {
    setLocal(settings || {});
    setReturnSettings(initialReturnSettings || DEFAULT_RETURN_SETTINGS);
  }, [initialReturnSettings, settings]);

  const handleConfirmLeave = useCallback(() => {
    if (pendingHref) {
      window.location.href = pendingHref;
    }
  }, [pendingHref]);

  const isAutoDraftEnabled = Boolean(local?.autoDraftEnabled);
  const canEditDependent = isAutoDraftEnabled && !loading && !saving;
  const showSkeleton = loading && !hasLoaded;

  return (
    <AutomationPanelContext.Provider value={contextValue}>
      {children}
      <TooltipProvider>
        {showSkeleton ? (
          <div className="mt-8 space-y-7 pb-24">
            <Card className="rounded-2xl border border-border bg-white shadow-sm">
              <CardContent className="space-y-4 p-6">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-72" />
                <Skeleton className="h-10 w-32" />
              </CardContent>
            </Card>
            <Card className="rounded-2xl border border-border bg-white shadow-sm">
              <CardContent className="space-y-4 p-6">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-4 w-80" />
                <div className="grid gap-3 md:grid-cols-2">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              </CardContent>
            </Card>
            <Card className="rounded-2xl border border-border bg-white shadow-sm">
              <CardContent className="space-y-4 p-6">
                <Skeleton className="h-5 w-56" />
                <Skeleton className="h-4 w-80" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="mt-8 space-y-7 pb-6">
<SettingsSection
              title="Sona Assistant"
              description="Enable Sona Assistant to prepare draft replies for your team."
              featured
              action={
                <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <span
                    className={cn(
                      "text-xs font-medium",
                      isAutoDraftEnabled ? "text-emerald-700" : "text-slate-500"
                    )}
                  >
                    {isAutoDraftEnabled ? "Enabled" : "Disabled"}
                  </span>
                  <Switch
                    id="auto-draft-toggle"
                    checked={isAutoDraftEnabled}
                    onCheckedChange={handleToggleAutoDraft}
                    disabled={loading || saving}
                  />
                </div>
              }
            />

            <SettingsSection
              title="AI Permissions"
              description="Choose what actions Sona can perform automatically. When disabled, Sona will suggest the action for review instead."
              note={!isAutoDraftEnabled ? "Enable Sona Assistant to configure these settings." : null}
            >
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                {toggles.map((item) => {
                  const isOn = Boolean(local?.[item.key]);
                  const isComingSoon = item.status === "comingSoon";
                  const disabled = !canEditDependent || isComingSoon;
                  return (
                    <div key={item.key} className="border-b border-slate-100 last:border-b-0">
                      <ToggleRow
                        label={item.label}
                        description={item.description}
                        checked={isOn}
                        onCheckedChange={handleToggle(item.key)}
                        disabled={disabled}
                        badge={
                          isComingSoon ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span>
                                  <Badge
                                    variant="secondary"
                                    className="border border-slate-200 bg-slate-100 text-xs text-slate-600"
                                  >
                                    Coming soon
                                  </Badge>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>Not available yet.</TooltipContent>
                            </Tooltip>
                          ) : null
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </SettingsSection>

            <SettingsSection
              title="Return Handling"
              description="Configure how return requests are handled in your store."
              note="These rules are used by Sona when handling return requests."
              titleBadge={
                returnsSeededNotice ? (
                  <Badge variant="secondary" className="text-xs text-slate-600">
                    Auto-detected from policy
                  </Badge>
                ) : null
              }
            >
              <div className="space-y-6">
                <div className="space-y-6">
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-slate-900">Return eligibility</h3>
                    <div className="space-y-1.5">
                      <label className="sr-only">Return window (days)</label>
                      <Input
                        type="number"
                        min={1}
                        max={365}
                        value={String(returnSettings?.return_window_days ?? 30)}
                        onChange={(event) =>
                          handleReturnFieldChange("return_window_days", event.target.value)
                        }
                        disabled={returnsLoading || saving}
                        className="max-w-xs bg-white"
                      />
                      <p className="text-xs text-slate-500">
                        Number of days customers have to request a return.
                      </p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-slate-900">Return shipping</h3>
                    <div className="space-y-1.5">
                      <label className="sr-only">Return shipping mode</label>
                      <Select
                        value={String(returnSettings?.return_shipping_mode || "customer_paid")}
                        onValueChange={(value) => handleReturnFieldChange("return_shipping_mode", value)}
                        disabled={returnsLoading || saving}
                      >
                        <SelectTrigger className="max-w-xs bg-white">
                          <SelectValue placeholder="Select return shipping mode" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="customer_paid">Customer paid</SelectItem>
                          <SelectItem value="merchant_label">Merchant label</SelectItem>
                          <SelectItem value="pre_printed">Pre-printed</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-slate-500">
                        Choose how customers should return items.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-sm font-semibold text-slate-900">Return address</h3>
                  <label className="sr-only">Return address</label>
                  <Textarea
                    ref={returnAddressTextareaRef}
                    value={String(returnSettings?.return_address || "")}
                    onChange={(event) => handleReturnFieldChange("return_address", event.target.value)}
                    onInput={resizeReturnAddressTextarea}
                    onBlur={handleReturnAddressBlur}
                    disabled={returnsLoading || saving}
                    className="min-h-[112px] overflow-hidden bg-white leading-relaxed"
                    placeholder={"AceZone International ApS\nNordre Fasanvej 113, 2nd floor\n2000 Frederiksberg\nDenmark"}
                  />
                  {!returnSettings?.return_address && !returnsLoading && (
                    <p className="text-xs text-amber-600">
                      Missing return address — return instructions sent to customers will not include a complete address.
                    </p>
                  )}
                  {returnSettings?.return_address && (
                    <p className="text-xs text-slate-500">
                      Where customers should send returned items.
                    </p>
                  )}
                </div>
              </div>
            </SettingsSection>

            <SettingsSection
              title="Learning Profile"
              description="Manage learned writing preferences based on edits your team has made."
              className="border-slate-200 bg-slate-50/35"
              action={
                <Button type="button" size="sm" variant="outline" onClick={() => setResetDialogOpen(true)}>
                  Reset learning
                </Button>
              }
            />

            {error && (
              <Card className="rounded-2xl border border-destructive/40 bg-destructive/5">
                <CardContent className="px-5 py-4">
                  <p className="text-sm text-destructive">
                    {error.message ?? "Could not save automation settings."}
                  </p>
                </CardContent>
              </Card>
            )}
            <StickySaveBar
              isVisible={dirty}
              isSaving={saving || loading || returnsLoading}
              onSave={handleSave}
              onDiscard={handleResetLocal}
            />
          </div>
        )}
      </TooltipProvider>

      <AlertDialog
        open={leaveDialogOpen}
        onOpenChange={(open) => {
          setLeaveDialogOpen(open);
          if (!open) setPendingHref(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Leave this page without saving?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmLeave}>
              Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset learning?</AlertDialogTitle>
            <AlertDialogDescription>
              This clears learned writing preferences from edits. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleResetLearning}>
              Reset learning
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AutomationPanelContext.Provider>
  );
}
