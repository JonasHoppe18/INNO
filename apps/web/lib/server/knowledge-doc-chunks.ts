import type { KnowledgeDocumentSection } from "./knowledge-doc-parser";

export type KnowledgeDocumentChunkEnvironment = "preview" | "production";

export type KnowledgeDocumentChunkPayload = {
  shop_id: string;
  content: string;
  source_type: "document";
  source_provider: "knowledge_document";
  metadata: Record<string, unknown>;
};

export type BuildKnowledgeDocumentChunkOptions = {
  shopId: string;
  documentId: string;
  documentType: string;
  category: string;
  title: string;
  sections: KnowledgeDocumentSection[];
  environment: KnowledgeDocumentChunkEnvironment;
  productScope?: string;
};

export function buildKnowledgeDocumentChunks(
  options: BuildKnowledgeDocumentChunkOptions,
): KnowledgeDocumentChunkPayload[] {
  const sectionCount = options.sections.length;
  return options.sections.map((section, index) => ({
    shop_id: options.shopId,
    content: [
      options.title.trim() ? `# ${options.title.trim()}` : "",
      `## ${section.heading}`,
      section.content,
    ].filter(Boolean).join("\n\n").trim(),
    source_type: "document",
    source_provider: "knowledge_document",
    metadata: {
      document_id: options.documentId,
      document_type: options.documentType,
      curated_document: true,
      chunking_mode: "section_level",
      retrieval_mode: "authoritative_context_only",
      category: options.category,
      ...(options.productScope ? { product_scope: options.productScope } : {}),
      usable_as: "policy",
      audience: "internal",
      environment: options.environment,
      // Publishing a document means "make this live for the AI". Production
      // chunks are therefore active immediately; re-publishing must never
      // silently drop the document out of retrieval. Preview chunks are
      // editing-only copies and stay inactive.
      active_for_ai: options.environment === "production",
      section_key: section.section_key,
      section_heading: section.heading,
      section_order: section.order,
      normalized_heading: section.normalized_heading,
      ...(Object.keys(section.metadata).length ? section.metadata : {}),
      warnings: [...section.warnings],
      chunk_index: index,
      chunk_count: sectionCount,
    },
  }));
}
