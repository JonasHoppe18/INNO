"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const GROUPS = [
  { key: "negative", label: "Negative", scores: "1–2", accent: "border-rose-200 bg-rose-50/50" },
  { key: "neutral", label: "Neutral", scores: "3", accent: "border-amber-200 bg-amber-50/50" },
  { key: "positive", label: "Positive", scores: "4–5", accent: "border-emerald-200 bg-emerald-50/50" },
];

export function CsatThankYouSettings() {
  const [messages, setMessages] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings/csat/thank-you", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || "Could not load Thank You responses.");
        setMessages(payload.messages);
      })
      .catch((error) => toast.error(error.message))
      .finally(() => setLoading(false));
  }, []);

  const updateGroup = useCallback((group, field, value) => {
    setMessages((current) => ({
      ...(current || {}),
      [group]: { ...(current?.[group] || {}), [field]: value },
    }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!messages || saving) return;
    setSaving(true);
    try {
      const response = await fetch("/api/settings/csat/thank-you", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ messages }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Could not save Thank You responses.");
      setMessages(payload.messages);
      toast.success("Thank You responses saved.");
    } catch (error) {
      toast.error(error.message || "Could not save Thank You responses.");
    } finally {
      setSaving(false);
    }
  }, [messages, saving]);

  if (loading || !messages) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">Loading Thank You responses…</main>;
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Link href="/settings/csat/email" className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900"><ArrowLeft className="h-3.5 w-3.5" /> Back to CSAT email</Link>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Thank You responses</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">Customize the branded page shown after a customer submits a rating. Scores are grouped so adding individual score copy later will not change this data model.</p>
          </div>
          <Button type="button" onClick={handleSave} disabled={saving} className="shrink-0 gap-1.5 bg-slate-900 hover:bg-slate-700"><Save className="h-3.5 w-3.5" />{saving ? "Saving…" : "Save"}</Button>
        </div>

        <div className="mt-8 space-y-4">
          {GROUPS.map((group) => {
            const message = messages[group.key] || {};
            return (
              <section key={group.key} className={`rounded-2xl border p-5 sm:p-6 ${group.accent}`}>
                <div className="mb-5 flex items-center justify-between gap-4">
                  <div><h2 className="text-base font-semibold text-slate-900">{group.label}</h2><p className="mt-0.5 text-xs text-slate-500">Scores {group.scores}</p></div>
                  <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-medium text-slate-500">Thank You page</span>
                </div>
                <div className="grid gap-4">
                  <label className="grid gap-1.5 text-sm font-medium text-slate-700">Heading<Input value={message.heading || ""} onChange={(event) => updateGroup(group.key, "heading", event.target.value)} maxLength={180} /></label>
                  <label className="grid gap-1.5 text-sm font-medium text-slate-700">Body text<Textarea value={message.body || ""} onChange={(event) => updateGroup(group.key, "body", event.target.value)} maxLength={2000} rows={4} /></label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="grid gap-1.5 text-sm font-medium text-slate-700">Optional button text<Input value={message.button_text || ""} onChange={(event) => updateGroup(group.key, "button_text", event.target.value)} maxLength={120} placeholder="Back to store" /></label>
                    <label className="grid gap-1.5 text-sm font-medium text-slate-700">Optional button URL<Input value={message.button_url || ""} onChange={(event) => updateGroup(group.key, "button_url", event.target.value)} maxLength={4000} placeholder="https://your-store.com" /></label>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}
