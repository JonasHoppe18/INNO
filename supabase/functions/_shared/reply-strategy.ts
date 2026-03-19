import type { CaseAssessment } from "./case-assessment.ts";
import type { ActionDecisionValidation } from "./action-validator.ts";
import type { ExecutionState } from "./reply-safety.ts";

export type ReplyStrategy = {
  version: 1;
  mode:
    | "answer_question"
    | "confirm_completed_action"
    | "state_action_pending"
    | "decline_or_block_action"
    | "ask_for_missing_info"
    | "mixed_response";
  language: string;
  goal: string;
  must_include: string[];
  must_not_include: string[];
  allowed_claims: string[];
  forbidden_claims: string[];
  execution_state: ExecutionState;
  open_questions: string[];
  approved_facts: Array<{ key: string; value: string }>;
  tone: {
    style: string;
    empathy: "low" | "medium" | "high";
  };
  summary: string;
};

type BuildReplyStrategyInput = {
  assessment: CaseAssessment;
  validation: ActionDecisionValidation;
  selectedOrder?: Record<string, unknown> | null;
  trackingIntent?: boolean;
  hasPolicyContext?: boolean;
  policyIntent?: string | null;
  executionState?: ExecutionState;
};

function uniq(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function isTechnicalOrProductCase(assessment: CaseAssessment) {
  const types = new Set([assessment.primary_case_type, ...assessment.secondary_case_types]);
  return types.has("technical_issue") || types.has("product_question");
}

function hasStrongTechnicalIssue(assessment: CaseAssessment) {
  return Number(assessment.intent_scores.technical_issue ?? 0) >= 4 ||
    assessment.primary_case_type === "technical_issue" ||
    assessment.secondary_case_types.includes("technical_issue");
}

export function buildReplyStrategy(input: BuildReplyStrategyInput): ReplyStrategy {
  const missingInputs = input.assessment.actionability.missing_required_inputs;
  const executionState = input.executionState ?? "no_action";
  const technicalOrProductCase = isTechnicalOrProductCase(input.assessment);
  const strongTechnicalIssue = hasStrongTechnicalIssue(input.assessment);
  const hasReturnRefundIntent =
    input.assessment.primary_case_type === "return_refund" ||
    input.assessment.secondary_case_types.includes("return_refund");
  const diagnosticQuestions: string[] = [];
  if (strongTechnicalIssue && executionState === "no_action") {
    if ((input.assessment.entities.context_phrases || []).length === 0) {
      diagnosticQuestions.push("ask_which_platform_or_device_the_customer_is_using");
    }
    diagnosticQuestions.push("ask_if_the_issue_only_happens_in_one_game_or_app");
    diagnosticQuestions.push("ask_if_firmware_or_software_is_fully_up_to_date");
    if (input.assessment.entities.product_queries?.length) {
      diagnosticQuestions.push("ask_for_serial_number_if_relevant_for_troubleshooting_or_warranty");
    }
  }
  const combinedOpenQuestions = uniq([
    ...missingInputs,
    ...diagnosticQuestions,
  ]);
  const mode =
    missingInputs.length > 0
      ? "ask_for_missing_info"
      : executionState === "blocked"
      ? "decline_or_block_action"
      : executionState === "pending_approval" || executionState === "validated_not_executed"
      ? "state_action_pending"
      : executionState === "executed"
      ? "confirm_completed_action"
      : strongTechnicalIssue
      ? "ask_for_missing_info"
      : input.assessment.intent_labels.length > 1
      ? "mixed_response"
      : "answer_question";
  const approvedFacts: Array<{ key: string; value: string }> = [];
  const orderName = String(input.selectedOrder?.name || input.selectedOrder?.order_number || "").trim();
  if (orderName) approvedFacts.push({ key: "order_reference", value: orderName });
  if (input.trackingIntent) approvedFacts.push({ key: "tracking_intent", value: "true" });
  if (input.hasPolicyContext) approvedFacts.push({ key: "policy_context_loaded", value: "true" });
  approvedFacts.push({ key: "execution_state", value: executionState });
  const primaryProduct = String(input.assessment.entities.product_queries?.[0] || "").trim();
  if (primaryProduct) approvedFacts.push({ key: "product_name", value: primaryProduct });
  for (const symptom of input.assessment.entities.symptom_phrases || []) {
    approvedFacts.push({ key: "symptom_phrase", value: symptom });
  }
  for (const contextPhrase of input.assessment.entities.context_phrases || []) {
    approvedFacts.push({ key: "context_phrase", value: contextPhrase });
  }
  if (input.assessment.entities.old_device_works) {
    approvedFacts.push({ key: "old_device_works", value: "true" });
  }
  if (input.assessment.entities.tried_fixes) {
    approvedFacts.push({ key: "customer_tried_fixes", value: "true" });
  }

  const mustNotInclude = [
    "invented_policy",
    "unapproved_action_confirmation",
    "unsupported_tracking_details",
  ];
  const forbiddenClaims =
    executionState === "executed"
      ? []
      : [
          "claim_action_completed",
          "claim_order_changed",
          "claim_refund_processed",
          "claim_cancellation_completed",
        ];

  if (
    technicalOrProductCase &&
    executionState === "no_action" &&
    String(input.policyIntent || "OTHER").toUpperCase() === "OTHER" &&
    !hasReturnRefundIntent
  ) {
    mustNotInclude.push("return_or_refund_suggestions_without_explicit_support");
    forbiddenClaims.push("suggest_return_or_refund");
  }

  return {
    version: 1,
    mode,
    execution_state: executionState,
    language: input.assessment.language,
    goal:
      mode === "ask_for_missing_info" && strongTechnicalIssue
        ? "Acknowledge the reported technical issue, reflect the concrete symptoms already provided, and ask 2-4 targeted troubleshooting follow-up questions."
        : mode === "ask_for_missing_info"
        ? "Collect the missing details needed before taking action."
        : mode === "decline_or_block_action"
        ? "Explain clearly that the requested action cannot be completed."
        : mode === "state_action_pending"
        ? "Explain that the requested action is pending approval or manual review."
        : mode === "confirm_completed_action"
        ? "Confirm the action outcome clearly and concisely."
        : strongTechnicalIssue
        ? "Acknowledge the reported technical issue, reflect the concrete symptoms already provided, and ask 2-4 targeted troubleshooting follow-up questions."
        : "Answer the customer using approved context only.",
    must_include:
      mode === "ask_for_missing_info"
        ? [
          "acknowledge_the_specific_reported_issue",
          "use_concrete_customer_issue_facts",
          ...missingInputs.map((item) => `ask_for_${item}`),
          ...diagnosticQuestions,
        ]
        : mode === "state_action_pending"
        ? ["state_manual_review_or_approval"]
        : mode === "decline_or_block_action"
        ? ["state_that_the_request_cannot_be_completed_now"]
        : technicalOrProductCase
        ? ["acknowledge_the_specific_reported_issue", "use_concrete_customer_issue_facts"]
        : [],
    must_not_include: mustNotInclude,
    allowed_claims:
      executionState === "executed"
        ? ["may_confirm_completed_action"]
        : executionState === "pending_approval" || executionState === "validated_not_executed"
        ? ["may_confirm_review_or_pending_state"]
        : ["may_answer_using_approved_facts_only"],
    forbidden_claims: forbiddenClaims,
    open_questions: mode === "ask_for_missing_info" ? combinedOpenQuestions : missingInputs,
    approved_facts: approvedFacts,
    tone: {
      style: "concise_support",
      empathy: input.assessment.customer_sentiment === "negative" ? "medium" : "low",
    },
    summary: `${mode} for ${input.assessment.case_type}`,
  };
}
