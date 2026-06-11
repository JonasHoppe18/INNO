export type KnowledgeDocPreviewSection = {
  chunk_id: string;
  section_key?: string;
  section_heading: string;
  content: string;
};

export type KnowledgeDocPreviewContextInput = {
  requested?: boolean;
  document_id: string;
  chunk_ids?: string[];
  section_headings?: string[];
  sections?: KnowledgeDocPreviewSection[];
  chunks?: Array<{
    id: string;
    content: string;
    metadata?: Record<string, unknown> | null;
  }>;
} | null | undefined;

export type KnowledgeDocPreviewContextResult = {
  blockText: string | null;
  diagnostics: {
    requested: true;
    document_id: string;
    preview_chunk_ids: string[];
    section_headings: string[];
    active_only_for_test: true;
    injected: boolean;
    reason: string;
  } | null;
  sources: Array<{
    content: string;
    kind: string;
    source_label: string;
    usable_as?: string;
    risk_flags?: string[];
  }>;
};

function normalizeSections(
  context: KnowledgeDocPreviewContextInput,
): KnowledgeDocPreviewSection[] {
  if (!context) return [];
  if (Array.isArray(context.sections)) {
    return context.sections
      .map((section) => ({
        chunk_id: String(section.chunk_id || "").trim(),
        section_key: String(section.section_key || "").trim() || undefined,
        section_heading: String(section.section_heading || "").trim(),
        content: String(section.content || "").trim(),
      }))
      .filter((section) => section.chunk_id && section.content);
  }

  if (Array.isArray(context.chunks)) {
    return context.chunks
      .map((chunk) => {
        const metadata = chunk.metadata ?? {};
        return {
          chunk_id: String(chunk.id || "").trim(),
          section_key: String(metadata.section_key || "").trim() || undefined,
          section_heading: String(metadata.section_heading || "").trim(),
          content: String(chunk.content || "").trim(),
        };
      })
      .filter((section) => section.chunk_id && section.content);
  }

  return [];
}

export function buildKnowledgeDocPreviewContext(
  context: KnowledgeDocPreviewContextInput,
): KnowledgeDocPreviewContextResult {
  if (!context) {
    return { blockText: null, diagnostics: null, sources: [] };
  }

  const documentId = String(context.document_id || "").trim();
  const sections = normalizeSections(context);
  const chunkIds = sections.map((section) => section.chunk_id);
  const headings = sections
    .map((section) => section.section_heading)
    .filter(Boolean);

  if (!documentId || sections.length === 0) {
    return {
      blockText: null,
      diagnostics: {
        requested: true,
        document_id: documentId,
        preview_chunk_ids: chunkIds,
        section_headings: headings,
        active_only_for_test: true,
        injected: false,
        reason: documentId ? "no_preview_sections" : "missing_document_id",
      },
      sources: [],
    };
  }

  const renderedSections = sections
    .map((section, index) => {
      const heading = section.section_heading || `Section ${index + 1}`;
      return `## ${heading}\n${section.content}`;
    })
    .join("\n\n");

  const blockText = [
    "# AUTHORITATIVE PREVIEW KNOWLEDGE DOCUMENT",
    "This block applies only to this explicit test or simulation run.",
    "Use these draft document sections as the source of truth for matching policy facts in this preview.",
    "Do not treat this preview block as production runtime activation.",
    "",
    renderedSections,
  ].join("\n");

  return {
    blockText,
    diagnostics: {
      requested: true,
      document_id: documentId,
      preview_chunk_ids: chunkIds,
      section_headings: headings,
      active_only_for_test: true,
      injected: true,
      reason: "injected",
    },
    sources: sections.map((section) => ({
      content: section.content.slice(0, 200),
      kind: "knowledge_document_preview",
      source_label: section.section_heading
        ? `Draft document: ${section.section_heading}`
        : "Draft document preview",
      usable_as: "policy",
      risk_flags: [],
    })),
  };
}
