import type { PreviewDocumentContext } from "./knowledge-doc-preview";

type DraftRunLike = {
  sources?: Array<{ source_label?: string | null }>;
  preview_document_context?: {
    injected?: boolean;
    preview_chunk_ids?: string[];
    reason?: string;
  } | null;
};

export function buildKnowledgeDocumentPreviewRunBodies(options: {
  shopId: string;
  emailData: Record<string, unknown>;
  previewDocumentContext: PreviewDocumentContext | null;
  snippetExcludeChunkIds: string[];
}) {
  const base = {
    shop_id: options.shopId,
    email_data: options.emailData,
  };
  if (options.previewDocumentContext) {
    const previewChunkIds = options.previewDocumentContext.chunk_ids ?? [];
    return {
      withPreview: {
        ...base,
        preview_document_context: options.previewDocumentContext,
      },
      withoutPreview: {
        ...base,
        exclude_chunk_ids: previewChunkIds,
      },
      excludedChunkIds: previewChunkIds,
    };
  }

  return {
    withPreview: base,
    withoutPreview: {
      ...base,
      exclude_chunk_ids: options.snippetExcludeChunkIds,
    },
    excludedChunkIds: options.snippetExcludeChunkIds,
  };
}

export function wasPreviewDocumentInjected(run: DraftRunLike): boolean {
  const ctx = run.preview_document_context;
  if (ctx?.injected !== true) return false;
  // Sections were injected.
  if (Array.isArray(ctx.preview_chunk_ids) && ctx.preview_chunk_ids.length > 0) {
    return true;
  }
  // Product Support low-confidence: no section matched, but the preview WAS
  // used — it directed the writer to ask a clarification question.
  return ctx.reason === "product_support_low_confidence";
}

// Distinguishes the "no section matched → asked a clarification question"
// outcome from a normal section injection, so the UI can explain it correctly
// instead of claiming the preview was unused.
export function wasPreviewDocumentClarification(run: DraftRunLike): boolean {
  return run.preview_document_context?.reason === "product_support_low_confidence";
}

export function wasLegacySnippetRetrieved(options: {
  run: DraftRunLike;
  snippetTitle: string;
}): boolean {
  const title = String(options.snippetTitle || "").trim().toLowerCase();
  if (!title) return false;
  return (options.run.sources ?? []).some((source) =>
    String(source.source_label || "").toLowerCase().includes(title)
  );
}
