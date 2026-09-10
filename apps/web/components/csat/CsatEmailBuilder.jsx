"use client";

import "@templatical/editor/style.css";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Eye, Mail, Save, Send, Smartphone, Monitor, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CSAT_PALETTE_BLOCKS,
  CSAT_RATING_BLOCK_DEFINITION,
  CSAT_SAMPLE_DATA,
  CSAT_VARIABLES,
  createDefaultCsatEmailContent,
} from "@/lib/csat/email-template";

function StatusPill({ status, dirty }) {
  const label = dirty ? "Unsaved changes" : status === "published" ? "Published" : "Draft";
  const className = dirty
    ? "bg-amber-50 text-amber-700"
    : status === "published"
      ? "bg-emerald-50 text-emerald-700"
      : "bg-slate-100 text-slate-600";
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${className}`}>{label}</span>;
}

export function CsatEmailBuilder() {
  const containerRef = useRef(null);
  const editorRef = useRef(null);
  const contentRef = useRef(null);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editorReady, setEditorReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewViewport, setPreviewViewport] = useState("desktop");
  const [testOpen, setTestOpen] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [sendingTest, setSendingTest] = useState(false);

  const loadDraft = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/settings/csat/email", { cache: "no-store", credentials: "include" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Could not load CSAT email settings.");
      const nextDraft = payload?.draft || {
        name: "CSAT survey email",
        subject: "How was your support experience?",
        preview_text: "Your feedback helps us improve.",
        editor_json: createDefaultCsatEmailContent({ linkMode: "preview" }),
        status: "draft",
      };
      setDraft(nextDraft);
      contentRef.current = nextDraft.editor_json;
    } catch (error) {
      toast.error(error.message || "Could not load the CSAT email builder.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDraft();
  }, [loadDraft]);

  useEffect(() => {
    if (!draft || !containerRef.current || editorRef.current) return undefined;
    let cancelled = false;
    let initializing = true;
    (async () => {
      try {
        const { init } = await import("@templatical/editor");
        if (cancelled || !containerRef.current) return;
        const editor = await init({
          container: containerRef.current,
          content: draft.editor_json,
          branding: false,
          paletteBlocks: CSAT_PALETTE_BLOCKS,
          customBlocks: [CSAT_RATING_BLOCK_DEFINITION],
          mergeTags: {
            syntax: "handlebars",
            tags: CSAT_VARIABLES,
            autocomplete: true,
          },
          onChange(nextContent) {
            contentRef.current = nextContent;
            if (!initializing) setDirty(true);
          },
        });
        if (cancelled) {
          editor.unmount();
          return;
        }
        editorRef.current = editor;
        setEditorReady(true);
        initializing = false;
      } catch (error) {
        toast.error(error.message || "Could not load the email editor.");
      }
    })();
    return () => {
      cancelled = true;
      editorRef.current?.unmount?.();
      editorRef.current = null;
      setEditorReady(false);
    };
  }, [draft]);

  const persistDraft = useCallback(async () => {
    if (!draft || saving) return null;
    setSaving(true);
    try {
      const response = await fetch("/api/settings/csat/email", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: draft.name,
          subject: draft.subject,
          preview_text: draft.preview_text,
          editor_json: contentRef.current || draft.editor_json,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Could not save the CSAT draft.");
      setDraft(payload.draft);
      contentRef.current = payload.draft.editor_json;
      setDirty(false);
      toast.success("CSAT draft saved.");
      return payload.draft;
    } catch (error) {
      toast.error(error.message || "Could not save the CSAT draft.");
      return null;
    } finally {
      setSaving(false);
    }
  }, [draft, saving]);

  const handlePublish = useCallback(async () => {
    if (!draft || publishing) return;
    setPublishing(true);
    try {
      if (dirty || !draft.id) {
        const saved = await persistDraft();
        if (!saved) return;
      }
      const response = await fetch("/api/settings/csat/email/publish", {
        method: "POST",
        credentials: "include",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Could not publish the CSAT email.");
      setDraft(payload.draft);
      contentRef.current = payload.draft.editor_json;
      setDirty(false);
      toast.success(`CSAT email published as version ${payload.published.version}.`);
    } catch (error) {
      toast.error(error.message || "Could not publish the CSAT email.");
    } finally {
      setPublishing(false);
    }
  }, [dirty, draft, persistDraft, publishing]);

  const handlePreview = useCallback(async () => {
    if (!draft) return;
    setPreviewLoading(true);
    try {
      const response = await fetch("/api/settings/csat/email/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          subject: draft.subject,
          editor_json: contentRef.current || draft.editor_json,
          preview_data: CSAT_SAMPLE_DATA,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Could not render preview.");
      setPreviewHtml(payload.html || "");
      setPreviewOpen(true);
    } catch (error) {
      toast.error(error.message || "Could not render preview.");
    } finally {
      setPreviewLoading(false);
    }
  }, [draft]);

  const handleSendTest = useCallback(async () => {
    if (!draft || sendingTest) return;
    setSendingTest(true);
    try {
      const response = await fetch("/api/settings/csat/email/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          recipient: testEmail,
          subject: draft.subject,
          editor_json: contentRef.current || draft.editor_json,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Could not send test email.");
      toast.success(`Test email sent to ${testEmail}.`);
      setTestOpen(false);
    } catch (error) {
      toast.error(error.message || "Could not send test email.");
    } finally {
      setSendingTest(false);
    }
  }, [draft, sendingTest, testEmail]);

  if (loading) {
    return <div className="flex h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">Loading CSAT email builder…</div>;
  }

  return (
    <main className="flex h-[100svh] min-h-[680px] flex-col overflow-hidden bg-slate-50">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/settings?tab=email&section=auto-reply" className="rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900" aria-label="Back to email settings">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-semibold text-slate-900 sm:text-base">CSAT email</h1>
              <StatusPill status={draft?.status} dirty={dirty} />
            </div>
            <p className="hidden text-xs text-slate-500 sm:block">Build the published survey email customers receive after support.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Link href="/settings/csat/thank-you" className="hidden items-center gap-1.5 rounded-md px-2.5 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 sm:inline-flex">
            <Sparkles className="h-3.5 w-3.5" />
            Thank You responses
          </Link>
          <Button type="button" variant="outline" size="sm" onClick={handlePreview} disabled={previewLoading || !editorReady} className="gap-1.5">
            <Eye className="h-3.5 w-3.5" />
            {previewLoading ? "Rendering…" : "Preview"}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setTestOpen(true)} disabled={!editorReady} className="gap-1.5">
            <Send className="h-3.5 w-3.5" />
            Send test
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={persistDraft} disabled={saving || !dirty} className="gap-1.5">
            <Save className="h-3.5 w-3.5" />
            {saving ? "Saving…" : "Save draft"}
          </Button>
          <Button type="button" size="sm" onClick={handlePublish} disabled={publishing || saving || !editorReady} className="gap-1.5 bg-slate-900 hover:bg-slate-700">
            <Mail className="h-3.5 w-3.5" />
            {publishing ? "Publishing…" : "Publish"}
          </Button>
        </div>
      </header>

      <div ref={containerRef} className="min-h-0 flex-1" aria-label="CSAT email editor" />

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="flex h-[90vh] max-w-5xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="flex shrink-0 flex-row items-center justify-between border-b border-slate-200 px-5 py-4">
            <div>
              <DialogTitle>Email preview</DialogTitle>
              <DialogDescription>Rendered through the same MJML pipeline used for test and live sends.</DialogDescription>
            </div>
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
              <button type="button" onClick={() => setPreviewViewport("desktop")} className={`rounded-md p-2 ${previewViewport === "desktop" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`} aria-label="Desktop preview"><Monitor className="h-4 w-4" /></button>
              <button type="button" onClick={() => setPreviewViewport("mobile")} className={`rounded-md p-2 ${previewViewport === "mobile" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`} aria-label="Mobile preview"><Smartphone className="h-4 w-4" /></button>
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-5">
            <iframe
              title="CSAT email preview"
              srcDoc={previewHtml}
              className={`mx-auto h-full min-h-[620px] border-0 bg-white shadow-sm transition-all ${previewViewport === "mobile" ? "w-[375px] max-w-full" : "w-full"}`}
              sandbox="allow-same-origin"
            />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send a test email</DialogTitle>
            <DialogDescription>The five rating links are disabled in test sends and cannot create a CSAT response.</DialogDescription>
          </DialogHeader>
          <Input type="email" value={testEmail} onChange={(event) => setTestEmail(event.target.value)} placeholder="you@example.com" autoFocus />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTestOpen(false)}>Cancel</Button>
            <Button type="button" onClick={handleSendTest} disabled={sendingTest}>{sendingTest ? "Sending…" : "Send test"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
