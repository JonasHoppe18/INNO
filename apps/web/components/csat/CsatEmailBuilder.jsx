"use client";

import "@templatical/editor/style.css";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Eye, LayoutTemplate, Mail, Save, Send, Settings2, Smartphone, Monitor, Sparkles } from "lucide-react";
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
  CSAT_EMAIL_STARTER_TEMPLATES,
  countCsatRatingBlocks,
  createCsatEmailStarterTemplate,
  createDefaultCsatEmailContent,
} from "@/lib/csat/email-template";

function StatusPill({ status, dirty, saving }) {
  const label = saving ? "Saving…" : dirty ? "Unsaved changes" : status === "published" ? "Published" : "Draft";
  const className = saving
    ? "bg-violet-50 text-violet-700"
    : dirty
    ? "bg-amber-50 text-amber-700"
    : status === "published"
      ? "bg-emerald-50 text-emerald-700"
      : "bg-slate-100 text-slate-600";
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${className}`}>{label}</span>;
}

function createFallbackDraft() {
  return {
    id: null,
    name: "CSAT survey email",
    subject: "How was your support experience?",
    preview_text: "Your feedback helps us improve.",
    editor_json: createDefaultCsatEmailContent({ linkMode: "preview" }),
    status: "draft",
    version: 0,
    published_version: null,
  };
}

const SONA_EDITOR_THEME = {
  bg: "#ffffff",
  bgElevated: "#ffffff",
  bgHover: "#faf9ff",
  bgActive: "#f1efff",
  border: "#e7e7ef",
  borderLight: "#dcdcea",
  text: "#1b1b22",
  textMuted: "#6f6f7a",
  textDim: "#9b9ba8",
  primary: "#635bff",
  primaryHover: "#5548ee",
  primaryLight: "#f0eeff",
  secondary: "#5d5d69",
  secondaryHover: "#464653",
  secondaryLight: "#f2f2f6",
  canvasBg: "#f8f8fb",
  dark: {
    bg: "#ffffff",
    bgElevated: "#ffffff",
    bgHover: "#faf9ff",
    bgActive: "#f1efff",
    border: "#e7e7ef",
    borderLight: "#dcdcea",
    text: "#1b1b22",
    textMuted: "#6f6f7a",
    textDim: "#9b9ba8",
    primary: "#635bff",
    primaryHover: "#5548ee",
    primaryLight: "#f0eeff",
    secondary: "#5d5d69",
    secondaryHover: "#464653",
    secondaryLight: "#f2f2f6",
    canvasBg: "#f8f8fb",
  },
};

const SONA_EDITOR_STYLE = {
  "--tpl-user-font-family": "Inter, ui-sans-serif, system-ui, sans-serif",
  "--tpl-user-radius": "12px",
  "--tpl-user-radius-sm": "8px",
  "--tpl-user-radius-lg": "16px",
  "--tpl-user-shadow": "0 1px 2px rgba(15, 23, 42, 0.04)",
  "--tpl-user-shadow-sm": "0 1px 3px rgba(15, 23, 42, 0.06)",
  "--tpl-user-shadow-md": "0 8px 24px rgba(15, 23, 42, 0.08)",
};

export function CsatEmailBuilder() {
  const router = useRouter();
  const containerRef = useRef(null);
  const editorRef = useRef(null);
  const contentRef = useRef(null);
  const draftRef = useRef(null);
  const sectionDragRef = useRef(null);
  const loadStartedRef = useRef(false);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [editorError, setEditorError] = useState("");
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
  const [testEmailTouched, setTestEmailTouched] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [emailSettingsOpen, setEmailSettingsOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [pendingTemplateId, setPendingTemplateId] = useState(null);
  const [ratingBlockCount, setRatingBlockCount] = useState(1);
  const editorContent = draft?.editor_json;
  const isValidTestEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail.trim());

  const loadDraft = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/settings/csat/email", { cache: "no-store", credentials: "include" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Could not load CSAT email settings.");
      const nextDraft = payload?.draft || createFallbackDraft();
      setDraft(nextDraft);
      draftRef.current = nextDraft;
      contentRef.current = nextDraft.editor_json;
      setRatingBlockCount(countCsatRatingBlocks(nextDraft.editor_json));
    } catch (error) {
      const fallbackDraft = createFallbackDraft();
      setDraft(fallbackDraft);
      draftRef.current = fallbackDraft;
      contentRef.current = fallbackDraft.editor_json;
      setRatingBlockCount(countCsatRatingBlocks(fallbackDraft.editor_json));
      setLoadError("Saved email settings are unavailable, so the builder started with the default CSAT email. Saving requires the CSAT email database migration.");
      toast.error(error.message || "Could not load the CSAT email builder.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loadStartedRef.current) return undefined;
    loadStartedRef.current = true;
    loadDraft();
  }, [loadDraft]);

  useEffect(() => {
    if (!editorContent || !containerRef.current || editorRef.current) return undefined;
    let cancelled = false;
    let initializing = true;
    (async () => {
      try {
        setEditorError("");
        const { init } = await import("@templatical/editor");
        if (cancelled || !containerRef.current) return;
        const editor = await init({
          container: containerRef.current,
          content: editorContent,
          branding: false,
          smallScreenNotice: false,
          uiTheme: "light",
          theme: SONA_EDITOR_THEME,
          paletteBlocks: CSAT_PALETTE_BLOCKS,
          customBlocks: [CSAT_RATING_BLOCK_DEFINITION],
          mergeTags: {
            syntax: "handlebars",
            tags: CSAT_VARIABLES,
            autocomplete: true,
          },
          onChange(nextContent) {
            contentRef.current = nextContent;
            setRatingBlockCount(countCsatRatingBlocks(nextContent));
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
        setEditorError(error.message || "Could not load the email editor.");
        toast.error(error.message || "Could not load the email editor.");
      }
    })();
    return () => {
      cancelled = true;
      editorRef.current?.unmount?.();
      editorRef.current = null;
      setEditorReady(false);
    };
  }, [editorContent]);

  useEffect(() => {
    if (!editorReady || !containerRef.current) return undefined;

    const editorRoot = containerRef.current.shadowRoot || containerRef.current;
    const editorHost = editorRoot.querySelector?.(".tpl-editor-host, .tpl") || editorRoot;
    const canvasBlocks = editorRoot.querySelector?.(".tpl-canvas-blocks");
    if (!canvasBlocks) return undefined;
    if (window.matchMedia?.("(max-width: 767px)").matches) {
      const mobileViewportButton = Array.from(editorRoot.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "Mobile");
      mobileViewportButton?.click();
    }
    const dragStyle = document.createElement("style");
    dragStyle.dataset.sonaSectionDrag = "true";
    dragStyle.textContent = `
      .sona-section-dragging .tpl-canvas-blocks > .tpl-block-item > div > [data-block-type="section"] .tpl-block-content {
        pointer-events: none !important;
      }
      .sona-section-drag-source {
        opacity: 0.58 !important;
      }
      .sona-section-drop-indicator {
        position: fixed;
        z-index: 100;
        height: 0;
        border-top: 2px solid var(--tpl-primary, #635bff);
        border-radius: 999px;
        pointer-events: none;
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--tpl-primary, #635bff) 14%, transparent);
      }
    `;

    const responsiveStyle = document.createElement("style");
    responsiveStyle.dataset.sonaResponsiveEditor = "true";
    responsiveStyle.textContent = `
      @media (max-width: 767px) {
        .tpl-header-left,
        .tpl-header-right {
          display: none !important;
        }
        .tpl-body {
          left: 48px !important;
          right: 0 !important;
        }
        .tpl-main {
          min-width: 0 !important;
          padding: 16px 12px 300px !important;
          overflow-x: auto !important;
        }
        .tpl-right-sidebar {
          top: auto !important;
          left: 48px !important;
          right: 0 !important;
          bottom: 0 !important;
          width: auto !important;
          height: 280px !important;
        }
      }
    `;

    const dropIndicator = document.createElement("div");
    dropIndicator.className = "sona-section-drop-indicator";
    dropIndicator.setAttribute("aria-hidden", "true");
    dropIndicator.hidden = true;

    const getItems = () => Array.from(canvasBlocks.children).filter((item) => item.classList.contains("tpl-block-item"));

    const getTopLevelSection = (target) => {
      const handle = target?.closest?.(".tpl-block-btn");
      if (!handle) return null;
      const topLevelItem = handle.closest(".tpl-canvas-blocks > .tpl-block-item");
      const topLevelBlock = topLevelItem?.querySelector("[data-block-type]");
      const handleBlock = handle.closest("[data-block-type]");
      if (topLevelBlock?.dataset.blockType !== "section" || handleBlock !== topLevelBlock) return null;
      return { handle, item: topLevelItem, block: topLevelBlock };
    };

    const getDropIndex = (clientY, sourceItem) => {
      const otherItems = getItems().filter((item) => item !== sourceItem);
      const nextIndex = otherItems.findIndex((item) => {
        const rect = item.getBoundingClientRect();
        return clientY < rect.top + rect.height / 2;
      });
      return nextIndex === -1 ? otherItems.length : nextIndex;
    };

    const updateDropIndicator = (clientY, sourceItem) => {
      const items = getItems();
      const otherItems = items.filter((item) => item !== sourceItem);
      const dropIndex = getDropIndex(clientY, sourceItem);
      const targetItem = otherItems[dropIndex];
      const lastItem = otherItems[otherItems.length - 1];
      const targetRect = targetItem?.getBoundingClientRect();
      const lastRect = lastItem?.getBoundingClientRect();
      const canvasRect = canvasBlocks.getBoundingClientRect();
      const top = targetRect?.top ?? lastRect?.bottom ?? canvasRect.top;
      dropIndicator.style.left = `${Math.round(canvasRect.left)}px`;
      dropIndicator.style.top = `${Math.round(top - 1)}px`;
      dropIndicator.style.width = `${Math.round(canvasRect.width)}px`;
      dropIndicator.hidden = false;
      return dropIndex;
    };

    const cleanupSectionDrag = () => {
      const drag = sectionDragRef.current;
      if (!drag) return;
      try {
        if (drag.pointerId != null && drag.handle.hasPointerCapture?.(drag.pointerId)) {
          drag.handle.releasePointerCapture(drag.pointerId);
        }
      } catch {
        // Pointer capture may already have been released by the browser.
      }
      drag.item.classList.remove("sona-section-drag-source");
      editorHost.classList.remove("sona-section-dragging");
      dropIndicator.hidden = true;
      sectionDragRef.current = null;
    };

    const startSectionDrag = (event) => {
      if (sectionDragRef.current) return;
      const selected = getTopLevelSection(event.target);
      if (!selected) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      sectionDragRef.current = {
        handle: selected.handle,
        item: selected.item,
        blockId: selected.block.dataset.blockId,
        pointerId: event.pointerId ?? null,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        dropIndex: null,
      };
      if (event.pointerId != null) selected.handle.setPointerCapture?.(event.pointerId);
      editorHost.classList.add("sona-section-dragging");
    };

    const moveSectionDrag = (event) => {
      const drag = sectionDragRef.current;
      if (!drag || (drag.pointerId != null && event.pointerId != null && event.pointerId !== drag.pointerId)) return;
      const movedEnough = Math.abs(event.clientX - drag.startX) > 4 || Math.abs(event.clientY - drag.startY) > 4;
      if (!drag.active && !movedEnough) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      drag.active = true;
      drag.dropIndex = updateDropIndicator(event.clientY, drag.item);
    };

    const finishSectionDrag = (event) => {
      const drag = sectionDragRef.current;
      if (!drag || (drag.pointerId != null && event.pointerId != null && event.pointerId !== drag.pointerId)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();

      if (drag.active) {
        const nextIndex = getDropIndex(event.clientY, drag.item);
        const currentContent = contentRef.current;
        const blocks = Array.isArray(currentContent?.blocks) ? [...currentContent.blocks] : [];
        const sourceIndex = blocks.findIndex((block) => block.id === drag.blockId);
        if (sourceIndex !== -1 && nextIndex !== sourceIndex) {
          const [movedBlock] = blocks.splice(sourceIndex, 1);
          blocks.splice(nextIndex, 0, movedBlock);
          const nextContent = { ...currentContent, blocks };
          editorRef.current?.setContent?.(nextContent);
          contentRef.current = nextContent;
          setRatingBlockCount(countCsatRatingBlocks(nextContent));
          setDirty(true);
        }
      }
      cleanupSectionDrag();
    };

    const handlePointerDown = (event) => {
      startSectionDrag(event);
    };

    editorRoot.appendChild(dropIndicator);
    editorRoot.appendChild(dragStyle);
    editorRoot.appendChild(responsiveStyle);
    editorHost.addEventListener("pointerdown", handlePointerDown, true);
    editorHost.addEventListener("mousedown", handlePointerDown, true);
    window.addEventListener("pointermove", moveSectionDrag, true);
    window.addEventListener("pointerup", finishSectionDrag, true);
    window.addEventListener("pointercancel", finishSectionDrag, true);
    window.addEventListener("mousemove", moveSectionDrag, true);
    window.addEventListener("mouseup", finishSectionDrag, true);
    return () => {
      editorHost.removeEventListener("pointerdown", handlePointerDown, true);
      editorHost.removeEventListener("mousedown", handlePointerDown, true);
      window.removeEventListener("pointermove", moveSectionDrag, true);
      window.removeEventListener("pointerup", finishSectionDrag, true);
      window.removeEventListener("pointercancel", finishSectionDrag, true);
      window.removeEventListener("mousemove", moveSectionDrag, true);
      window.removeEventListener("mouseup", finishSectionDrag, true);
      cleanupSectionDrag();
      dropIndicator.remove();
      dragStyle.remove();
      responsiveStyle.remove();
    };
  }, [editorReady]);

  const persistDraft = useCallback(async ({ silent = false } = {}) => {
    if (!draft || saving) return null;
    const nextContent = contentRef.current || draft.editor_json;
    if (countCsatRatingBlocks(nextContent) !== 1) {
      if (!silent) toast.error("Keep exactly one CSAT Rating block in the email before saving.");
      return null;
    }
    const draftSnapshot = {
      name: draft.name,
      subject: draft.subject,
      preview_text: draft.preview_text,
    };
    if (!String(draftSnapshot.subject || "").trim()) {
      if (!silent) toast.error("Add a subject before saving the email.");
      return null;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/settings/csat/email", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: draftSnapshot.name,
          subject: draftSnapshot.subject,
          preview_text: draftSnapshot.preview_text,
          editor_json: nextContent,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Could not save the CSAT draft.");
      const currentDraft = draftRef.current;
      const stillCurrent = contentRef.current === nextContent
        && currentDraft?.name === draftSnapshot.name
        && currentDraft?.subject === draftSnapshot.subject
        && currentDraft?.preview_text === draftSnapshot.preview_text;
      if (stillCurrent) {
        setDraft((current) => ({ ...payload.draft, editor_json: current?.editor_json || payload.draft.editor_json }));
        draftRef.current = { ...payload.draft, editor_json: contentRef.current };
        contentRef.current = payload.draft.editor_json;
        setDirty(false);
      }
      if (!silent) toast.success("CSAT draft saved.");
      return payload.draft;
    } catch (error) {
      toast.error(error.message || "Could not save the CSAT draft.");
      return null;
    } finally {
      setSaving(false);
    }
  }, [draft, saving]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    if (!dirty || !editorReady || loadError || saving) return undefined;
    const timeout = setTimeout(() => {
      persistDraft({ silent: true });
    }, 1200);
    return () => clearTimeout(timeout);
  }, [dirty, editorReady, loadError, persistDraft, saving]);

  const applyStarterTemplate = useCallback((templateId) => {
    const nextContent = createCsatEmailStarterTemplate(templateId, { linkMode: "preview" });
    editorRef.current?.setContent?.(nextContent);
    contentRef.current = nextContent;
    setRatingBlockCount(countCsatRatingBlocks(nextContent));
    setDirty(true);
    setTemplatesOpen(false);
    toast.success("Starter template applied. You can customize it from here.");
  }, []);

  const handleStarterTemplate = useCallback((templateId) => {
    if (dirty) {
      setTemplatesOpen(false);
      setPendingTemplateId(templateId);
      return;
    }
    applyStarterTemplate(templateId);
  }, [applyStarterTemplate, dirty]);

  const ratingBlockIssue = ratingBlockCount === 1
    ? ""
    : ratingBlockCount === 0
      ? "Add one CSAT Rating block so customers can submit a score."
      : "Keep one CSAT Rating block in the email. Remove the extra rating blocks before publishing.";

  const handleBack = useCallback(async (event) => {
    if (!dirty) return;
    event.preventDefault();
    if (saving) {
      toast.info("The latest changes are still being saved.");
      return;
    }
    if (ratingBlockIssue) {
      toast.error("Fix the CSAT Rating block before leaving so your changes can be saved.");
      return;
    }
    const saved = await persistDraft();
    if (saved) router.push("/settings?tab=customer-satisfaction");
  }, [dirty, persistDraft, ratingBlockIssue, router, saving]);

  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

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
      setDraft((current) => ({ ...payload.draft, editor_json: current?.editor_json || payload.draft.editor_json }));
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
          preview_text: draft.preview_text,
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
    if (!isValidTestEmail) {
      setTestEmailTouched(true);
      return;
    }
    setSendingTest(true);
    try {
      const response = await fetch("/api/settings/csat/email/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          recipient: testEmail,
          subject: draft.subject,
          preview_text: draft.preview_text,
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
  }, [draft, isValidTestEmail, sendingTest, testEmail]);

  if (loading) {
    return <div className="flex h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">Loading CSAT email builder…</div>;
  }

  return (
    <main className="flex h-[100svh] min-h-[680px] flex-col overflow-hidden bg-[#f8f8fb]">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[#e7e7ef] bg-white px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/settings?tab=customer-satisfaction" onClick={handleBack} className="rounded-lg p-1.5 text-slate-500 transition-[background-color,color,transform] duration-150 ease-out hover:bg-violet-50 hover:text-violet-700 active:scale-[0.97]" aria-label="Back to customer satisfaction settings">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-semibold tracking-[-0.01em] text-slate-950 sm:text-base">CSAT email</h1>
              <StatusPill status={draft?.status} dirty={dirty} saving={saving} />
            </div>
            <p className="hidden text-xs text-slate-500 sm:block">Build the published survey email customers receive after support.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Link href="/settings/csat/thank-you" className="hidden items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-600 transition-[background-color,color,transform] duration-150 ease-out hover:bg-violet-50 hover:text-violet-700 active:scale-[0.98] sm:inline-flex">
            <Sparkles className="h-3.5 w-3.5" />
            Thank You responses
          </Link>
          <Button type="button" variant="outline" size="sm" onClick={() => setTemplatesOpen(true)} disabled={!editorReady} className="gap-1.5" aria-label="Templates">
            <LayoutTemplate className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Templates</span>
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setEmailSettingsOpen(true)} disabled={!draft} className="gap-1.5" aria-label="Email settings">
            <Settings2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Email settings</span>
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={handlePreview} disabled={previewLoading || !editorReady || Boolean(ratingBlockIssue)} className="gap-1.5">
            <Eye className="h-3.5 w-3.5" />
            {previewLoading ? "Rendering…" : "Preview"}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => { setTestEmailTouched(false); setTestOpen(true); }} disabled={!editorReady || Boolean(loadError) || Boolean(ratingBlockIssue)} className="gap-1.5">
            <Send className="h-3.5 w-3.5" />
            Send test
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={persistDraft} disabled={saving || !dirty || Boolean(loadError) || Boolean(ratingBlockIssue)} className="gap-1.5">
            <Save className="h-3.5 w-3.5" />
            {saving ? "Saving…" : "Save now"}
          </Button>
          <Button type="button" size="sm" onClick={handlePublish} disabled={publishing || saving || !editorReady || Boolean(loadError) || Boolean(ratingBlockIssue)} className="gap-1.5 bg-violet-600 shadow-sm shadow-violet-600/20 hover:bg-violet-700 active:scale-[0.98]">
            <Mail className="h-3.5 w-3.5" />
            {publishing ? "Publishing…" : "Publish"}
          </Button>
        </div>
      </header>

      {loadError ? (
        <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 sm:px-6">
          {loadError}
        </div>
      ) : null}

      {editorError ? (
        <div className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800 sm:px-6">
          The email editor could not start: {editorError}
        </div>
      ) : null}

      {ratingBlockIssue ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 sm:px-6">
          <AlertTriangle className="size-3.5 shrink-0" />
          <span>{ratingBlockIssue}</span>
        </div>
      ) : null}

      <div ref={containerRef} className="min-h-0 flex-1 bg-[#f8f8fb]" style={SONA_EDITOR_STYLE} aria-label="CSAT email editor" />

      <Dialog open={templatesOpen} onOpenChange={setTemplatesOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Start with a template</DialogTitle>
            <DialogDescription>Choose a starting point. It replaces the current canvas, and you can customize every block afterwards.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2 sm:grid-cols-2 lg:grid-cols-4">
            {CSAT_EMAIL_STARTER_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => handleStarterTemplate(template.id)}
                className="group rounded-xl border border-slate-200 bg-white p-3 text-left transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
              >
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="mx-auto h-2 w-16 rounded-full bg-slate-900/80" />
                  <div className="mx-auto mt-2 h-1.5 w-24 rounded-full bg-slate-400/50" />
                  {template.id === "blank" ? <div className="mt-4 flex justify-center"><span className="h-1.5 w-20 rounded-full bg-slate-200" /></div> : <div className="mt-4 flex justify-center gap-1">{[1, 2, 3, 4, 5].map((score) => <span key={score} className="size-4 rounded-full border border-slate-300 bg-white" />)}</div>}
                  <div className="mx-auto mt-4 h-1.5 w-20 rounded-full bg-slate-400/30" />
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-900">{template.name}</span>
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: template.accent }} />
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-500">{template.description}</p>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTemplatesOpen(false)}>Keep current email</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(pendingTemplateId)} onOpenChange={(open) => { if (!open) setPendingTemplateId(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Replace the current email?</DialogTitle>
            <DialogDescription>This will replace the blocks currently on the canvas. Your current unsaved changes will be discarded.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingTemplateId(null)}>Keep current email</Button>
            <Button
              type="button"
              onClick={() => {
                const templateId = pendingTemplateId;
                setPendingTemplateId(null);
                if (templateId) applyStarterTemplate(templateId);
              }}
            >
              Replace email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={emailSettingsOpen} onOpenChange={setEmailSettingsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Email settings</DialogTitle>
            <DialogDescription>Set the inbox details that sit behind the design on the canvas.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-5 py-2">
            <label className="grid gap-2 text-sm font-medium text-slate-700">
              Subject
              <Input
                value={draft?.subject || ""}
                onChange={(event) => {
                  setDraft((current) => ({ ...current, subject: event.target.value }));
                  setDirty(true);
                }}
                maxLength={300}
                placeholder="How was your support experience?"
                required
                aria-invalid={!String(draft?.subject || "").trim()}
              />
              <span className={`text-xs font-normal leading-5 ${String(draft?.subject || "").trim() ? "text-slate-500" : "text-amber-700"}`}>{String(draft?.subject || "").trim() ? "This is the subject customers see in their inbox." : "Add a subject before saving or publishing."}</span>
            </label>
            <label className="grid gap-2 text-sm font-medium text-slate-700">
              Preview text
              <Input
                value={draft?.preview_text || ""}
                onChange={(event) => {
                  setDraft((current) => ({ ...current, preview_text: event.target.value }));
                  setDirty(true);
                }}
                maxLength={300}
                placeholder="Your feedback helps us improve."
              />
              <span className="text-xs font-normal leading-5 text-slate-500">Optional text shown beside the subject in some inboxes.</span>
            </label>
          </div>
        </DialogContent>
      </Dialog>

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
          <label className="grid gap-2 text-sm font-medium text-slate-700">
            Send to
            <Input
              type="email"
              value={testEmail}
              onChange={(event) => setTestEmail(event.target.value)}
              onBlur={() => setTestEmailTouched(true)}
              placeholder="you@example.com"
              autoFocus
              required
              aria-invalid={testEmailTouched && !isValidTestEmail}
            />
            {testEmailTouched && !isValidTestEmail ? <span className="text-xs font-normal text-red-600">Enter a valid email address.</span> : <span className="text-xs font-normal text-slate-500">We’ll send the current draft to this address.</span>}
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTestOpen(false)}>Cancel</Button>
            <Button type="button" onClick={handleSendTest} disabled={sendingTest || !isValidTestEmail}>{sendingTest ? "Sending…" : "Send test"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
