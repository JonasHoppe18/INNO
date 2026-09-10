import { buildKnowledgeDocumentChunks, type KnowledgeDocumentChunkEnvironment } from "./knowledge-doc-chunks";
import {
  parseKnowledgeDocumentSections,
  type KnowledgeDocumentSection,
} from "./knowledge-doc-parser";
import {
  PRODUCT_SUPPORT_CATEGORY,
  PRODUCT_SUPPORT_DOCUMENT_TYPE,
  productScopeFromDocumentType,
} from "../knowledge/product-support";

// Starter template for NEW Returns & Refunds documents. Shop-specific policy
// FACTS and procedures only — universal safety/behavior rules are enforced by
// the hidden platform writer mandate (generate-draft-v2/stages/
// platform-support-guardrails.ts) and must not live in shop-editable docs.
// Existing documents that still contain an "## Internal guidance" section keep
// parsing unchanged (knowledge-doc-parser.ts retains the heading mapping).
export const RETURNS_DOCUMENT_TEMPLATE = `## Return window

## Opened or tested products

## Return shipping

## Refund processing

## Default return address

## Third-party purchases`;

// Starter template for NEW product-support documents. Intentionally empty —
// predefined headings were too opinionated to fit every product, so a new
// document opens as a blank editor and users create their own H2 sections via
// the existing "Section heading" toolbar button. The H2 parser accepts any
// custom heading.
export const PRODUCT_SUPPORT_DOCUMENT_TEMPLATE = "";

export const GENERAL_DOCUMENT_CATEGORY = "general";
export const GENERAL_DOCUMENT_TYPE = "general";
export const GENERAL_DOCUMENT_TEMPLATE = `## Store-wide procedures

## Contact information

## Special handling`;

export type KnowledgeDocumentRecord = {
  id: string | null;
  category: string;
  document_type: string;
  title: string;
  draft_markdown: string;
  published_markdown: string;
  has_unpublished_changes: boolean;
  published_at: string | null;
  metadata: Record<string, unknown>;
};

export type KnowledgeDocumentResponse = {
  document: KnowledgeDocumentRecord;
  parsed_sections: KnowledgeDocumentSection[];
  legacy_snippets_exist: boolean;
};

export type Embedder = (input: string) => Promise<number[]>;

export type KnowledgeDocumentIndexingResult = {
  environment: KnowledgeDocumentChunkEnvironment;
  status: "ready" | "error";
  message?: string;
};

function asNonEmpty(value: unknown, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function asMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function withIndexingStatus(
  metadata: unknown,
  environment: KnowledgeDocumentChunkEnvironment,
  result: KnowledgeDocumentIndexingResult,
) {
  const current = asMetadata(metadata);
  const currentIndex = asMetadata(current.knowledge_index);
  return {
    ...current,
    knowledge_index: {
      ...currentIndex,
      [environment]: {
        status: result.status,
        ...(result.message ? { message: result.message } : {}),
        updated_at: new Date().toISOString(),
      },
    },
  };
}

function publicIndexingError(error: unknown) {
  const message = String((error as any)?.message || error || "");
  if (/OPENAI_API_KEY/i.test(message)) {
    return "AI indexing is not configured. Your changes were saved, but preview and publishing are unavailable until it is configured.";
  }
  return "AI indexing failed. Your changes were saved, but preview and publishing are unavailable until indexing succeeds.";
}

async function recordIndexingStatus(options: {
  serviceClient: any;
  shopId: string;
  documentId: string;
  metadata: unknown;
  result: KnowledgeDocumentIndexingResult;
}) {
  const metadata = withIndexingStatus(options.metadata, options.result.environment, options.result);
  const { error } = await options.serviceClient
    .from("knowledge_documents")
    .update({ metadata })
    .eq("id", options.documentId)
    .eq("shop_id", options.shopId);
  if (error) throw new Error(error.message);
  return metadata;
}

function requireProductScopeIfProductSupport(category: string, documentType: string): string {
  if (category !== PRODUCT_SUPPORT_CATEGORY) return "";
  const productScope = productScopeFromDocumentType(documentType);
  if (!productScope) {
    throw new Error(
      `Product-support documents require a product-scoped document_type ("${PRODUCT_SUPPORT_DOCUMENT_TYPE}:<product-scope>").`,
    );
  }
  return productScope;
}

export function defaultKnowledgeDocument(category: string, documentType: string): KnowledgeDocumentRecord {
  const isProductSupport = category === PRODUCT_SUPPORT_CATEGORY
    && Boolean(productScopeFromDocumentType(documentType));
  const isGeneralDocument = category === GENERAL_DOCUMENT_CATEGORY
    && documentType === GENERAL_DOCUMENT_TYPE;
  return {
    id: null,
    category,
    document_type: documentType,
    title: category === "returns" && documentType === "returns_refunds"
      ? "Returns & Refunds"
      : isGeneralDocument
        ? "General Knowledge"
      : isProductSupport
        ? "Product Support"
        : "Knowledge Document",
    draft_markdown: category === "returns" && documentType === "returns_refunds"
      ? RETURNS_DOCUMENT_TEMPLATE
      : isGeneralDocument
        ? GENERAL_DOCUMENT_TEMPLATE
      : isProductSupport
        ? PRODUCT_SUPPORT_DOCUMENT_TEMPLATE
        : "# Knowledge Document\n\n## Overview",
    published_markdown: "",
    has_unpublished_changes: false,
    published_at: null,
    metadata: {},
  };
}

export async function getKnowledgeDocument(options: {
  serviceClient: any;
  shopId: string;
  category: string;
  documentType: string;
}): Promise<KnowledgeDocumentResponse> {
  const { data, error } = await options.serviceClient
    .from("knowledge_documents")
    .select("id, category, document_type, title, draft_markdown, published_markdown, has_unpublished_changes, published_at, metadata")
    .eq("shop_id", options.shopId)
    .eq("category", options.category)
    .eq("document_type", options.documentType)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const document = data?.id
    ? {
      id: data.id,
      category: data.category,
      document_type: data.document_type,
      title: data.title,
      draft_markdown: data.draft_markdown,
      published_markdown: data.published_markdown,
      has_unpublished_changes: Boolean(data.has_unpublished_changes),
      published_at: data.published_at ?? null,
      metadata: data.metadata ?? {},
    }
    : defaultKnowledgeDocument(options.category, options.documentType);

  // Legacy product snippets live under the "product-questions" category.
  const legacyCategory = options.category === PRODUCT_SUPPORT_CATEGORY
    ? "product-questions"
    : options.category;
  const legacy = await options.serviceClient
    .from("agent_knowledge")
    .select("id")
    .eq("shop_id", options.shopId)
    .eq("source_provider", "manual_text")
    .eq("metadata->>category", legacyCategory)
    .limit(1);
  if (legacy.error) throw new Error(legacy.error.message);

  return {
    document,
    parsed_sections: parseKnowledgeDocumentSections(document.draft_markdown),
    legacy_snippets_exist: Array.isArray(legacy.data) && legacy.data.length > 0,
  };
}

async function replaceDocumentChunks(options: {
  serviceClient: any;
  embedder: Embedder;
  shopId: string;
  documentId: string;
  documentType: string;
  category: string;
  title: string;
  sections: KnowledgeDocumentSection[];
  environment: KnowledgeDocumentChunkEnvironment;
  productScope?: string;
}) {
  const chunkPayloads = buildKnowledgeDocumentChunks({
    shopId: options.shopId,
    documentId: options.documentId,
    // Product-support chunks carry the base document_type plus an explicit
    // product_scope so retrieval can never mix products via type matching.
    documentType: options.productScope ? PRODUCT_SUPPORT_DOCUMENT_TYPE : options.documentType,
    category: options.category,
    title: options.title,
    sections: options.sections,
    environment: options.environment,
    productScope: options.productScope,
  });

  const rows = [];
  for (const payload of chunkPayloads) {
    rows.push({
      ...payload,
      embedding: await options.embedder(payload.content),
    });
  }
  if (!rows.length) return 0;

  // Build every embedding before deleting the previous version. If the AI
  // provider is unavailable, the last usable index stays intact while the
  // document draft can still be saved.
  const { error: deleteError } = await options.serviceClient
    .from("agent_knowledge")
    .delete()
    .eq("shop_id", options.shopId)
    .eq("source_provider", "knowledge_document")
    .eq("metadata->>document_id", options.documentId)
    .eq("metadata->>environment", options.environment);
  if (deleteError) throw new Error(deleteError.message);

  const { error: insertError } = await options.serviceClient
    .from("agent_knowledge")
    .insert(rows);
  if (insertError) throw new Error(insertError.message);
  return rows.length;
}

export async function saveKnowledgeDocumentDraft(options: {
  serviceClient: any;
  embedder: Embedder;
  shopId: string;
  category: string;
  documentType: string;
  title: string;
  draftMarkdown: string;
}): Promise<KnowledgeDocumentResponse & {
  preview_chunks: number;
  indexing: KnowledgeDocumentIndexingResult;
  warning?: string;
}> {
  const category = asNonEmpty(options.category);
  const documentType = asNonEmpty(options.documentType);
  const productScope = requireProductScopeIfProductSupport(category, documentType);
  const title = asNonEmpty(options.title, "Knowledge Document");
  const draftMarkdown = String(options.draftMarkdown ?? "").replace(/\r\n/g, "\n");
  const sections = parseKnowledgeDocumentSections(draftMarkdown);
  if (!sections.length) {
    throw new Error("Knowledge document must contain at least one H2 section.");
  }

  const { data, error } = await options.serviceClient
    .from("knowledge_documents")
    .upsert({
      shop_id: options.shopId,
      category,
      document_type: documentType,
      title,
      draft_markdown: draftMarkdown,
      has_unpublished_changes: true,
    }, { onConflict: "shop_id,category,document_type" })
    .select("id, category, document_type, title, draft_markdown, published_markdown, has_unpublished_changes, published_at, metadata")
    .single();
  if (error) throw new Error(error.message);

  let previewChunks = 0;
  let indexing: KnowledgeDocumentIndexingResult = {
    environment: "preview",
    status: "ready",
  };
  let metadata = data.metadata ?? {};
  try {
    previewChunks = await replaceDocumentChunks({
      serviceClient: options.serviceClient,
      embedder: options.embedder,
      shopId: options.shopId,
      documentId: data.id,
      documentType,
      category,
      title,
      sections,
      environment: "preview",
      productScope,
    });
  } catch (error) {
    indexing = {
      environment: "preview",
      status: "error",
      message: publicIndexingError(error),
    };
    console.warn("Knowledge document preview indexing failed", {
      documentId: data.id,
      error: String((error as any)?.message || error),
    });
    try {
      metadata = await recordIndexingStatus({
        serviceClient: options.serviceClient,
        shopId: options.shopId,
        documentId: data.id,
        metadata,
        result: indexing,
      });
    } catch (statusError) {
      console.warn("Could not record knowledge document indexing status", {
        documentId: data.id,
        error: String((statusError as any)?.message || statusError),
      });
    }
  }

  if (indexing.status === "ready") {
    metadata = withIndexingStatus(metadata, "preview", indexing);
    try {
      metadata = await recordIndexingStatus({
        serviceClient: options.serviceClient,
        shopId: options.shopId,
        documentId: data.id,
        metadata,
        result: indexing,
      });
    } catch (statusError) {
      // Indexing succeeded. A metadata status write must not turn a successful
      // save into an error; the next GET can still derive readiness from the
      // generated preview chunks.
      console.warn("Could not record knowledge document indexing status", {
        documentId: data.id,
        error: String((statusError as any)?.message || statusError),
      });
    }
  }

  const response = await getKnowledgeDocument({
    serviceClient: options.serviceClient,
    shopId: options.shopId,
    category,
    documentType,
  });
  return {
    ...response,
    document: { ...response.document, metadata },
    preview_chunks: previewChunks,
    indexing,
    ...(indexing.message ? { warning: indexing.message } : {}),
  };
}

export async function publishKnowledgeDocument(options: {
  serviceClient: any;
  embedder: Embedder;
  shopId: string;
  category: string;
  documentType: string;
}): Promise<KnowledgeDocumentResponse & { production_chunks: number }> {
  const category = asNonEmpty(options.category);
  const documentType = asNonEmpty(options.documentType);
  // Product-support documents are now first-class publishable canonical docs.
  // Resolving the product scope here (throws on a malformed document_type) makes
  // the production chunks carry the same document_type + product_scope shape as
  // the preview chunks, so retrieval can keep scoping them per product.
  const productScope = requireProductScopeIfProductSupport(category, documentType);

  const { data: existing, error: loadError } = await options.serviceClient
    .from("knowledge_documents")
    .select("id, category, document_type, title, draft_markdown, metadata")
    .eq("shop_id", options.shopId)
    .eq("category", category)
    .eq("document_type", documentType)
    .maybeSingle();
  if (loadError) throw new Error(loadError.message);
  if (!existing?.id) throw new Error("Knowledge document not found.");

  const sections = parseKnowledgeDocumentSections(existing.draft_markdown);
  if (!sections.length) {
    throw new Error("Knowledge document must contain at least one H2 section.");
  }

  let productionChunks = 0;
  try {
    productionChunks = await replaceDocumentChunks({
      serviceClient: options.serviceClient,
      embedder: options.embedder,
      shopId: options.shopId,
      documentId: existing.id,
      documentType: existing.document_type,
      category: existing.category,
      title: existing.title,
      sections,
      environment: "production",
      productScope,
    });
  } catch (error) {
    const message = publicIndexingError(error);
    console.warn("Knowledge document production indexing failed", {
      documentId: existing.id,
      error: String((error as any)?.message || error),
    });
    try {
      await recordIndexingStatus({
        serviceClient: options.serviceClient,
        shopId: options.shopId,
        documentId: existing.id,
        metadata: existing.metadata,
        result: { environment: "production", status: "error", message },
      });
    } catch (statusError) {
      console.warn("Could not record knowledge document publish status", {
        documentId: existing.id,
        error: String((statusError as any)?.message || statusError),
      });
    }
    throw new Error(message);
  }

  const publishedAt = new Date().toISOString();
  const metadata = withIndexingStatus(existing.metadata, "production", {
    environment: "production",
    status: "ready",
  });
  const { error: updateError } = await options.serviceClient
    .from("knowledge_documents")
    .update({
      published_markdown: existing.draft_markdown,
      has_unpublished_changes: false,
      published_at: publishedAt,
      metadata,
    })
    .eq("id", existing.id)
    .eq("shop_id", options.shopId)
    .select("id")
    .single();
  if (updateError) throw new Error(updateError.message);

  const response = await getKnowledgeDocument({
    serviceClient: options.serviceClient,
    shopId: options.shopId,
    category,
    documentType,
  });
  return {
    ...response,
    document: { ...response.document, metadata },
    production_chunks: productionChunks,
  };
}
