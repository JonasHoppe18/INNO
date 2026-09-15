"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Mail, MessageSquare } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StickySaveBar } from "@/components/ui/sticky-save-bar";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const DEFAULTS = {
  enabled: false,
  delay: "1h",
  delayMinutes: 60,
  languageMode: "conversation",
};

function SectionHeading({ eyebrow, title, description }) {
  return (
    <div>
      {eyebrow ? <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{eyebrow}</p> : null}
      <h3 className="mt-1 text-base font-semibold tracking-tight">{title}</h3>
      {description ? <p className="mt-1 max-w-xl text-sm leading-5 text-muted-foreground">{description}</p> : null}
    </div>
  );
}

function EmailTemplateSummary({ template }) {
  const draft = template?.draft;
  const published = template?.published;
  const status = published?.id ? "Published" : draft?.id ? "Draft" : "Starter template";
  const statusClass = published?.id
    ? "bg-emerald-50 text-emerald-700"
    : draft?.id
      ? "bg-amber-50 text-amber-700"
      : "bg-violet-50 text-violet-700";

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-center">
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
          <Mail className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">CSAT survey email</h3>
            <Badge className={cn("rounded-full border-0 px-2 py-0 text-[10px]", statusClass)}>{status}</Badge>
          </div>
          <p className="mt-1 truncate text-sm text-muted-foreground">{draft?.subject || "How was your support experience?"}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {published?.id ? `Live version ${published.version || 1} is sent to customers.` : "Start with the default email, then publish your version when it is ready."}
          </p>
        </div>
      </div>
      <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
        <div className="mx-auto max-w-[220px] rounded-lg border border-border/70 bg-background p-3 shadow-sm">
          <div className="mx-auto h-1.5 w-20 rounded-full bg-foreground/80" />
          <div className="mx-auto mt-2 h-1.5 w-32 rounded-full bg-muted-foreground/30" />
          <div className="mt-4 flex justify-center gap-1.5">
            {[1, 2, 3, 4, 5].map((score) => <span key={score} className="flex size-6 items-center justify-center rounded-full border border-border text-[9px] text-muted-foreground">{score}</span>)}
          </div>
          <div className="mx-auto mt-4 h-1.5 w-28 rounded-full bg-muted-foreground/20" />
        </div>
      </div>
    </div>
  );
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
    return <div className="mx-auto flex w-full max-w-[900px] flex-col gap-5 pb-24"><div className="h-8 w-64 animate-pulse rounded-lg bg-muted" /><div className="h-4 w-96 max-w-full animate-pulse rounded bg-muted/70" /><div className="h-64 animate-pulse rounded-xl border border-border/60 bg-muted/25" /></div>;
  }

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-5 pb-24">
      <header className="flex flex-col gap-4 border-b border-border/60 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Customer experience</p><Badge variant="outline" className="rounded-full px-2 py-0 text-[10px]">CSAT</Badge></div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Customer satisfaction</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">Choose when surveys are sent, then build the customer-facing email in one focused workspace.</p>
        </div>
        <Button asChild size="sm" className="gap-1.5 rounded-lg self-start sm:self-auto"><Link href="/settings/csat/email">Open email builder <ArrowRight className="size-3.5" /></Link></Button>
      </header>

      {error ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div> : null}

      <main className="flex min-w-0 flex-col gap-4">
        <Card className="rounded-xl border-border/70 bg-background shadow-sm">
          <CardHeader className="gap-1 border-b border-border/60 pb-4"><CardTitle className="text-base tracking-tight">Survey status</CardTitle><CardDescription className="text-sm">Control whether newly resolved conversations receive a CSAT request.</CardDescription></CardHeader>
          <CardContent className="p-5"><div className={cn("flex flex-col gap-4 rounded-lg border p-4 transition-colors duration-150 sm:flex-row sm:items-center sm:justify-between", settings.enabled ? "border-primary/25 bg-primary/[0.025]" : "border-border/70 bg-muted/20")}><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">Send CSAT surveys</h3><Badge variant={settings.enabled ? "secondary" : "outline"} className="rounded-full px-2 py-0 text-[10px]">{settings.enabled ? "Active" : "Paused"}</Badge></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{settings.enabled ? "One survey per ticket, sent after the final resolution." : "Surveys are paused. Your setup remains editable and ready to resume."}</p></div><Switch checked={settings.enabled} onCheckedChange={(value) => update("enabled", value)} aria-label="Send CSAT surveys" /></div></CardContent>
        </Card>

        <Card className="rounded-xl border-border/70 bg-background shadow-sm">
          <CardHeader className="gap-1 border-b border-border/60 pb-4"><SectionHeading eyebrow="Delivery" title="When should we ask?" description="Keep the request close to resolution while giving the customer a little breathing room." /></CardHeader>
          <CardContent className="flex flex-col gap-5 p-5"><div className="grid gap-2"><Label htmlFor="csat-delay">Send survey</Label><Select value={settings.delay} onValueChange={handleDelayChange}><SelectTrigger id="csat-delay" className="h-10 rounded-lg"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="immediately">Immediately after resolution</SelectItem><SelectItem value="1h">1 hour after resolution</SelectItem><SelectItem value="24h">24 hours after resolution</SelectItem><SelectItem value="custom">Custom delay</SelectItem></SelectContent></Select><p className="text-xs text-muted-foreground">Reopened conversations wait for their final resolution.</p></div>{settings.delay === "custom" ? <div className="grid gap-2 rounded-lg bg-muted/35 p-3"><Label htmlFor="csat-custom-delay">Custom delay</Label><div className="flex items-center gap-2"><Input id="csat-custom-delay" type="number" min="5" max="10080" step="1" inputMode="numeric" value={settings.delayMinutes ?? ""} onChange={(event) => update("delayMinutes", event.target.value === "" ? "" : Number(event.target.value))} className="h-10 w-32 rounded-lg" aria-invalid={Number.isNaN(Number(settings.delayMinutes)) || Number(settings.delayMinutes) < 5 || Number(settings.delayMinutes) > 10080} /><span className="text-sm text-muted-foreground">minutes after resolution</span></div><p className="text-xs leading-5 text-muted-foreground">Choose between 5 minutes and 7 days (10,080 minutes).</p></div> : null}<div className="grid gap-2"><Label htmlFor="csat-language">Email language</Label><Select value={settings.languageMode} onValueChange={(value) => update("languageMode", value)}><SelectTrigger id="csat-language" className="h-10 rounded-lg"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="conversation">Conversation language</SelectItem><SelectItem value="workspace">Workspace default</SelectItem><SelectItem value="en">Always English</SelectItem></SelectContent></Select><p className="text-xs leading-5 text-muted-foreground">System copy follows the selected language. Text in your template stays as written.</p></div><p className="rounded-lg bg-muted/35 px-3 py-3 text-xs leading-5 text-muted-foreground"><span className="font-medium text-foreground">Customer emails only.</span> Surveys are sent after automatic and teammate resolutions when the recipient is a real customer email.</p></CardContent>
        </Card>

        <Card className="rounded-xl border-border/70 bg-background shadow-sm">
          <CardHeader className="gap-1 border-b border-border/60 pb-4"><SectionHeading eyebrow="Email" title="Customer-facing email" description="Design the complete survey email in the builder. This is the only place where the email content is edited." /></CardHeader>
          <CardContent className="p-5"><EmailTemplateSummary template={emailTemplate} /><div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4"><p className="text-xs text-muted-foreground">Preview, test, save and publish from the builder.</p><Button asChild variant="outline" size="sm" className="gap-1.5 rounded-lg"><Link href="/settings/csat/email">Edit email <ArrowRight className="size-3.5" /></Link></Button></div></CardContent>
        </Card>

        <Card className="rounded-xl border-border/70 bg-background shadow-sm">
          <CardHeader className="gap-1 border-b border-border/60 pb-4"><SectionHeading eyebrow="Responses" title="Thank-you responses" description="Customize what customers see after they submit a rating." /></CardHeader>
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><MessageSquare className="size-4" /></div><div><p className="text-sm font-medium">Response pages for negative, neutral and positive ratings</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Keep these messages separate from the email customers receive.</p></div></div><Button asChild variant="outline" size="sm" className="gap-1.5 rounded-lg self-start sm:self-auto"><Link href="/settings/csat/thank-you">Edit responses <ArrowRight className="size-3.5" /></Link></Button></CardContent>
        </Card>
      </main>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4 text-xs text-muted-foreground"><span>Delivery changes apply to newly resolved tickets.</span><button type="button" onClick={reset} className="font-medium text-foreground underline-offset-4 hover:underline">Reset delivery settings</button></div>

      <StickySaveBar isVisible={!saved} isSaving={saving} onSave={save} onDiscard={discard} message="You have unsaved CSAT delivery changes" />
    </div>
  );
}
