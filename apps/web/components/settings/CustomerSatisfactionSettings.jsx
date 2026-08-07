"use client";

/* eslint-disable @next/next/no-img-element -- uploaded logo previews use local blob URLs. */

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { StickySaveBar } from "@/components/ui/sticky-save-bar";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const DEFAULTS = {
  enabled: false,
  delay: "1h",
  subject: "How did we do?",
  headline: "How was your support experience?",
  intro: "We'd love to hear how we did. Your feedback helps us make every reply better.",
  thankYou: "Thanks for helping us improve.",
  company: "",
  senderName: "",
  footer: "You're receiving this because your support conversation was resolved.",
  accent: "#635bff",
  logoPosition: "top-center",
  languageMode: "conversation",
  logoUrl: "",
  logoName: "",
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

function RatingPreview({ settings, selected, onSelect }) {
  const [previewState, setPreviewState] = useState("rating");
  const { accent, company, senderName, headline, intro, thankYou, footer, logoUrl, logoPosition } = settings;
  const logo = logoUrl ? <img src={logoUrl} alt={`${company || "Company"} logo`} className={cn("h-10 max-w-32 object-contain", logoPosition === "top-left" ? "mr-auto" : "mx-auto")} /> : null;

  const chooseRating = (score) => {
    onSelect(score);
    setPreviewState("rating");
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border/70 bg-background">
      <div className="flex items-center gap-1.5 border-b border-border/60 px-4 py-3">
        <span className="size-2 rounded-full bg-rose-400/80" />
        <span className="size-2 rounded-full bg-amber-400/80" />
        <span className="size-2 rounded-full bg-emerald-400/80" />
        <span className="ml-2 truncate text-[11px] text-muted-foreground">Customer feedback · preview</span>
      </div>
      <div className="px-5 py-8 sm:px-7 sm:py-10">
        <div className="mx-auto max-w-[300px] text-center">
          {logoPosition !== "footer" ? logo : null}
          <p className="mt-5 text-xs font-medium text-muted-foreground">{company || "Your company"}</p>
          <p className="mt-1 text-[11px] text-muted-foreground/70">{senderName || company || "Your support team"}</p>
          {previewState === "thanks" ? (
            <div className="transition-opacity duration-150">
              <h3 className="mt-3 text-xl font-semibold tracking-tight">Thank you</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{thankYou}</p>
              <p className="mx-auto mt-6 w-fit rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">Response recorded</p>
            </div>
          ) : (
            <>
              <h3 className="mt-3 text-xl font-semibold tracking-tight">{headline || DEFAULTS.headline}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{intro || DEFAULTS.intro}</p>
              <div className="mt-7 flex justify-center gap-1.5" role="group" aria-label="Rate your support experience">
                {[1, 2, 3, 4, 5].map((score) => {
                  const active = selected === score;
                  return <button key={score} type="button" onClick={() => chooseRating(score)} aria-label={`${score} out of 5`} className={cn("flex size-10 items-center justify-center rounded-full border text-sm font-semibold transition-[transform,background-color,border-color,color] duration-150 active:scale-[0.97]", active ? "text-white shadow-sm" : "border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground")} style={active ? { backgroundColor: accent, borderColor: accent } : undefined}>{score}</button>;
                })}
              </div>
              <div className="mt-2 flex justify-between px-1 text-[10px] text-muted-foreground"><span>Very poor</span><span>Excellent</span></div>
              {selected ? <button type="button" onClick={() => setPreviewState("thanks")} className="mt-6 inline-flex h-9 items-center justify-center rounded-lg px-4 text-xs font-semibold text-white transition-transform duration-150 active:scale-[0.98]" style={{ backgroundColor: accent }}>Submit feedback</button> : null}
            </>
          )}
          {logoPosition === "footer" ? <div className="mt-7">{logo}</div> : null}
          <p className="mt-8 text-[10px] leading-4 text-muted-foreground/70">{footer || DEFAULTS.footer}</p>
        </div>
      </div>
    </div>
  );
}

export function CustomerSatisfactionSettings({ workspaceName = "" }) {
  const workspaceDefaults = useMemo(() => ({
    ...DEFAULTS,
    company: String(workspaceName || "").trim(),
    senderName: workspaceName ? `${String(workspaceName).trim()} Support` : "",
  }), [workspaceName]);
  const [settings, setSettings] = useState(workspaceDefaults);
  const [initialSettings, setInitialSettings] = useState(workspaceDefaults);
  const [selectedRating, setSelectedRating] = useState(null);
  const [saved, setSaved] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pendingLogoFile, setPendingLogoFile] = useState(null);
  const [logoToRemove, setLogoToRemove] = useState(false);
  const [error, setError] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const logoInputRef = useRef(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/settings/customer-satisfaction", { credentials: "include" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Could not load CSAT settings.");
        const loaded = { ...workspaceDefaults, ...(payload.settings || {}) };
        if (!active) return;
        setSettings(loaded);
        setInitialSettings(loaded);
        setPendingLogoFile(null);
        setLogoToRemove(false);
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

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      let nextSettings = settings;
      if (pendingLogoFile) {
        const formData = new FormData();
        formData.append("logo", pendingLogoFile);
        const logoResponse = await fetch("/api/settings/customer-satisfaction/logo", { method: "POST", body: formData, credentials: "include" });
        const logoPayload = await logoResponse.json().catch(() => ({}));
        if (!logoResponse.ok) throw new Error(logoPayload.error || "Could not upload the logo.");
        nextSettings = { ...nextSettings, ...(logoPayload.settings || {}) };
      }

      const response = await fetch("/api/settings/customer-satisfaction", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...nextSettings, removeLogo: logoToRemove && !pendingLogoFile }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not save CSAT settings.");
      const savedSettings = { ...workspaceDefaults, ...(payload.settings || nextSettings) };
      setSettings(savedSettings);
      setInitialSettings(savedSettings);
      setPendingLogoFile(null);
      setLogoToRemove(false);
      setSaved(true);
      toast.success("CSAT setup saved");
    } catch (saveError) {
      setError(saveError.message || "Could not save CSAT settings.");
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setSettings(workspaceDefaults);
    setSelectedRating(null);
    setPendingLogoFile(null);
    setLogoToRemove(Boolean(initialSettings.logoName || initialSettings.logoUrl));
    setSaved(false);
  };

  const discard = () => {
    setSettings(initialSettings);
    setSelectedRating(null);
    setPendingLogoFile(null);
    setLogoToRemove(false);
    setSaved(true);
  };

  const handleLogoChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setSaved(false);
    setPendingLogoFile(file);
    setLogoToRemove(false);
    setSettings((current) => ({ ...current, logoUrl: URL.createObjectURL(file), logoName: file.name }));
  };

  const removeLogo = () => {
    setSaved(false);
    setPendingLogoFile(null);
    setLogoToRemove(true);
    setSettings((current) => ({ ...current, logoUrl: "", logoName: "" }));
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
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">Ask one simple question after a conversation is resolved.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end"><span className="mr-1 text-xs text-muted-foreground">{saved ? "All changes saved" : "Unsaved changes"}</span><Button type="button" variant="outline" size="sm" onClick={() => setPreviewOpen(true)} className="rounded-lg">Preview email</Button></div>
      </header>

      {error ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div> : null}

      <main className="flex min-w-0 flex-col gap-4">
          <Card className="rounded-xl border-border/70 bg-background shadow-sm">
            <CardHeader className="gap-1 border-b border-border/60 pb-4"><CardTitle className="text-base tracking-tight">Survey status</CardTitle><CardDescription className="text-sm">Control whether newly resolved conversations receive a CSAT request.</CardDescription></CardHeader>
            <CardContent className="p-5"><div className={cn("flex flex-col gap-4 rounded-lg border p-4 transition-colors duration-150 sm:flex-row sm:items-center sm:justify-between", settings.enabled ? "border-primary/25 bg-primary/[0.025]" : "border-border/70 bg-muted/20")}><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">Send CSAT surveys</h3><Badge variant={settings.enabled ? "secondary" : "outline"} className="rounded-full px-2 py-0 text-[10px]">{settings.enabled ? "Active" : "Paused"}</Badge></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{settings.enabled ? "One survey per ticket, sent after the final resolution." : "Surveys are paused. Your setup remains editable and ready to resume."}</p></div><Switch checked={settings.enabled} onCheckedChange={(value) => update("enabled", value)} aria-label="Send CSAT surveys" /></div></CardContent>
          </Card>

          <Card className="rounded-xl border-border/70 bg-background shadow-sm">
            <CardHeader className="gap-1 border-b border-border/60 pb-4"><SectionHeading eyebrow="Delivery" title="When should we ask?" description="Keep the request close to resolution while giving the customer a little breathing room." /></CardHeader>
            <CardContent className="flex flex-col gap-5 p-5"><div className="grid gap-2"><Label htmlFor="csat-delay">Send survey</Label><Select value={settings.delay} onValueChange={(value) => update("delay", value)}><SelectTrigger id="csat-delay" className="h-10 rounded-lg"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="immediately">Immediately after resolution</SelectItem><SelectItem value="1h">1 hour after resolution</SelectItem><SelectItem value="24h">24 hours after resolution</SelectItem></SelectContent></Select><p className="text-xs text-muted-foreground">Reopened conversations wait for their final resolution.</p></div><div className="grid gap-2"><Label htmlFor="csat-language">Email language</Label><Select value={settings.languageMode} onValueChange={(value) => update("languageMode", value)}><SelectTrigger id="csat-language" className="h-10 rounded-lg"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="conversation">Conversation language</SelectItem><SelectItem value="workspace">Workspace default</SelectItem><SelectItem value="en">Always English</SelectItem></SelectContent></Select><p className="text-xs leading-5 text-muted-foreground">System copy follows the selected language. Custom text stays as written.</p></div><Separator /><div className="grid gap-2"><p className="rounded-lg bg-muted/35 px-3 py-3 text-xs leading-5 text-muted-foreground"><span className="font-medium text-foreground">All resolved conversations.</span> Surveys are sent after automatic and teammate resolutions, when the recipient is a customer email.</p><p className="rounded-lg bg-muted/35 px-3 py-3 text-xs leading-5 text-muted-foreground"><span className="font-medium text-foreground">Customer emails only.</span> Surveys never go to internal, no-reply or automated addresses.</p></div></CardContent>
          </Card>

          <Card className="rounded-xl border-border/70 bg-background shadow-sm">
            <CardHeader className="gap-1 border-b border-border/60 pb-4"><SectionHeading eyebrow="Message" title="Write the request" description="Keep the message short, human and recognizable as a normal support email." /></CardHeader>
            <CardContent className="flex flex-col gap-4 p-5"><div className="grid gap-2"><Label htmlFor="csat-subject">Subject</Label><Input id="csat-subject" value={settings.subject} onChange={(event) => update("subject", event.target.value)} className="h-10 rounded-lg" /></div><div className="grid gap-2"><Label htmlFor="csat-headline">Headline</Label><Input id="csat-headline" value={settings.headline} onChange={(event) => update("headline", event.target.value)} className="h-10 rounded-lg" /></div><div className="grid gap-2"><Label htmlFor="csat-intro">Intro</Label><Textarea id="csat-intro" value={settings.intro} onChange={(event) => update("intro", event.target.value)} className="min-h-24 resize-y rounded-lg leading-6" /></div><div className="grid gap-2"><Label htmlFor="csat-thank-you">Thank-you message</Label><Textarea id="csat-thank-you" value={settings.thankYou} onChange={(event) => update("thankYou", event.target.value)} className="min-h-20 resize-y rounded-lg leading-6" /></div><div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/35 px-3 py-2.5 text-xs text-muted-foreground"><span className="font-medium text-foreground">Available variables</span><code className="rounded bg-background px-1.5 py-0.5">&#123;&#123;customer_first_name&#125;&#125;</code><code className="rounded bg-background px-1.5 py-0.5">&#123;&#123;ticket_subject&#125;&#125;</code><code className="rounded bg-background px-1.5 py-0.5">&#123;&#123;team_name&#125;&#125;</code></div></CardContent>
          </Card>

          <Card className="rounded-xl border-border/70 bg-background shadow-sm">
            <CardHeader className="gap-1 border-b border-border/60 pb-4"><SectionHeading eyebrow="Branding" title="Make it feel like your brand" description="Add the identity customers recognize from your support emails." /></CardHeader>
            <CardContent className="grid gap-5 p-5 sm:grid-cols-[minmax(0,1fr)_180px]"><div className="flex flex-col gap-4"><div className="grid gap-2"><Label htmlFor="csat-company">Company name</Label><Input id="csat-company" value={settings.company} onChange={(event) => update("company", event.target.value)} className="h-10 rounded-lg" /></div><div className="grid gap-2"><Label htmlFor="csat-sender">Sender name</Label><Input id="csat-sender" value={settings.senderName} onChange={(event) => update("senderName", event.target.value)} className="h-10 rounded-lg" /></div><div className="grid gap-2"><Label htmlFor="csat-footer">Email footer</Label><Textarea id="csat-footer" value={settings.footer} onChange={(event) => update("footer", event.target.value)} className="min-h-20 resize-y rounded-lg leading-6" /></div></div><div className="flex flex-col gap-4"><div className="grid gap-2"><Label htmlFor="csat-logo">Logo</Label><button type="button" onClick={() => logoInputRef.current?.click()} className="flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/25 px-3 text-center transition-colors hover:border-primary/40 hover:bg-primary/[0.025]" aria-label={settings.logoName ? "Change logo" : "Add a logo"}><span className="max-w-full truncate text-xs font-medium">{settings.logoName || "Add a logo"}</span><span className="mt-1 text-[11px] text-muted-foreground">PNG, JPG or SVG</span></button><Input ref={logoInputRef} id="csat-logo" type="file" accept="image/png,image/jpeg,image/svg+xml" onChange={handleLogoChange} className="sr-only" />{settings.logoName ? <Button type="button" variant="ghost" size="sm" onClick={removeLogo} className="h-8 justify-start rounded-lg px-2 text-xs">Remove logo</Button> : null}</div><div className="grid gap-2"><Label htmlFor="csat-logo-position">Logo position</Label><Select value={settings.logoPosition} onValueChange={(value) => update("logoPosition", value)}><SelectTrigger id="csat-logo-position" className="h-10 rounded-lg"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="top-center">Top centered</SelectItem><SelectItem value="top-left">Top left</SelectItem><SelectItem value="footer">Footer</SelectItem></SelectContent></Select><p className="text-xs leading-5 text-muted-foreground">Choose where the logo appears in the email.</p></div><div className="grid gap-2"><Label htmlFor="csat-accent">Accent color</Label><div className="flex h-10 items-center gap-2 rounded-lg border border-input bg-background px-2"><input id="csat-accent" type="color" value={settings.accent} onChange={(event) => update("accent", event.target.value)} className="size-7 cursor-pointer rounded border-0 bg-transparent p-0" /><code className="text-xs text-muted-foreground">{settings.accent.toUpperCase()}</code></div></div></div></CardContent>
          </Card>
        </main>


      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4 text-xs text-muted-foreground"><span>Changes apply to newly resolved tickets.</span><button type="button" onClick={reset} className="font-medium text-foreground underline-offset-4 hover:underline">Reset to default</button></div>

      <StickySaveBar isVisible={!saved} isSaving={saving} onSave={save} onDiscard={discard} message="You have unsaved CSAT changes" />

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}><DialogContent className="max-w-[680px] p-0"><DialogHeader className="border-b border-border/60 px-6 py-5 pr-12"><DialogTitle>Email preview</DialogTitle><DialogDescription>See exactly what a customer will receive, including your branding.</DialogDescription></DialogHeader><div className="max-h-[75vh] overflow-y-auto bg-muted/25 p-4 sm:p-6"><RatingPreview settings={settings} selected={selectedRating} onSelect={setSelectedRating} /></div><div className="flex items-center justify-between gap-3 border-t border-border/60 px-6 py-4"><span className="text-xs text-muted-foreground">Click a rating to preview the response state.</span><Button type="button" size="sm" onClick={() => setPreviewOpen(false)} className="rounded-lg">Done</Button></div></DialogContent></Dialog>
    </div>
  );
}
