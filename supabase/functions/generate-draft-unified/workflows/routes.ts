import {
  EMAIL_CATEGORIES,
  LEGACY_EMAIL_CATEGORY_MAP,
  normalizeEmailCategory,
  type EmailCategory,
} from "../../_shared/email-category.ts";
import { buildAddressChangeDraft } from "./categories/address-change.ts";
import { buildCancellationDraft } from "./categories/cancellation.ts";
import { buildExchangeDraft } from "./categories/exchange.ts";
import { buildGeneralDraft } from "./categories/general.ts";
import { buildPaymentDraft } from "./categories/payment.ts";
import { buildProductDraft } from "./categories/product-question.ts";
import { buildRefundDraft } from "./categories/refund.ts";
import { buildReturnDraft } from "./categories/return.ts";
import { buildTrackingDraft } from "./categories/tracking.ts";
import type { WorkflowRoute, WorkflowSlug } from "./types.ts";

const EMAIL_CATEGORY_SET = new Set<string>(EMAIL_CATEGORIES);
const LEGACY_CATEGORY_TAGS = new Set<string>(Object.keys(LEGACY_EMAIL_CATEGORY_MAP));

export function extractThreadCategoryFromTags(tags: unknown): EmailCategory {
  const list = Array.isArray(tags) ? tags : [];
  for (const raw of list) {
    const tag = String(raw || "").trim();
    if (!tag || tag.startsWith("inbox:")) continue;
    if (!EMAIL_CATEGORY_SET.has(tag) && !LEGACY_CATEGORY_TAGS.has(tag)) continue;
    return normalizeEmailCategory(tag);
  }
  return "General";
}

function categoryToWorkflow(category: EmailCategory): WorkflowSlug {
  switch (category) {
    case "Tracking":
      return "tracking";
    case "Return":
      return "return";
    case "Exchange":
      return "exchange";
    case "Product question":
      return "product_question";
    case "Payment":
      return "payment";
    case "Cancellation":
      return "cancellation";
    case "Refund":
      return "refund";
    case "Address change":
      return "address_change";
    default:
      return "general";
  }
}

export function buildWorkflowRoute(category: EmailCategory): WorkflowRoute {
  const workflow = categoryToWorkflow(category);
  switch (workflow) {
    case "tracking":
      return buildTrackingDraft(category);
    case "return":
      return buildReturnDraft(category);
    case "exchange":
      return buildExchangeDraft(category);
    case "product_question":
      return buildProductDraft(category);
    case "payment":
      return buildPaymentDraft(category);
    case "cancellation":
      return buildCancellationDraft(category);
    case "refund":
      return buildRefundDraft(category);
    case "address_change":
      return buildAddressChangeDraft(category);
    default:
      return buildGeneralDraft();
  }
}
