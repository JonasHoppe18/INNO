import {
  PRODUCT_SUPPORT_LOW_CONFIDENCE_INSTRUCTION,
  selectProductSupportSections,
  type ProductSupportSection,
} from "./product-support-section-selector.ts";

export type KnowledgeDocPreviewSection = {
  chunk_id: string;
  section_key?: string;
  section_heading: string;
  content: string;
  category?: string;
  product_scope?: string;
  section_order?: number;
  embedding?: number[];
};

export type KnowledgeDocPreviewQuery = {
  latestCustomerMessage?: string;
  conversationHistory?: string;
  // Precomputed query embedding (Edge Function side, Product Support preview
  // only). Optional — when absent the selector falls back to lexical-only.
  queryEmbedding?: number[];
};

const PRODUCT_SUPPORT_CATEGORY = "product_support";

export type ProductSupportSectionSelectionDiagnostics = {
  document_id: string;
  product_scope: string;
  selected_chunk_ids: string[];
  selected_headings: string[];
  confidence: "high" | "medium" | "low";
  reason: string;
  semantic_scores?: number[];
  lexical_scores?: number[];
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
    embedding?: number[];
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
    product_support_section_selection?: ProductSupportSectionSelectionDiagnostics;
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
        category: String(section.category || "").trim() || undefined,
        product_scope: String(section.product_scope || "").trim() || undefined,
        section_order: typeof section.section_order === "number"
          ? section.section_order
          : undefined,
        embedding: Array.isArray(section.embedding) ? section.embedding : undefined,
      }))
      .filter((section) => section.chunk_id && section.content);
  }

  if (Array.isArray(context.chunks)) {
    return context.chunks
      .map((chunk) => {
        const metadata = (chunk.metadata ?? {}) as Record<string, unknown>;
        const order = Number(metadata.section_order);
        return {
          chunk_id: String(chunk.id || "").trim(),
          section_key: String(metadata.section_key || "").trim() || undefined,
          section_heading: String(metadata.section_heading || "").trim(),
          content: String(chunk.content || "").trim(),
          category: String(metadata.category || "").trim() || undefined,
          product_scope: String(metadata.product_scope || "").trim() || undefined,
          section_order: Number.isFinite(order) ? order : undefined,
          embedding: Array.isArray(chunk.embedding) ? chunk.embedding : undefined,
        };
      })
      .filter((section) => section.chunk_id && section.content);
  }

  return [];
}

function isProductSupportDocument(
  sections: KnowledgeDocPreviewSection[],
): boolean {
  return sections.some((section) =>
    section.category === PRODUCT_SUPPORT_CATEGORY ||
    Boolean(section.product_scope)
  );
}

function renderPreviewBlock(body: string): string {
  return [
    "# AUTHORITATIVE PREVIEW KNOWLEDGE DOCUMENT",
    "This block applies only to this explicit test or simulation run.",
    "Use these draft document sections as the source of truth for matching policy facts in this preview.",
    "Do not treat this preview block as production runtime activation.",
    "",
    body,
  ].join("\n");
}

function sourcesForSections(
  sections: KnowledgeDocPreviewSection[],
): KnowledgeDocPreviewContextResult["sources"] {
  return sections.map((section) => ({
    content: section.content.slice(0, 200),
    kind: "knowledge_document_preview",
    source_label: section.section_heading
      ? `Draft document: ${section.section_heading}`
      : "Draft document preview",
    usable_as: "policy",
    risk_flags: [],
  }));
}

export function buildKnowledgeDocPreviewContext(
  context: KnowledgeDocPreviewContextInput,
  query?: KnowledgeDocPreviewQuery,
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

  // Product Support preview ONLY: select the most relevant H2 sections instead
  // of injecting the whole document. Returns & Refunds (and any non
  // product-support document) keeps the original "inject all sections"
  // behavior untouched.
  const latestCustomerMessage = String(query?.latestCustomerMessage || "").trim();
  if (isProductSupportDocument(sections)) {
    const productScope = sections.find((s) => s.product_scope)?.product_scope || "";

    // No customer message to match against → never inject every guide. Abstain
    // and let the writer ask one focused clarification question (preview only).
    if (!latestCustomerMessage) {
      return {
        blockText: PRODUCT_SUPPORT_LOW_CONFIDENCE_INSTRUCTION,
        diagnostics: {
          requested: true,
          document_id: documentId,
          preview_chunk_ids: [],
          section_headings: [],
          active_only_for_test: true,
          injected: true,
          reason: "product_support_low_confidence",
          product_support_section_selection: {
            document_id: documentId,
            product_scope: productScope,
            selected_chunk_ids: [],
            selected_headings: [],
            confidence: "low",
            reason: "no_customer_message",
          },
        },
        sources: [],
      };
    }

    const selectorSections: ProductSupportSection[] = sections.map((section) => ({
      chunk_id: section.chunk_id,
      section_key: section.section_key || "",
      section_heading: section.section_heading,
      content: section.content,
      section_order: section.section_order,
      embedding: section.embedding,
    }));
    const selection = selectProductSupportSections({
      latest_customer_message: latestCustomerMessage,
      conversation_history: query?.conversationHistory,
      sections: selectorSections,
      query_embedding: query?.queryEmbedding,
    });

    const selectionDiagnostics: ProductSupportSectionSelectionDiagnostics = {
      document_id: documentId,
      product_scope: productScope,
      selected_chunk_ids: selection.selected_sections.map((s) => s.chunk_id),
      selected_headings: selection.selected_sections.map((s) => s.section_heading),
      confidence: selection.confidence,
      reason: selection.reason,
      ...(selection.semantic_scores ? { semantic_scores: selection.semantic_scores } : {}),
      ...(selection.lexical_scores ? { lexical_scores: selection.lexical_scores } : {}),
    };

    // Low confidence / ambiguous → do not inject any guide; instruct the writer
    // (preview only) to ask one focused clarification question.
    if (selection.confidence === "low" || selection.selected_sections.length === 0) {
      return {
        blockText: PRODUCT_SUPPORT_LOW_CONFIDENCE_INSTRUCTION,
        diagnostics: {
          requested: true,
          document_id: documentId,
          preview_chunk_ids: [],
          section_headings: [],
          active_only_for_test: true,
          injected: true,
          reason: "product_support_low_confidence",
          product_support_section_selection: selectionDiagnostics,
        },
        sources: [],
      };
    }

    const selectedChunkIds = new Set(selection.selected_sections.map((s) => s.chunk_id));
    const selectedSections = sections.filter((s) => selectedChunkIds.has(s.chunk_id));
    const rendered = selectedSections
      .map((section, index) => {
        const heading = section.section_heading || `Section ${index + 1}`;
        return `## ${heading}\n${section.content}`;
      })
      .join("\n\n");

    return {
      blockText: renderPreviewBlock(rendered),
      diagnostics: {
        requested: true,
        document_id: documentId,
        preview_chunk_ids: selectedSections.map((s) => s.chunk_id),
        section_headings: selectedSections.map((s) => s.section_heading),
        active_only_for_test: true,
        injected: true,
        reason: "product_support_selected",
        product_support_section_selection: selectionDiagnostics,
      },
      sources: sourcesForSections(selectedSections),
    };
  }

  // Default (Returns & Refunds and any non product-support doc): inject all.
  const renderedSections = sections
    .map((section, index) => {
      const heading = section.section_heading || `Section ${index + 1}`;
      return `## ${heading}\n${section.content}`;
    })
    .join("\n\n");

  return {
    blockText: renderPreviewBlock(renderedSections),
    diagnostics: {
      requested: true,
      document_id: documentId,
      preview_chunk_ids: chunkIds,
      section_headings: headings,
      active_only_for_test: true,
      injected: true,
      reason: "injected",
    },
    sources: sourcesForSections(sections),
  };
}
