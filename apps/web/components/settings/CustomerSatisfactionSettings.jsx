"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TabSkeleton } from "@/components/settings/TabSkeleton";
import { designerStatus } from "@/lib/email-designer/status";
import { previewDocument } from "@/lib/settings/confirmation-preview";
import { surveyPreviewSource } from "@/lib/settings/satisfaction";
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

const BADGE_VARIANTS = { published: "success", pending: "warning", draft: "neutral" };
const DESIGN_HREF = "/settings/csat/email";
const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());

export function CustomerSatisfactionSettings() {
  const workspaceDefaults = useMemo(() => ({ ...DEFAULTS }), []);
  const [settings, setSettings] = useState(workspaceDefaults);
  const [initialSettings, setInitialSettings] = useState(workspaceDefaults);
  const [emailTemplate, setEmailTemplate] = useState(null);
  const [saved, setSaved] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState({ open: false, loading: false, html: "" });
  const [testOpen, setTestOpen] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [sendingTest, setSendingTest] = useState(false);

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
        if (!settingsResponse.ok) throw new Error(settingsPayload.error || "Could not load survey settings.");
        if (!emailResponse.ok) throw new Error(emailPayload.error || "Could not load the survey email.");
        if (!active) return;
        const loaded = { ...workspaceDefaults, ...(settingsPayload.settings || {}) };
        setSettings(loaded);
        setInitialSettings(loaded);
        setEmailTemplate(emailPayload);
        setSaved(true);
      } catch (loadError) {
        if (active) setError(loadError.message || "Could not load survey settings.");
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
      if (!response.ok) throw new Error(payload.error || "Could not save survey settings.");
      const savedSettings = { ...workspaceDefaults, ...(payload.settings || settings) };
      setSettings(savedSettings);
      setInitialSettings(savedSettings);
      setSaved(true);
      toast.success("Survey settings saved.");
    } catch (saveError) {
      setError(saveError.message || "Could not save survey settings.");
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

  const previewSource = surveyPreviewSource(emailTemplate || {});

  const openPreview = async () => {
    if (!previewSource) return;
    if (previewSource.html) {
      setPreview({ open: true, loading: false, html: previewSource.html });
      return;
    }
    setPreview({ open: true, loading: true, html: "" });
    try {
      const response = await fetch("/api/settings/csat/email/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(previewSource.request),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not render the preview.");
      setPreview({ open: true, loading: false, html: payload.html || "" });
    } catch (previewError) {
      toast.error(previewError.message || "Could not render the preview.");
      setPreview({ open: false, loading: false, html: "" });
    }
  };

  const sendTest = async () => {
    if (!previewSource || !isEmail(testEmail) || sendingTest) return;
    setSendingTest(true);
    try {
      const response = await fetch("/api/settings/csat/email/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ recipient: testEmail.trim(), ...previewSource.request }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not send the test email.");
      toast.success(`Test email sent to ${payload.sent_to || testEmail.trim()}.`);
      setTestOpen(false);
    } catch (testError) {
      toast.error(testError.message || "Could not send the test email.");
    } finally {
      setSendingTest(false);
    }
  };

  if (loading) {
    return <TabSkeleton />;
  }

  const status = designerStatus({ draft: emailTemplate?.draft || null });

  return (
    <SettingsPage
      title="Satisfaction survey"
      description="Ask customers to rate their support after a ticket is resolved."
    >
      {error ? (
        <p role="alert" className="-mt-4 text-sm text-danger-foreground">{error}</p>
      ) : null}

      <SettingsGroup
        title="Delivery"
        action={
          <button
            type="button"
            onClick={reset}
            className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Reset to defaults
          </button>
        }
        footer="Only sent to real customer email addresses, after automatic and teammate resolutions. Changes apply to newly resolved tickets."
      >
        <SettingsRow
          label="Send satisfaction survey"
          description={
            settings.enabled
              ? "One survey per ticket, sent after the final resolution."
              : "Surveys are paused. Your setup stays ready to resume."
          }
        >
          <SettingsSwitch
            checked={Boolean(settings.enabled)}
            onCheckedChange={(value) => update("enabled", value)}
            aria-label="Send satisfaction survey"
          />
        </SettingsRow>
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

      <SettingsGroup title="Email design">
        <SettingsRow
          label={
            <span className="inline-flex items-center gap-2">
              Design
              <Badge variant={BADGE_VARIANTS[status.publish.tone]}>{status.publish.label}</Badge>
            </span>
          }
          description="Edit the question, logo, colors and rating buttons in the designer. Publish there to update what customers receive."
        >
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={openPreview} disabled={!previewSource}>
              Preview
            </Button>
            <Button asChild size="sm">
              <Link href={DESIGN_HREF}>Edit design</Link>
            </Button>
          </div>
        </SettingsRow>
        <SettingsRow
          label="Subject"
          description="Change it in the designer under Settings."
          controlClassName="sm:w-80 sm:justify-end"
        >
          <span className="truncate text-right text-sm text-foreground">
            {previewSource?.subject || "How was your support experience?"}
          </span>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="After rating">
        <SettingsRow
          label="Thank-you pages"
          description="What customers see after they rate, with separate pages for negative, neutral and positive ratings."
        >
          <Button asChild variant="outline" size="sm">
            <Link href="/settings/csat/thank-you">Edit pages</Link>
          </Button>
        </SettingsRow>
      </SettingsGroup>

      <Dialog open={preview.open} onOpenChange={(open) => !open && setPreview({ open: false, loading: false, html: "" })}>
        <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b border-border/60 py-4 pl-5 pr-14 text-left">
            <DialogTitle>{previewSource?.subject || "Satisfaction survey"}</DialogTitle>
            <DialogDescription>
              {previewSource?.label === "Live version"
                ? "The live version customers receive, shown with sample data."
                : "Your draft, shown with sample data. Publish it in the designer to send it."}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto bg-muted/40 p-4">
            {preview.loading ? (
              <p className="py-24 text-center text-sm text-muted-foreground">Rendering preview…</p>
            ) : (
              <iframe
                title="Satisfaction survey preview"
                srcDoc={previewDocument(preview.html)}
                sandbox="allow-same-origin"
                className="h-[60vh] w-full rounded-md border-0 bg-white"
              />
            )}
          </div>
          <DialogFooter className="shrink-0 border-t border-border/60 px-5 py-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setPreview({ open: false, loading: false, html: "" });
                setTestOpen(true);
              }}
            >
              Send test email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send a test email</DialogTitle>
            <DialogDescription>
              Sends the {previewSource?.label === "Live version" ? "live version" : "draft"} with sample data. Rating links are disabled in test emails.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="email"
            value={testEmail}
            onChange={(event) => setTestEmail(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && sendTest()}
            placeholder="you@example.com"
            autoFocus
            aria-label="Send to"
            className="text-foreground"
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTestOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={sendTest} disabled={sendingTest || !isEmail(testEmail)}>
              {sendingTest ? "Sending…" : "Send test"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SettingsSaveBar visible={!saved} saving={saving} onSave={save} onDiscard={discard} />
    </SettingsPage>
  );
}
