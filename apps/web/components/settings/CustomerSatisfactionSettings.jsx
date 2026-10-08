"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TabSkeleton } from "@/components/settings/TabSkeleton";
import {
  SettingsGroup,
  SettingsPage,
  SettingsRow,
  SettingsSaveBar,
  SettingsSwitch,
} from "@/components/settings/ui/settings-layout";

const DEFAULTS = {
  enabled: false,
  delay: "1h",
  delayMinutes: 60,
  languageMode: "conversation",
};

function emailTemplateStatus(template) {
  const draft = template?.draft;
  const published = template?.published;
  if (published?.id) {
    return { label: "Published", variant: "success", note: `Live version ${published.version || 1} is sent to customers.` };
  }
  if (draft?.id) {
    return { label: "Draft", variant: "warning", note: "Start with the default email, then publish your version when it is ready." };
  }
  return { label: "Starter template", variant: "neutral", note: "Start with the default email, then publish your version when it is ready." };
}

export function CustomerSatisfactionSettings() {
  const workspaceDefaults = useMemo(() => ({ ...DEFAULTS }), []);
  const [settings, setSettings] = useState(workspaceDefaults);
  const [initialSettings, setInitialSettings] = useState(workspaceDefaults);
  const [emailTemplate, setEmailTemplate] = useState(null);
  const [saved, setSaved] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const [settingsResponse, emailResponse] = await Promise.all([
          fetch("/api/settings/customer-satisfaction", { credentials: "include" }),
          fetch("/api/settings/csat/email", { credentials: "include", cache: "no-store" }),
        ]);
        const settingsPayload = await settingsResponse.json().catch(() => ({}));
        const emailPayload = await emailResponse.json().catch(() => ({}));
        if (!settingsResponse.ok) throw new Error(settingsPayload.error || "Could not load CSAT settings.");
        if (!emailResponse.ok) throw new Error(emailPayload.error || "Could not load the CSAT email status.");
        if (!active) return;
        const loaded = { ...workspaceDefaults, ...(settingsPayload.settings || {}) };
        setSettings(loaded);
        setInitialSettings(loaded);
        setEmailTemplate(emailPayload);
        setSaved(true);
      } catch (loadError) {
        if (active) setError(loadError.message || "Could not load CSAT settings.");
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [workspaceDefaults]);

  const update = (key, value) => {
    setSaved(false);
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const handleDelayChange = (value) => {
    setSaved(false);
    setSettings((current) => ({
      ...current,
      delay: value,
      delayMinutes: value === "custom" && !Number.isInteger(Number(current.delayMinutes)) ? 60 : current.delayMinutes,
    }));
  };

  const save = async () => {
    if (settings.delay === "custom") {
      const customDelayMinutes = Number(settings.delayMinutes);
      if (!Number.isInteger(customDelayMinutes) || customDelayMinutes < 5 || customDelayMinutes > 10080) {
        setError("Choose a custom delay between 5 minutes and 7 days.");
        return;
      }
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/settings/customer-satisfaction", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ enabled: settings.enabled, delay: settings.delay, delayMinutes: settings.delayMinutes, languageMode: settings.languageMode }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not save CSAT settings.");
      const savedSettings = { ...workspaceDefaults, ...(payload.settings || settings) };
      setSettings(savedSettings);
      setInitialSettings(savedSettings);
      setSaved(true);
      toast.success("CSAT delivery settings saved");
    } catch (saveError) {
      setError(saveError.message || "Could not save CSAT settings.");
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setSettings(workspaceDefaults);
    setSaved(false);
  };

  const discard = () => {
    setSettings(initialSettings);
    setSaved(true);
  };

  if (loading) {
    return <TabSkeleton />;
  }

  const emailStatus = emailTemplateStatus(emailTemplate);

  return (
    <SettingsPage
      title="Customer satisfaction"
      description="Choose when surveys are sent, then build the customer-facing email in one focused workspace."
      actions={
        <Button asChild size="sm" variant="outline">
          <Link href="/settings/csat/email">Open email builder</Link>
        </Button>
      }
    >
      {error ? (
        <p role="alert" className="-mt-4 text-sm text-danger-foreground">{error}</p>
      ) : null}

      <SettingsGroup title="Survey">
        <SettingsRow
          label="Send CSAT surveys"
          description={
            settings.enabled
              ? "One survey per ticket, sent after the final resolution."
              : "Surveys are paused. Your setup remains editable and ready to resume."
          }
        >
          <SettingsSwitch
            checked={Boolean(settings.enabled)}
            onCheckedChange={(value) => update("enabled", value)}
            aria-label="Send CSAT surveys"
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        title="Delivery"
        description="Keep the request close to resolution while giving the customer a little breathing room."
        footer={
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <span className="font-medium text-foreground">Customer emails only.</span> Surveys are sent after automatic and teammate resolutions when the recipient is a real customer email. Delivery changes apply to newly resolved tickets.
            </span>
            <button type="button" onClick={reset} className="font-medium text-foreground underline-offset-4 hover:underline">
              Reset delivery settings
            </button>
          </span>
        }
      >
        <SettingsRow label="Send survey" description="Reopened conversations wait for their final resolution." htmlFor="csat-delay">
          <Select value={settings.delay} onValueChange={handleDelayChange}>
            <SelectTrigger id="csat-delay" className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="immediately">Immediately after resolution</SelectItem>
              <SelectItem value="1h">1 hour after resolution</SelectItem>
              <SelectItem value="24h">24 hours after resolution</SelectItem>
              <SelectItem value="custom">Custom delay</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        {settings.delay === "custom" ? (
          <SettingsRow
            label="Custom delay"
            description="Choose between 5 minutes and 7 days (10,080 minutes)."
            htmlFor="csat-custom-delay"
          >
            <div className="flex items-center gap-2">
              <Input
                id="csat-custom-delay"
                type="number"
                min="5"
                max="10080"
                step="1"
                inputMode="numeric"
                value={settings.delayMinutes ?? ""}
                onChange={(event) => update("delayMinutes", event.target.value === "" ? "" : Number(event.target.value))}
                className="h-8 w-24 text-input text-foreground md:text-sm"
                aria-invalid={
                  Number.isNaN(Number(settings.delayMinutes)) ||
                  Number(settings.delayMinutes) < 5 ||
                  Number(settings.delayMinutes) > 10080
                }
              />
              <span className="text-sm text-muted-foreground">minutes</span>
            </div>
          </SettingsRow>
        ) : null}
        <SettingsRow
          label="Email language"
          description="System copy follows the selected language. Text in your template stays as written."
          htmlFor="csat-language"
        >
          <Select value={settings.languageMode} onValueChange={(value) => update("languageMode", value)}>
            <SelectTrigger id="csat-language" className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="conversation">Conversation language</SelectItem>
              <SelectItem value="workspace">Workspace default</SelectItem>
              <SelectItem value="en">Always English</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        title="Email and responses"
        description="Design the survey email and the pages customers see after rating in their builders."
      >
        <SettingsRow
          label={
            <span className="inline-flex items-center gap-2">
              CSAT survey email
              <Badge variant={emailStatus.variant}>{emailStatus.label}</Badge>
            </span>
          }
          description={`${emailTemplate?.draft?.subject || "How was your support experience?"} · ${emailStatus.note}`}
        >
          <Button asChild variant="outline" size="sm">
            <Link href="/settings/csat/email">Edit email</Link>
          </Button>
        </SettingsRow>
        <SettingsRow
          label="Thank-you responses"
          description="Response pages for negative, neutral and positive ratings. Kept separate from the email."
        >
          <Button asChild variant="outline" size="sm">
            <Link href="/settings/csat/thank-you">Edit responses</Link>
          </Button>
        </SettingsRow>
      </SettingsGroup>

      <SettingsSaveBar visible={!saved} saving={saving} onSave={save} onDiscard={discard} />
    </SettingsPage>
  );
}
