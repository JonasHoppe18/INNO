"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useClerkSupabase } from "@/lib/useClerkSupabase";
import { useSettingsDirty } from "@/components/settings/SettingsRouteContext";
import { useSettingsWorkspace } from "@/components/settings/SettingsWorkspaceProvider";
import { initialGeneralState, normalizeAutoCloseMode } from "@/lib/settings/general";
import {
  SettingsGroup,
  SettingsPage,
  SettingsRow,
  SettingsSaveBar,
  SettingsSwitch,
} from "@/components/settings/ui/settings-layout";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DEFAULT_STALE_DAYS, normalizeStaleDays } from "@/lib/inbox/stale-days";
import { SUPPORTED_SUPPORT_LANGUAGE_CODES, SUPPORT_LANGUAGE_LABELS, normalizeSupportLanguage } from "@/lib/translation/languages";

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
  return (
    <SettingsPage title="General" description="Workspace details and how tickets move through the inbox.">
      <SettingsGroup title="Workspace">
        <SettingsRow label="Store" description="Connected Shopify store. Read-only.">
          <span className="truncate text-sm text-muted-foreground">{shopDomain || "No shop connected"}</span>
        </SettingsRow>
        <SettingsRow label="Team name" description="Your team's visible name within Sona." htmlFor="settings-team-name">
          <Input
            id="settings-team-name"
            value={teamName}
            onChange={(e) => onTeamNameChange(e.target.value)}
            placeholder="Team name"
            className="h-8 text-input text-foreground md:text-sm"
          />
        </SettingsRow>
        <SettingsRow label="Support language" description="The language your team prefers to read messages in.">
          <Select value={supportLanguage} onValueChange={onSupportLanguageChange} disabled={!hasWorkspaceScope}>
            <SelectTrigger className="h-8 text-sm" aria-label="Support language">
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
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Ticket lifecycle" description="When inactive tickets move forward automatically.">
        <SettingsRow
          label="Automatic closing"
          description="Close resolved and acknowledged tickets automatically. When off, Sona flags them for one-click approval."
        >
          <SettingsSwitch
            aria-label="Automatic closing"
            checked={autoCloseMode === "auto"}
            onCheckedChange={(checked) => onAutoCloseModeChange(checked ? "auto" : "approve")}
            disabled={!hasWorkspaceScope}
          />
        </SettingsRow>
        <SettingsRow
          label="Auto-resolve inbox tickets"
          description="Move tickets with no customer activity to Resolved. Set to 0 to disable."
          htmlFor="settings-stale-days"
        >
          <div className="flex items-center gap-2">
            <Input
              id="settings-stale-days"
              type="number"
              min={0}
              max={365}
              step={1}
              value={needsAttentionStaleDays}
              onChange={(e) => onNeedsAttentionStaleDaysChange(e.target.value)}
              placeholder="7"
              className="h-8 w-20 text-input text-foreground md:text-sm"
              disabled={!hasWorkspaceScope}
            />
            <span className="text-sm text-muted-foreground">days</span>
          </div>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        title="Test mode"
        description="Simulate actions without writing to Shopify, shipping providers or other integrations."
        footer={hasWorkspaceScope ? null : (
          <span className="text-warning-foreground">Test mode settings require an organization workspace.</span>
        )}
      >
        <SettingsRow label="Test mode" description="Actions are simulated while this is on.">
          <SettingsSwitch
            aria-label="Test mode"
            checked={Boolean(testMode)}
            onCheckedChange={(checked) => onTestModeChange(Boolean(checked))}
            disabled={!hasWorkspaceScope}
          />
        </SettingsRow>
        <SettingsRow
          label="Test email address"
          description="Outgoing emails are redirected here while test mode is on."
          htmlFor="settings-test-email"
        >
          <Input
            id="settings-test-email"
            type="email"
            value={testEmail}
            onChange={(e) => onTestEmailChange(e.target.value)}
            placeholder="qa@company.com"
            className="h-8 text-input text-foreground md:text-sm"
            disabled={!hasWorkspaceScope}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsSaveBar visible={canSave} saving={saving} onSave={onSave} onDiscard={onReset} />
    </SettingsPage>
  );
}

export function GeneralSection() {
  const supabase = useClerkSupabase();
  const { workspace, resources, setResource, setWorkspaceName } = useSettingsWorkspace();
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
        setResource("/api/settings/test-mode", {
          ...testModePayload,
          test_mode: nextTestMode,
          test_email: nextTestEmail,
          support_language: persistedSupportLanguage,
          auto_close_mode: persistedAutoCloseMode,
          needs_attention_stale_days: persistedNeedsAttentionStaleDays,
        });
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
    setResource,
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
