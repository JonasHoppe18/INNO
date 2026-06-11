"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  buildKnowledgeDocumentSimulationHref,
  getKnowledgeDocumentPreviewBlockedReason,
} from "@/lib/knowledge/knowledge-doc-preview-actions";
import { SnippetPreviewModal } from "./SnippetPreviewModal";
import { KnowledgeDocsEditor } from "./KnowledgeDocsEditor";

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
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="px-6 py-5 border-b space-y-2">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="px-6 py-5 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-xl border bg-card overflow-hidden">
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
              <Button type="button" variant="outline" size="sm" onClick={openTicketPreview} title={previewBlockedReason || "Run an A/B preview against a ticket"}>
                Test against ticket
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={openSimulation} title={previewBlockedReason || "Open simulation with this draft document preview"}>
                Simulate conversation
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {allowPublish && (
                <Button type="button" variant="outline" size="sm" onClick={publishDraft} disabled={publishing || isDirty || !document?.id}>
                  {publishing ? "Publishing..." : "Publish"}
                </Button>
              )}
              <Button type="button" size="sm" onClick={saveDraft} disabled={saving || !isDirty}>
                {saving ? "Saving..." : "Save changes"}
              </Button>
            </div>
          </div>
        </div>
        <div className="px-6 py-5">
          <p className="mb-3 text-xs text-muted-foreground">
            {helperText}
          </p>
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
          <KnowledgeDocsEditor
            value={value}
            onChange={(markdown) => {
              setValue(markdown);
              setPreviewError("");
            }}
          />
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
