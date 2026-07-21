"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  buildKnowledgeDocumentSimulationHref,
  getKnowledgeDocumentPreviewBlockedReason,
} from "@/lib/knowledge/knowledge-doc-preview-actions";
import {
  getActiveSectionId,
  parseKnowledgeDocumentOutline,
} from "@/lib/knowledge/knowledge-doc-outline";
import { useKnowledgeDocsEditor } from "@/lib/knowledge/use-knowledge-docs-editor";
import { SnippetPreviewModal } from "./SnippetPreviewModal";
import { KnowledgeDocumentOutline } from "./KnowledgeDocumentOutline";
import { KnowledgeDocsToolbar } from "./KnowledgeDocsToolbar";
import { KnowledgeDocsCanvas } from "./KnowledgeDocsCanvas";

const EDITOR_SCROLL_HEIGHT_CLASS = "max-h-[75vh] min-h-[420px]";
const SECTION_HIGHLIGHT_CLASS = "animate-knowledge-doc-section-flash";
const SECTION_HIGHLIGHT_DURATION_MS = 900;

function statusLabel({ isDirty, document }) {
  if (isDirty) return "Unsaved changes";
  if (document?.has_unpublished_changes) return "Unpublished changes";
  if (document?.published_at) return "Published";
  return "Saved";
}

export function KnowledgeDocumentEditorCard({
  shopId,
  onShopId,
  category,
  documentType,
  title,
  description,
  helperText = "Use section headings to organise the guide. Each section heading becomes a focused knowledge section for the AI.",
  allowPublish = true,
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [document, setDocument] = useState(null);
  const [value, setValue] = useState("");
  const [savedValue, setSavedValue] = useState("");
  const [error, setError] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [activeSectionId, setActiveSectionId] = useState(null);

  const scrollRootRef = useRef(null);
  const sectionsRef = useRef([]);
  const stickyHeaderRef = useRef(null);
  // 112px is just a reasonable initial guess before the first ResizeObserver
  // measurement lands — the real value is measured live below so the scroll-spy
  // offset and the H2 scroll-margin (applied via the --knowledge-doc-header-height
  // CSS var in KnowledgeDocsCanvas) can never desync from the actual rendered
  // height of the sticky header+toolbar stack.
  const [headerHeight, setHeaderHeight] = useState(112);

  const loadDocument = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/knowledge/documents?category=${encodeURIComponent(category)}&document_type=${encodeURIComponent(documentType)}${shopId ? `&shop_id=${encodeURIComponent(shopId)}` : ""}`,
        { credentials: "include" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not load document.");
      setDocument(data.document);
      setValue(data.document?.draft_markdown || "");
      setSavedValue(data.document?.draft_markdown || "");
      if (data?.shop_id) onShopId?.(data.shop_id);
    } catch (err) {
      setError(err.message || "Could not load document.");
    } finally {
      setLoading(false);
    }
  }, [shopId, onShopId, category, documentType]);

  useEffect(() => {
    loadDocument();
  }, [loadDocument]);

  const { editor } = useKnowledgeDocsEditor({
    value,
    onChange: (markdown) => {
      setValue(markdown);
      setPreviewError("");
    },
  });

  const sections = useMemo(() => parseKnowledgeDocumentOutline(value), [value]);

  useEffect(() => {
    sectionsRef.current = sections;
    setActiveSectionId((current) => {
      if (current && sections.some((section) => section.id === current)) return current;
      return sections[0]?.id || null;
    });
  }, [sections]);

  useEffect(() => {
    const stickyHeader = stickyHeaderRef.current;
    if (!stickyHeader) return undefined;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setHeaderHeight(entry.contentRect.height);
    });
    observer.observe(stickyHeader);
    return () => observer.disconnect();
    // Re-run once `loading` flips to false: stickyHeaderRef only exists in the
    // non-loading JSX branch, so the mount-time run (while loading=true) always
    // bails with stickyHeader=null. Depending on `loading` ensures this effect
    // attaches the observer once the real element mounts.
  }, [loading]);

  useEffect(() => {
    const container = scrollRootRef.current;
    if (!container) return undefined;

    const handleScroll = () => {
      const currentSections = sectionsRef.current;
      if (!currentSections.length) {
        setActiveSectionId(null);
        return;
      }
      const containerTop = container.getBoundingClientRect().top;
      const sectionTops = currentSections
        .map((section) => {
          const el = window.document.getElementById(section.id);
          if (!el) return null;
          return {
            id: section.id,
            top: el.getBoundingClientRect().top - containerTop + container.scrollTop,
          };
        })
        .filter(Boolean);
      const nextActive = getActiveSectionId({
        sectionTops,
        scrollTop: container.scrollTop,
        offset: headerHeight,
      });
      setActiveSectionId(nextActive);
    };

    handleScroll();
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
    // Re-run once `loading` flips to false: the scroll container (scrollRootRef)
    // only exists in the non-loading JSX branch, so the mount-time run (while
    // loading=true) always bails with container=null. Depending on `loading`
    // ensures this effect re-attaches the listener once the real container mounts.
    // Also re-run when `headerHeight` changes so the spy offset used inside the
    // (memoized) handleScroll closure never goes stale relative to the live
    // measurement.
  }, [loading, headerHeight]);

  const scrollToSection = useCallback((sectionId) => {
    const container = scrollRootRef.current;
    const target = window.document.getElementById(sectionId);
    if (!container || !target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    target.classList.add(SECTION_HIGHLIGHT_CLASS);
    window.setTimeout(() => {
      target.classList.remove(SECTION_HIGHLIGHT_CLASS);
    }, SECTION_HIGHLIGHT_DURATION_MS);
    setActiveSectionId(sectionId);
  }, []);

  const isDirty = value !== savedValue;
  const previewBlockedReason = getKnowledgeDocumentPreviewBlockedReason({
    documentId: document?.id,
    isDirty,
  });
  const canPreview = !previewBlockedReason;
  const currentStatus = statusLabel({ isDirty, document });

  const saveDraft = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/knowledge/documents", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(shopId ? { shop_id: shopId } : {}),
          category,
          document_type: documentType,
          title,
          draft_markdown: value,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not save document.");
      setDocument(data.document);
      setSavedValue(data.document?.draft_markdown || value);
      setPreviewError("");
      toast.success("Knowledge document saved");
    } catch (err) {
      setError(err.message || "Could not save document.");
      toast.error(err.message || "Could not save document.");
    } finally {
      setSaving(false);
    }
  };

  const publishDraft = async () => {
    setPublishing(true);
    setError("");
    try {
      const res = await fetch("/api/knowledge/documents", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(shopId ? { shop_id: shopId } : {}),
          action: "publish",
          category,
          document_type: documentType,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not publish document.");
      setDocument(data.document);
      setSavedValue(data.document?.draft_markdown || value);
      setValue(data.document?.draft_markdown || value);
      toast.success("Knowledge document published");
    } catch (err) {
      setError(err.message || "Could not publish document.");
      toast.error(err.message || "Could not publish document.");
    } finally {
      setPublishing(false);
    }
  };

  const openTicketPreview = () => {
    if (!canPreview) {
      setPreviewError(previewBlockedReason);
      toast.error(previewBlockedReason);
      return;
    }
    setPreviewError("");
    setPreviewOpen(true);
  };

  const openSimulation = () => {
    if (!canPreview) {
      setPreviewError(previewBlockedReason);
      toast.error(previewBlockedReason);
      return;
    }
    setPreviewError("");
    router.push(buildKnowledgeDocumentSimulationHref(document.id));
  };

  if (loading) {
    return (
      <div className="flex gap-6">
        <div className="hidden w-60 shrink-0 md:block">
          <KnowledgeDocumentOutline
            loading
            sections={[]}
            activeSectionId={null}
            onSelectSection={() => {}}
          />
        </div>
        <div className="min-w-0 flex-1 overflow-hidden rounded-xl border bg-card">
          <div className="space-y-2 border-b px-6 py-5">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-4 w-72" />
          </div>
          <div className="space-y-2 px-6 py-5">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex gap-6">
        <div className="hidden w-60 shrink-0 md:block">
          <KnowledgeDocumentOutline
            sections={sections}
            activeSectionId={activeSectionId}
            onSelectSection={scrollToSection}
          />
        </div>
        <div className="min-w-0 flex-1 overflow-hidden rounded-xl border bg-card">
          <div
            ref={scrollRootRef}
            className={cn("overflow-y-auto", EDITOR_SCROLL_HEIGHT_CLASS)}
            style={{ "--knowledge-doc-header-height": `${headerHeight}px` }}
          >
            <div ref={stickyHeaderRef} className="sticky top-0 z-20 bg-card">
              <div className="flex flex-col gap-4 border-b px-6 py-5 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold">{title}</h2>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                      {currentStatus}
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-3">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={openTicketPreview}
                      title={previewBlockedReason || "Run an A/B preview against a ticket"}
                    >
                      Test against ticket
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={openSimulation}
                      title={previewBlockedReason || "Open simulation with this draft document preview"}
                    >
                      Simulate conversation
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {allowPublish && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={publishDraft}
                        disabled={publishing || isDirty || !document?.id}
                      >
                        {publishing ? "Publishing..." : "Publish"}
                      </Button>
                    )}
                    <Button type="button" size="sm" onClick={saveDraft} disabled={saving || !isDirty}>
                      {saving ? "Saving..." : "Save changes"}
                    </Button>
                  </div>
                </div>
              </div>
              <KnowledgeDocsToolbar editor={editor} />
            </div>
            <div className="px-6 py-5">
              <p className="mb-3 text-xs text-muted-foreground">{helperText}</p>
              {error && (
                <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                  {error}
                </div>
              )}
              {previewError && (
                <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                  {previewError}
                </div>
              )}
              <KnowledgeDocsCanvas editor={editor} />
            </div>
          </div>
        </div>
      </div>
      {document?.id && (
        <SnippetPreviewModal
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          previewDocumentId={document.id}
          previewTitle={title}
        />
      )}
    </>
  );
}
