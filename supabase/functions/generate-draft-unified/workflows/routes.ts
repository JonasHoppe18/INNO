import {
  EMAIL_CATEGORIES,
  LEGACY_EMAIL_CATEGORY_MAP,
  normalizeEmailCategory,
  type EmailCategory,
} from "../../_shared/email-category.ts";
import { buildAddressChangeDraft } from "./categories/address-change.ts";
import { buildCancellationDraft } from "./categories/cancellation.ts";
import { buildComplaintDraft } from "./categories/complaint.ts";
import { buildExchangeDraft } from "./categories/exchange.ts";
import { buildFraudDisputeDraft } from "./categories/fraud-dispute.ts";
import { buildGeneralDraft } from "./categories/general.ts";
import { buildGiftCardDraft } from "./categories/gift-card.ts";
import { buildMissingItemDraft } from "./categories/missing-item.ts";
import { buildPaymentDraft } from "./categories/payment.ts";
import { buildProductDraft } from "./categories/product-question.ts";
import { buildRefundDraft } from "./categories/refund.ts";
import { buildReturnDraft } from "./categories/return.ts";
import { buildTechnicalSupportDraft } from "./categories/technical-support.ts";
import { buildTrackingDraft } from "./categories/tracking.ts";
import { buildWarrantyDraft } from "./categories/warranty.ts";
import { buildWrongItemDraft } from "./categories/wrong-item.ts";
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
    case "Technical support":
      return "technical_support";
    case "Payment":
      return "payment";
    case "Cancellation":
      return "cancellation";
    case "Refund":
      return "refund";
    case "Address change":
      return "address_change";
    case "Wrong item":
      return "wrong_item";
    case "Missing item":
      return "missing_item";
    case "Complaint":
      return "complaint";
    case "Fraud / dispute":
      return "fraud_dispute";
    case "Warranty":
      return "warranty";
    case "Gift card":
      return "gift_card";
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
    case "technical_support":
      return buildTechnicalSupportDraft(category);
    case "payment":
      return buildPaymentDraft(category);
    case "cancellation":
      return buildCancellationDraft(category);
    case "refund":
      return buildRefundDraft(category);
    case "address_change":
      return buildAddressChangeDraft(category);
    case "wrong_item":
      return buildWrongItemDraft(category);
    case "missing_item":
      return buildMissingItemDraft(category);
    case "complaint":
      return buildComplaintDraft(category);
    case "fraud_dispute":
      return buildFraudDisputeDraft(category);
    case "warranty":
      return buildWarrantyDraft(category);
    case "gift_card":
      return buildGiftCardDraft(category);
    default:
      return buildGeneralDraft();
  }
}
