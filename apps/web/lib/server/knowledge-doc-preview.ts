export type PreviewDocumentContext = {
  requested: true;
  document_id: string;
  chunk_ids: string[];
  section_headings: string[];
  chunks: Array<{
    id: string;
    content: string;
    metadata: Record<string, unknown>;
    embedding?: number[];
  }>;
};

// pgvector columns come back from supabase-js as a JSON-ish string ("[...]")
// or, depending on driver, an array. Normalize to number[] (or undefined).
function parseEmbedding(value: unknown): number[] | undefined {
  if (Array.isArray(value)) {
    return value.every((v) => typeof v === "number") ? (value as number[]) : undefined;
  }
  if (typeof value === "string" && value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) && parsed.every((v) => typeof v === "number")
        ? parsed
        : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export async function loadPreviewDocumentContext(options: {
  serviceClient: any;
  shopId: string;
  documentId: string;
}): Promise<PreviewDocumentContext> {
  const documentId = String(options.documentId || "").trim();
  if (!documentId) {
    throw new Error("preview_document_id is required.");
  }

  const { data: doc, error: docError } = await options.serviceClient
    .from("knowledge_documents")
    .select("id")
    .eq("shop_id", options.shopId)
    .eq("id", documentId)
    .maybeSingle();
  if (docError) throw new Error(docError.message);
  if (!doc?.id) {
    throw new Error("Preview knowledge document not found.");
  }

  // Include the EXISTING stored embedding for the preview chunks only. These
  // travel server-side into the Edge Function request body for hybrid
  // (semantic) Product Support section selection; they are never echoed to the
  // browser by the preview API routes. No re-embedding, no agent_knowledge
  // mutation, scoping unchanged (shop_id + document_id + environment=preview).
  const { data: rows, error: chunkError } = await options.serviceClient
    .from("agent_knowledge")
    .select("id, content, metadata, embedding")
    .eq("shop_id", options.shopId)
    .eq("source_provider", "knowledge_document")
    .eq("metadata->>document_id", documentId)
    .eq("metadata->>environment", "preview");
  if (chunkError) throw new Error(chunkError.message);
  const sortedRows = [...(rows ?? [])].sort((a: any, b: any) => {
    const left = Number(a?.metadata?.section_order ?? 0);
    const right = Number(b?.metadata?.section_order ?? 0);
    return left - right;
  });
  const chunks = sortedRows.map((row: any) => ({
    id: String(row.id),
    content: String(row.content || ""),
    metadata: row.metadata && typeof row.metadata === "object"
      ? row.metadata
      : {},
    embedding: parseEmbedding(row.embedding),
  }));
  if (!chunks.length) {
    throw new Error("Preview knowledge document has no generated preview chunks. Save changes first.");
  }

  return {
    requested: true,
    document_id: documentId,
    chunk_ids: chunks.map((c) => c.id),
    section_headings: chunks.map((c) => String(c.metadata.section_heading || "")).filter(Boolean),
    chunks,
  };
}
