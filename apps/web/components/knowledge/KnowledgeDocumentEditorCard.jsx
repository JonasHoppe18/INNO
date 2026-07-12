"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
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
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="overflow-hidden rounded-xl border bg-card">
          <Skeleton className="h-12 w-full rounded-none" />
          <div className="flex flex-col gap-3 p-8">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <section className="flex flex-col gap-5" aria-label={`${title} editor`}>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <Badge variant="secondary" className="w-fit font-normal">
            {currentStatus}
          </Badge>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={openTicketPreview} title={previewBlockedReason || "Run an A/B preview against a ticket"}>
              Test against ticket
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={openSimulation} title={previewBlockedReason || "Open simulation with this draft document preview"}>
              Simulate
            </Button>
            <Separator orientation="vertical" className="mx-1 hidden h-6 md:block" />
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
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">{helperText}</p>
          {error && <p className="text-xs text-destructive">{error}</p>}
          {previewError && <p className="text-xs text-amber-700">{previewError}</p>}
        </div>
        <KnowledgeDocsEditor
          value={value}
          onChange={(markdown) => {
            setValue(markdown);
            setPreviewError("");
          }}
        />
      </section>
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
