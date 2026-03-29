import type { CaseAssessment } from "../../_shared/case-assessment.ts";
import type { EmailCategory } from "../../_shared/email-category.ts";

type LatestMessageOverrideDecision = {
  should_override: boolean;
  category: EmailCategory | null;
  reason:
    | "none"
    | "current_message_first_override"
    | "high_confidence_technical_followup_override";
};

export const routeCategoryFromIntent = (
  intent: CaseAssessment["latest_message_primary_intent"],
): EmailCategory | null => {
  switch (intent) {
    case "technical_issue":
    case "warranty_complaint":
      return "Technical support";
    case "product_question":
      return "Product question";
    case "tracking_shipping":
      return "Tracking";
    case "return_refund":
      return "Return";
    case "billing_payment":
      return "Payment";
    case "order_change":
      return "General";
    case "general_support":
      return "General";
    default:
      return null;
  }
};

const shouldUseLatestMessageRouteLegacyHeuristic = (assessment: CaseAssessment) =>
  (assessment.latest_message_override_debug?.return_process_followup_matched === true) ||
  (
    assessment.latest_message_confidence >= 0.55 ||
    (
      assessment.latest_message_confidence >= 0.42 &&
      assessment.historical_context_intents.includes("tracking_shipping") &&
      assessment.latest_message_primary_intent !== "tracking_shipping" &&
      (
        assessment.latest_message_primary_intent === "general_support" ||
        assessment.latest_message_primary_intent === "return_refund" ||
        assessment.latest_message_primary_intent === "order_change"
      )
    )
  ) &&
  assessment.intent_conflict_detected &&
  assessment.current_message_should_override_thread_route;

const hasStrongTechnicalFollowupSignals = (assessment: CaseAssessment) => {
  const technicalIntent =
    assessment.latest_message_primary_intent === "technical_issue" ||
    assessment.primary_case_type === "technical_issue";
  if (!technicalIntent) return false;

  const latestConfidenceHigh =
    assessment.latest_message_confidence >= 0.72 ||
    (
      assessment.latest_message_confidence >= 0.65 &&
      Number(assessment.intent_scores?.technical_issue ?? 0) >= 5
    );
  if (!latestConfidenceHigh) return false;

  const continuationSignals =
    Boolean(assessment.entities.tried_fixes) ||
    Boolean(assessment.entities.old_device_works) ||
    Boolean(assessment.troubleshooting_exhausted) ||
    (assessment.entities.symptom_phrases || []).length > 0 ||
    (assessment.entities.context_phrases || []).length > 0;
  if (!continuationSignals) return false;

  // Guardrail: keep Exchange/Return-like routing when return intent clearly dominates.
  const technicalScore = Number(assessment.intent_scores?.technical_issue ?? 0);
  const returnScore = Number(assessment.intent_scores?.return_refund ?? 0);
  const returnDominates =
    returnScore >= technicalScore + 2 &&
    assessment.latest_message_primary_intent !== "technical_issue";
  if (returnDominates) return false;

  return true;
};

export function resolveLatestMessageCategoryOverride(options: {
  assessment: CaseAssessment;
  currentCategory: EmailCategory;
}): LatestMessageOverrideDecision {
  const { assessment, currentCategory } = options;

  if (shouldUseLatestMessageRouteLegacyHeuristic(assessment)) {
    const mapped = routeCategoryFromIntent(assessment.latest_message_primary_intent);
    if (mapped && mapped !== currentCategory) {
      return {
        should_override: true,
        category: mapped,
        reason: "current_message_first_override",
      };
    }
  }

  if (
    currentCategory !== "Technical support" &&
    hasStrongTechnicalFollowupSignals(assessment)
  ) {
    return {
      should_override: true,
      category: "Technical support",
      reason: "high_confidence_technical_followup_override",
    };
  }

  return {
    should_override: false,
    category: null,
    reason: "none",
  };
}

