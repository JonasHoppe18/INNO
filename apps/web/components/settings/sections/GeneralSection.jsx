"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useClerkSupabase } from "@/lib/useClerkSupabase";
import { useSettingsDirty } from "@/components/settings/SettingsRouteContext";
import { useSettingsWorkspace } from "@/components/settings/SettingsWorkspaceProvider";
import { initialGeneralState, normalizeAutoCloseMode } from "@/lib/settings/general";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StickySaveBar } from "@/components/ui/sticky-save-bar";
import { DEFAULT_STALE_DAYS, normalizeStaleDays } from "@/lib/inbox/stale-days";
import { SUPPORTED_SUPPORT_LANGUAGE_CODES, SUPPORT_LANGUAGE_LABELS, normalizeSupportLanguage } from "@/lib/translation/languages";
import { cn } from "@/lib/utils";
import {
  Clock,
  Globe,
  Lock,
  Mail,
  User,
} from "lucide-react";

function StoreTeamRow({ icon: Icon, label, description, value, editing, children }) {
  return (
    <div className="flex items-center gap-4 border-b border-border/80 py-5 last:border-b-0">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {editing ? (
        <div className="w-56 shrink-0">{children}</div>
      ) : (
        <span className="shrink-0 text-sm font-medium text-muted-foreground">{value}</span>
      )}
    </div>
  );
}

function GeneralTab({
  shopDomain,
  teamName,
  onTeamNameChange,
  testMode,
  onTestModeChange,
  testEmail,
  onTestEmailChange,
  supportLanguage,
  onSupportLanguageChange,
  autoCloseMode,
  onAutoCloseModeChange,
  needsAttentionStaleDays,
  onNeedsAttentionStaleDaysChange,
  hasWorkspaceScope,
  onSave,
  onReset,
  saving,
  canSave,
}) {
  const langLabel = SUPPORT_LANGUAGE_LABELS[supportLanguage] || supportLanguage;

  return (
    <section className="w-full space-y-5">
      <div className="mb-6">
        <h2 className="text-page-heading font-semibold tracking-tight text-foreground">General</h2>
        <p className="mt-1 text-sm text-muted-foreground">Manage workspace details and ticket lifecycle defaults.</p>
      </div>

      <div className="rounded-xl border border-border/90 bg-card">
        <div className="px-6 pb-2 pt-5">
          <div>
            <h3 className="text-section-heading font-semibold text-foreground">Workspace details</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">Your connected store and shared workspace preferences.</p>
          </div>
        </div>
        <div className="px-6 pb-2">
          <StoreTeamRow
            icon={Lock}
            label="Store URL"
            description="Connected Shopify store (read-only)"
            value={shopDomain || "No shop connected"}
            editing={false}
          />
          <StoreTeamRow
            icon={User}
            label="Team name"
            description="This is your team's visible name within Sona."
            value={teamName}
            editing
          >
            <Input
              value={teamName}
              onChange={(e) => onTeamNameChange(e.target.value)}
              placeholder="Team name"
              className="h-9 text-input md:text-sm"
            />
          </StoreTeamRow>
          <StoreTeamRow
            icon={Globe}
            label="Support language"
            description="The language your team prefers to read messages in."
            value={langLabel}
            editing
          >
            <Select value={supportLanguage} onValueChange={onSupportLanguageChange} disabled={!hasWorkspaceScope}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Select language" />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_SUPPORT_LANGUAGE_CODES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {SUPPORT_LANGUAGE_LABELS[code]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </StoreTeamRow>
        </div>
      </div>

      <div className="rounded-xl border border-border/90 bg-card">
        <div className="px-6 pb-2 pt-5">
          <h3 className="text-section-heading font-semibold text-foreground">Ticket lifecycle</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">Choose when inactive tickets should move forward automatically.</p>
        </div>
        <div className="px-6 pb-2">
          <StoreTeamRow
            icon={Clock}
            label="Allow automatic closing"
            description="When on, Sona closes resolved/acknowledged tickets automatically. When off (default) it only flags them for one-click approval."
            editing
          >
            <button
              type="button"
              role="switch"
              aria-checked={autoCloseMode === "auto"}
              onClick={() => onAutoCloseModeChange(autoCloseMode === "auto" ? "approve" : "auto")}
              disabled={!hasWorkspaceScope}
              className={cn(
                "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200",
                autoCloseMode === "auto" ? "bg-primary/80" : "bg-input",
                !hasWorkspaceScope && "cursor-not-allowed opacity-70"
              )}
            >
              <span
                className={cn(
                  "inline-block h-5 w-5 rounded-full bg-card shadow-sm transition-transform duration-200",
                  autoCloseMode === "auto" ? "translate-x-6" : "translate-x-1"
                )}
              />
            </button>
          </StoreTeamRow>
          <StoreTeamRow
            icon={Clock}
            label="Auto-resolve inbox tickets"
            description="Inbox tickets with no new customer activity for this many days move to Resolved automatically. Set to 0 to disable."
            value={
              Number(needsAttentionStaleDays) === 0
                ? "Disabled"
                : `${needsAttentionStaleDays} days`
            }
            editing
          >
            <Input
              type="number"
              min={0}
              max={365}
              step={1}
              value={needsAttentionStaleDays}
              onChange={(e) => onNeedsAttentionStaleDaysChange(e.target.value)}
              placeholder="7"
              className="h-9 text-input md:text-sm"
              disabled={!hasWorkspaceScope}
            />
          </StoreTeamRow>
        </div>
      </div>

      <div className="rounded-xl border border-border/90 bg-card">
        <div className="flex items-center justify-between px-6 py-5">
          <div>
            <h3 className="text-section-heading font-semibold text-foreground">Test Mode</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Simulate actions without writing to Shopify, shipping providers, or other integrations.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={Boolean(testMode)}
            onClick={() => onTestModeChange(!Boolean(testMode))}
            disabled={!hasWorkspaceScope}
            className={cn(
              "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200",
              testMode ? "bg-primary/80" : "bg-input",
              !hasWorkspaceScope && "cursor-not-allowed opacity-70"
            )}
          >
            <span
              className={cn(
                "inline-block h-5 w-5 rounded-full bg-card shadow-sm transition-transform duration-200",
                testMode ? "translate-x-6" : "translate-x-1"
              )}
            />
          </button>
        </div>

        <div className="border-t border-border px-6 py-4">
          <div className="flex flex-wrap items-center gap-4 lg:flex-nowrap">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Mail className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">Test email address</p>
              <p className="text-xs text-muted-foreground">All outgoing emails will be redirected here while Test Mode is active.</p>
            </div>
            <Input
              type="email"
              value={testEmail}
              onChange={(e) => onTestEmailChange(e.target.value)}
              placeholder="qa@company.com"
              className="h-11 w-full max-w-[520px] shrink-0 lg:w-1/2 text-input md:text-sm"
              disabled={!hasWorkspaceScope}
            />
          </div>
        </div>
        {!hasWorkspaceScope && (
          <p className="px-6 pb-4 text-xs text-warning-foreground">Test Mode settings require an organization workspace.</p>
        )}
      </div>

      <StickySaveBar
        isVisible={canSave}
        isSaving={saving}
        onSave={onSave}
        onDiscard={onReset}
      />
    </section>
  );
}

export function GeneralSection() {
  const supabase = useClerkSupabase();
  const { workspace, resources, refreshResource, setWorkspaceName } = useSettingsWorkspace();
  const { workspaceId, shopId, shopDomain } = workspace;
  // Drafts initialize once per mount from the loaded resources.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const init = useMemo(() => initialGeneralState(workspace, resources), []);
  const [saving, setSaving] = useState(false);
  const [teamName, setTeamName] = useState(init.teamName);
  const [initialTeamName, setInitialTeamName] = useState(init.teamName);
  const [testMode, setTestMode] = useState(init.testMode);
  const [initialTestMode, setInitialTestMode] = useState(init.testMode);
  const [testEmail, setTestEmail] = useState(init.testEmail);
  const [initialTestEmail, setInitialTestEmail] = useState(init.testEmail);
  const [supportLanguage, setSupportLanguage] = useState(init.supportLanguage);
  const [initialSupportLanguage, setInitialSupportLanguage] = useState(init.supportLanguage);
  const [autoCloseMode, setAutoCloseMode] = useState(init.autoCloseMode);
  const [initialAutoCloseMode, setInitialAutoCloseMode] = useState(init.autoCloseMode);
  const [needsAttentionStaleDays, setNeedsAttentionStaleDays] = useState(init.needsAttentionStaleDays);
  const [initialNeedsAttentionStaleDays, setInitialNeedsAttentionStaleDays] = useState(init.needsAttentionStaleDays);

  const canSave = useMemo(
    () =>
      String(teamName || "").trim() !== String(initialTeamName || "").trim() ||
      Boolean(testMode) !== Boolean(initialTestMode) ||
      String(testEmail || "").trim() !== String(initialTestEmail || "").trim() ||
      normalizeSupportLanguage(supportLanguage) !== normalizeSupportLanguage(initialSupportLanguage) ||
      normalizeAutoCloseMode(autoCloseMode) !== normalizeAutoCloseMode(initialAutoCloseMode) ||
      normalizeStaleDays(needsAttentionStaleDays) !== normalizeStaleDays(initialNeedsAttentionStaleDays),
    [
      autoCloseMode,
      initialAutoCloseMode,
      needsAttentionStaleDays,
      initialNeedsAttentionStaleDays,
      initialSupportLanguage,
      initialTeamName,
      teamName,
      initialTestMode,
      testMode,
      initialTestEmail,
      testEmail,
      supportLanguage,
    ]
  );

  const handleSaveGeneral = useCallback(async () => {
    if (!supabase || !canSave || saving) return;

    setSaving(true);
    try {
      const nextTeamName = String(teamName || "").trim() || "Sona Team";
      const nextTestMode = Boolean(testMode);
      const nextTestEmail = String(testEmail || "").trim() || null;
      const nextSupportLanguage = normalizeSupportLanguage(supportLanguage, "en");
      const nextAutoCloseMode = normalizeAutoCloseMode(autoCloseMode);
      const nextNeedsAttentionStaleDays = normalizeStaleDays(needsAttentionStaleDays);
      if (workspaceId) {
        const { error: workspaceNameError } = await supabase
          .from("workspaces")
          .update({ name: nextTeamName })
          .eq("id", workspaceId);
        if (workspaceNameError) throw workspaceNameError;

        const testModeResponse = await fetch("/api/settings/test-mode", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            test_mode: nextTestMode,
            test_email: nextTestEmail,
            support_language: nextSupportLanguage,
            auto_close_mode: nextAutoCloseMode,
            needs_attention_stale_days: nextNeedsAttentionStaleDays,
          }),
        });
        const testModePayload = await testModeResponse.json().catch(() => ({}));
        if (!testModeResponse.ok) {
          throw new Error(testModePayload?.error || "Could not save test mode settings.");
        }
        const persistedSupportLanguage = normalizeSupportLanguage(
          testModePayload?.support_language || nextSupportLanguage
        );
        const persistedAutoCloseMode = normalizeAutoCloseMode(
          testModePayload?.auto_close_mode,
          nextAutoCloseMode
        );
        const persistedNeedsAttentionStaleDays = normalizeStaleDays(
          testModePayload?.needs_attention_stale_days ?? nextNeedsAttentionStaleDays
        );
        setSupportLanguage(persistedSupportLanguage);
        setInitialSupportLanguage(persistedSupportLanguage);
        setAutoCloseMode(persistedAutoCloseMode);
        setInitialAutoCloseMode(persistedAutoCloseMode);
        setNeedsAttentionStaleDays(String(persistedNeedsAttentionStaleDays));
        setInitialNeedsAttentionStaleDays(String(persistedNeedsAttentionStaleDays));
      } else if (shopId) {
        const { error } = await supabase.from("shops").update({ team_name: nextTeamName }).eq("id", shopId);
        if (error) throw error;
      } else {
        throw new Error("No workspace or shop found to save team name.");
      }
      setTeamName(nextTeamName);
      setInitialTeamName(nextTeamName);
      setTestMode(nextTestMode);
      setInitialTestMode(nextTestMode);
      setTestEmail(nextTestEmail || "");
      setInitialTestEmail(nextTestEmail || "");
      if (!workspaceId) {
        setSupportLanguage(nextSupportLanguage);
        setInitialSupportLanguage(nextSupportLanguage);
        setAutoCloseMode("approve");
        setInitialAutoCloseMode("approve");
        setNeedsAttentionStaleDays(String(DEFAULT_STALE_DAYS));
        setInitialNeedsAttentionStaleDays(String(DEFAULT_STALE_DAYS));
      }
      if (workspaceId) refreshResource("/api/settings/test-mode");
      setWorkspaceName(nextTeamName);
      toast.success("Settings saved.");
    } catch (error) {
      if (error?.code === "42703") {
        toast.error("A required settings column is missing. Run the latest SQL schema updates.");
      } else {
        toast.error(error?.message || "Could not save settings.");
      }
    } finally {
      setSaving(false);
    }
  }, [
    canSave,
    saving,
    shopId,
    supabase,
    supportLanguage,
    autoCloseMode,
    needsAttentionStaleDays,
    teamName,
    testEmail,
    testMode,
    workspaceId,
    refreshResource,
    setWorkspaceName,
  ]);

  const handleResetGeneral = useCallback(() => {
    setTeamName(String(initialTeamName || "Sona Team"));
    setTestMode(Boolean(initialTestMode));
    setTestEmail(String(initialTestEmail || ""));
    setSupportLanguage(normalizeSupportLanguage(initialSupportLanguage, "en"));
    setAutoCloseMode(normalizeAutoCloseMode(initialAutoCloseMode));
    setNeedsAttentionStaleDays(
      String(normalizeStaleDays(initialNeedsAttentionStaleDays))
    );
  }, [
    initialAutoCloseMode,
    initialNeedsAttentionStaleDays,
    initialSupportLanguage,
    initialTeamName,
    initialTestEmail,
    initialTestMode,
  ]);

  useSettingsDirty(canSave);

  return (
    <GeneralTab
      shopDomain={shopDomain}
      teamName={teamName}
      onTeamNameChange={setTeamName}
      testMode={testMode}
      onTestModeChange={setTestMode}
      testEmail={testEmail}
      onTestEmailChange={setTestEmail}
      supportLanguage={supportLanguage}
      onSupportLanguageChange={setSupportLanguage}
      autoCloseMode={autoCloseMode}
      onAutoCloseModeChange={setAutoCloseMode}
      needsAttentionStaleDays={needsAttentionStaleDays}
      onNeedsAttentionStaleDaysChange={setNeedsAttentionStaleDays}
      hasWorkspaceScope={Boolean(workspaceId)}
      onSave={handleSaveGeneral}
      onReset={handleResetGeneral}
      saving={saving}
      canSave={canSave}
    />
  );
}
