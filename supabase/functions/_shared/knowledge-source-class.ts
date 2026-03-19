import type { GeneralCaseType } from "./case-assessment.ts";

export type KnowledgeSourceClass =
  | "policy"
  | "product"
  | "product_manual"
  | "troubleshooting"
  | "support_process"
  | "example_reply"
  | "marketing"
  | "order_facts"
  | "general_knowledge";

type MatchLike = {
  source_provider?: string | null;
  source_type?: string | null;
  metadata?: Record<string, unknown> | null;
  content?: string | null;
};

const RETRIEVAL_PRIORITY: Record<GeneralCaseType, KnowledgeSourceClass[]> = {
  technical_issue: [
    "troubleshooting",
    "product_manual",
    "product",
    "policy",
    "support_process",
    "example_reply",
    "general_knowledge",
    "marketing",
    "order_facts",
  ],
  product_question: [
    "product",
    "product_manual",
    "troubleshooting",
    "support_process",
    "example_reply",
    "general_knowledge",
    "marketing",
    "policy",
    "order_facts",
  ],
  tracking_shipping: [
    "order_facts",
    "policy",
    "support_process",
    "example_reply",
    "general_knowledge",
    "marketing",
    "product",
    "product_manual",
    "troubleshooting",
  ],
  return_refund: [
    "policy",
    "support_process",
    "order_facts",
    "example_reply",
    "general_knowledge",
    "marketing",
    "product",
    "product_manual",
    "troubleshooting",
  ],
  order_change: [
    "order_facts",
    "policy",
    "support_process",
    "example_reply",
    "general_knowledge",
    "marketing",
    "product",
    "product_manual",
    "troubleshooting",
  ],
  billing_payment: [
    "order_facts",
    "policy",
    "support_process",
    "example_reply",
    "general_knowledge",
    "marketing",
    "product",
    "product_manual",
    "troubleshooting",
  ],
  warranty_complaint: [
    "policy",
    "troubleshooting",
    "product_manual",
    "product",
    "support_process",
    "example_reply",
    "general_knowledge",
    "marketing",
    "order_facts",
  ],
  general_support: [
    "support_process",
    "example_reply",
    "general_knowledge",
    "marketing",
    "policy",
    "product",
    "product_manual",
    "troubleshooting",
    "order_facts",
  ],
  mixed_case: [
    "order_facts",
    "policy",
    "troubleshooting",
    "product_manual",
    "product",
    "support_process",
    "example_reply",
    "general_knowledge",
    "marketing",
  ],
};

function textHints(match: MatchLike) {
  const provider = String(match.source_provider || "").trim().toLowerCase();
  const type = String(match.source_type || "").trim().toLowerCase();
  const metadata = match.metadata && typeof match.metadata === "object" ? match.metadata : {};
  const title = String(metadata?.title || metadata?.name || "").trim().toLowerCase();
  const content = String(match.content || "").slice(0, 500).toLowerCase();
  return { provider, type, title, content, combined: [provider, type, title, content].join(" ") };
}

export function mapKnowledgeSourceClass(match: MatchLike): KnowledgeSourceClass {
  const { provider, type, combined } = textHints(match);

  if (provider === "shopify_policy") return "policy";
  if (provider === "shopify_product" || provider === "shopify_variant") return "product";
  if (provider === "zendesk" || type === "ticket") return "example_reply";
  if (/\b(policy|refund policy|shipping policy|terms|privacy policy)\b/.test(combined)) {
    return "policy";
  }
  if (/\b(troubleshoot|troubleshooting|not working|reset|repair|fix|pairing|connectivity)\b/.test(combined)) {
    return "troubleshooting";
  }
  if (/\b(manual|user guide|setup guide|instruction|how to use)\b/.test(combined)) {
    return "product_manual";
  }
  if (/\b(return process|support process|contact support|process|rma|warranty process)\b/.test(combined)) {
    return "support_process";
  }
  if (/\b(marketing|campaign|launch|promotion|newsletter)\b/.test(combined)) {
    return "marketing";
  }
  if (
    provider === "shopify_page" ||
    provider === "shopify_file" ||
    provider === "pdf_upload" ||
    provider === "image_upload" ||
    provider === "manual_text" ||
    provider === "csv_support_knowledge"
  ) {
    return "general_knowledge";
  }
  if (provider === "shopify_collection" || provider === "shopify_blog_article") {
    return "general_knowledge";
  }
  return "general_knowledge";
}

export function getKnowledgeSourcePriority(
  caseType: GeneralCaseType,
  sourceClass: KnowledgeSourceClass,
): number {
  const ordered = RETRIEVAL_PRIORITY[caseType] || RETRIEVAL_PRIORITY.general_support;
  const index = ordered.indexOf(sourceClass);
  return index === -1 ? 0 : ordered.length - index;
}

export function summarizeRetrievalPriority(caseType: GeneralCaseType) {
  return RETRIEVAL_PRIORITY[caseType] || RETRIEVAL_PRIORITY.general_support;
}
