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

// Starter template for NEW product-support documents. Headings are suggestions
// only — the H2 parser accepts any custom heading, and users can rename,
// delete, reorder or add sections freely. Keep this template free of
// shop-specific facts and platform guardrails.
export const PRODUCT_SUPPORT_DOCUMENT_TEMPLATE = `## Product overview

## Microphone troubleshooting

## Bluetooth pairing

## Firmware update

## Reset instructions

## Charging issues

## Serial number location

## When to escalate for further review`;

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

function asNonEmpty(value: unknown, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
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
  return {
    id: null,
    category,
    document_type: documentType,
    title: category === "returns" && documentType === "returns_refunds"
      ? "Returns & Refunds"
      : isProductSupport
        ? "Product Support"
        : "Knowledge Document",
    draft_markdown: category === "returns" && documentType === "returns_refunds"
      ? RETURNS_DOCUMENT_TEMPLATE
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
  const { error: deleteError } = await options.serviceClient
    .from("agent_knowledge")
    .delete()
    .eq("shop_id", options.shopId)
    .eq("source_provider", "knowledge_document")
    .eq("metadata->>document_id", options.documentId)
    .eq("metadata->>environment", options.environment);
  if (deleteError) throw new Error(deleteError.message);

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
}): Promise<KnowledgeDocumentResponse & { preview_chunks: number }> {
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

  const previewChunks = await replaceDocumentChunks({
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

  const response = await getKnowledgeDocument({
    serviceClient: options.serviceClient,
    shopId: options.shopId,
    category,
    documentType,
  });
  return { ...response, preview_chunks: previewChunks };
}

export async function publishKnowledgeDocument(options: {
  serviceClient: any;
  embedder: Embedder;
  shopId: string;
  category: string;
  documentType: string;
}): Promise<KnowledgeDocumentResponse & { production_chunks: number }> {
  if (String(options.category || "").trim() === PRODUCT_SUPPORT_CATEGORY) {
    throw new Error("Product-support documents are preview-only and cannot be published yet.");
  }
  const { data: existing, error: loadError } = await options.serviceClient
    .from("knowledge_documents")
    .select("id, category, document_type, title, draft_markdown, metadata")
    .eq("shop_id", options.shopId)
    .eq("category", options.category)
    .eq("document_type", options.documentType)
    .maybeSingle();
  if (loadError) throw new Error(loadError.message);
  if (!existing?.id) throw new Error("Knowledge document not found.");

  const sections = parseKnowledgeDocumentSections(existing.draft_markdown);
  if (!sections.length) {
    throw new Error("Knowledge document must contain at least one H2 section.");
  }

  const { error: updateError } = await options.serviceClient
    .from("knowledge_documents")
    .update({
      published_markdown: existing.draft_markdown,
      has_unpublished_changes: false,
      published_at: new Date().toISOString(),
    })
    .eq("id", existing.id)
    .eq("shop_id", options.shopId)
    .select("id")
    .single();
  if (updateError) throw new Error(updateError.message);

  const productionChunks = await replaceDocumentChunks({
    serviceClient: options.serviceClient,
    embedder: options.embedder,
    shopId: options.shopId,
    documentId: existing.id,
    documentType: existing.document_type,
    category: existing.category,
    title: existing.title,
    sections,
    environment: "production",
  });

  const response = await getKnowledgeDocument({
    serviceClient: options.serviceClient,
    shopId: options.shopId,
    category: options.category,
    documentType: options.documentType,
  });
  return { ...response, production_chunks: productionChunks };
}
