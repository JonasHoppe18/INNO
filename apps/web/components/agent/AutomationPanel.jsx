"use client";

import Link from "next/link";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAgentAutomation } from "@/hooks/useAgentAutomation";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// Definition af de tilstande vi lader brugeren styre fra automation-panelet.
const toggles = [
  {
    key: "orderUpdates",
    label: "Order updates",
    description: "Tracking + status replies",
  },
  {
    key: "cancelOrders",
    label: "Allow cancellations",
    description: "Cancel unshipped orders",
  },
  {
    key: "historicInboxAccess",
    label: "Historical inbox",
    description: "Use older emails for context",
  },
  {
    key: "automaticRefunds",
    label: "Automatic refunds",
    description: "Process small refunds automatically",
    status: "comingSoon",
  },
];

const draftDestinations = [
  {
    id: "sona_inbox",
    label: "Sona Inbox",
    description: "Review and send from Sona.",
    badge: "Recommended",
  },
  {
    id: "provider_inbox",
    label: "Your Inbox",
    description: "Drafts appear in Gmail/Outlook.",
    badge: "Gmail/Outlook",
  },
];

const AutomationPanelContext = createContext(null);

function SettingsSection({
  title,
  description,
  action,
  children,
  className,
  note,
  titleBadge,
}) {
  return (
    <Card className={cn("rounded-2xl border border-border bg-white shadow-sm", className)}>
      <CardContent className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-foreground">{title}</h2>
              {titleBadge}
            </div>
            <p className="text-sm text-muted-foreground">{description}</p>
            {note ? (
              <p className="text-xs text-muted-foreground">{note}</p>
            ) : null}
          </div>
          {action ? <div className="flex items-center gap-2">{action}</div> : null}
        </div>
        {children ? (
          <>
            <Separator className="my-5" />
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
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-foreground">{label}</p>
          {badge}
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
        {helper ? <p className="text-xs text-muted-foreground">{helper}</p> : null}
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-label={label}
      />
    </div>
  );
}

function RadioCard({ id, value, title, description, badge, disabled, active }) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex items-start gap-3 rounded-xl border p-4 text-sm transition",
        active
          ? "border-foreground/60 bg-muted/40"
          : "border-border bg-background hover:border-foreground/30",
        disabled && "pointer-events-none opacity-60"
      )}
    >
      <RadioGroupItem id={id} value={value} className="mt-1" disabled={disabled} />
      <div className="flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-foreground">{title}</span>
          {badge ? (
            <Badge variant="secondary" className="text-xs">
              {badge}
            </Badge>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </label>
  );
}

function StickySaveBar({ isDirty, isSaving, onSave, onReset }) {
  if (!isDirty) return null;
  return (
    <div className="fixed bottom-4 left-1/2 z-20 w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 rounded-2xl border border-border bg-background/95 px-4 py-3 shadow-lg backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-medium text-muted-foreground">Unsaved changes</span>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onReset}>
            Discard
          </Button>
          <Button type="button" size="sm" onClick={onSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save changes"}
          </Button>
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
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [pendingHref, setPendingHref] = useState(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const dirtyRef = useRef(false);

  useEffect(() => {
    setLocal(settings || {});
  }, [settings]);

  useEffect(() => {
    if (!loading) {
      setHasLoaded(true);
    }
  }, [loading]);

  const draftDestination =
    local?.draftDestination ?? settings?.draftDestination ?? "provider_inbox";

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

      if ((local?.draftDestination ?? settings?.draftDestination) !== settings?.draftDestination) {
        updates.draftDestination = local?.draftDestination ?? settings?.draftDestination;
      }

      if (Object.keys(updates).length === 0) {
        toast.success("Nothing to save.", { id: toastId });
        return;
      }

      await save(updates);
      toast.success("Saved.", { id: toastId });
    } catch (_) {
      toast.error("Could not save changes.", { id: toastId });
    }
  }, [local, save, settings]);

  // dirty bruges både af header knappen og lokale CTA'er.
  const dirty = useMemo(() => {
    const baseDirty = toggles.some(
      ({ key }) => Boolean(local?.[key]) !== Boolean(settings?.[key])
    );
    const draftDirty =
      Boolean(local?.autoDraftEnabled) !== Boolean(settings?.autoDraftEnabled);
    const destinationDirty =
      (local?.draftDestination ?? settings?.draftDestination) !==
      settings?.draftDestination;
    return baseDirty || draftDirty || destinationDirty;
  }, [local, settings]);

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

  const handleDestinationPick = useCallback(
    (next) => {
      if (!next || next === draftDestination) return;
      setLocal((s) => ({ ...(s || {}), draftDestination: next }));
    },
    [draftDestination]
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

  const handleResetLocal = useCallback(() => {
    setLocal(settings || {});
  }, [settings]);

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
          <div className="mt-6 space-y-6 pb-24">
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
          <div className="mt-6 space-y-6">
            <SettingsSection
              title="Sona Assistant"
              description="When enabled, Sona prepares draft replies for new emails. You review and send."
              action={
                <div className="flex items-center gap-3">
                  <Badge
                    variant="secondary"
                    className={cn(
                      "text-xs",
                      isAutoDraftEnabled
                        ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border border-border bg-muted text-muted-foreground"
                    )}
                  >
                    {isAutoDraftEnabled ? "Assistant ON" : "Assistant OFF"}
                  </Badge>
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
              title="Where drafts appear"
              description="Choose where drafts appear after Sona writes them."
              note={
                !isAutoDraftEnabled
                  ? "Enable Auto-draft to configure these settings."
                  : "Inbox drafts require Gmail or Outlook connected."
              }
            >
              <RadioGroup
                value={draftDestination}
                onValueChange={handleDestinationPick}
                className="grid gap-3 md:grid-cols-2"
                disabled={!canEditDependent}
              >
                {draftDestinations.map((destination) => {
                  const isActive = destination.id === draftDestination;
                  return (
                    <RadioCard
                      key={destination.id}
                      id={`draft-destination-${destination.id}`}
                      value={destination.id}
                      title={destination.label}
                      description={destination.description}
                      badge={destination.badge}
                      disabled={!canEditDependent}
                      active={isActive}
                    />
                  );
                })}
              </RadioGroup>
              {draftDestination === "provider_inbox" && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary" className="text-xs">
                    Requires Gmail/Outlook connected
                  </Badge>
                  <Link
                    href="/mailboxes"
                    className="text-xs font-medium text-foreground underline underline-offset-4"
                  >
                    Manage mailboxes
                  </Link>
                </div>
              )}
            </SettingsSection>

            <SettingsSection
              title="What Sona is allowed to do"
              description="Choose what the agent can handle automatically."
              note={!isAutoDraftEnabled ? "Enable Auto-draft to configure these settings." : null}
            >
              <div className="space-y-4">
                {toggles.map((item, index) => {
                  const isOn = Boolean(local?.[item.key]);
                  const isComingSoon = item.status === "comingSoon";
                  const disabled = !canEditDependent || isComingSoon;
                  return (
                    <div key={item.key} className="space-y-4">
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
                                  <Badge variant="secondary" className="text-xs">
                                    Coming soon
                                  </Badge>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>Not available yet.</TooltipContent>
                            </Tooltip>
                          ) : null
                        }
                      />
                      {index < toggles.length - 1 ? <Separator /> : null}
                    </div>
                  );
                })}
              </div>
            </SettingsSection>

            <SettingsSection
              title="Learning profile"
              description="Clear learned writing preferences from edits."
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
              isDirty={dirty}
              isSaving={saving || loading}
              onSave={handleSave}
              onReset={handleResetLocal}
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
