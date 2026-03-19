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

function hasAssessmentFact(assessment: CaseAssessment, patterns: RegExp[]) {
  const values = [
    ...(assessment.entities.symptom_phrases || []),
    ...(assessment.entities.context_phrases || []),
    ...(assessment.entities.product_queries || []),
  ]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  return values.some((value) => patterns.some((pattern) => pattern.test(value)));
}

function isInternalSupportOnlyAction(type: string) {
  const normalized = String(type || "").trim().toLowerCase();
  return [
    "add_note",
    "add_tag",
    "add_internal_note_or_tag",
    "lookup_order_status",
  ].includes(normalized);
}

export function buildReplyStrategy(input: BuildReplyStrategyInput): ReplyStrategy {
  const missingInputs = input.assessment.actionability.missing_required_inputs;
  const executionState = input.executionState ?? "no_action";
  const technicalOrProductCase = isTechnicalOrProductCase(input.assessment);
  const strongTechnicalIssue = hasStrongTechnicalIssue(input.assessment);
  const onlyInternalSupportActions =
    Array.isArray(input.validation.allowed_actions) &&
    input.validation.allowed_actions.length > 0 &&
    input.validation.allowed_actions.every((action) =>
      isInternalSupportOnlyAction(String(action?.type || ""))
    );
  const customerFacingExecutionState =
    onlyInternalSupportActions &&
      (executionState === "validated_not_executed" || executionState === "pending_approval")
      ? "no_action"
      : executionState;
  const hasReturnRefundIntent =
    input.assessment.primary_case_type === "return_refund" ||
    input.assessment.secondary_case_types.includes("return_refund");
  const alreadyKnownUpdatedState = hasAssessmentFact(input.assessment, [
    /\bupdated\b/,
    /\bup to date\b/,
    /\bopdateret\b/,
    /\bajour\b/,
    /\bfirmware updated\b/,
    /\bsoftware updated\b/,
  ]);
  const alreadyKnownFrequencyState = hasAssessmentFact(input.assessment, [
    /\bsame frequency\b/,
    /\bsamme frekvens\b/,
    /\bfrequency\b/,
    /\bfrekvens\b/,
  ]);
  const alreadyKnownTriedFixes = Boolean(input.assessment.entities.tried_fixes) ||
    hasAssessmentFact(input.assessment, [
      /\btried\b/,
      /\bretried\b/,
      /\bforsoegt\b/,
      /\bforsøgt\b/,
      /\balready tried\b/,
    ]);
  const diagnosticQuestions: string[] = [];
  if (strongTechnicalIssue && customerFacingExecutionState === "no_action") {
    if ((input.assessment.entities.context_phrases || []).length === 0) {
      diagnosticQuestions.push("ask_which_platform_or_device_the_customer_is_using");
    }
    diagnosticQuestions.push("ask_if_the_issue_only_happens_in_one_game_or_app");
    if (!alreadyKnownUpdatedState) {
      diagnosticQuestions.push("ask_if_firmware_or_software_is_fully_up_to_date");
    }
    if (!alreadyKnownFrequencyState) {
      diagnosticQuestions.push("ask_if_the_device_and_dongle_are_on_the_same_frequency_or_pairing_setup");
    }
    if (!alreadyKnownTriedFixes) {
      diagnosticQuestions.push("ask_which_troubleshooting_steps_the_customer_has_already_tried");
    }
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
      : customerFacingExecutionState === "blocked"
      ? "decline_or_block_action"
      : customerFacingExecutionState === "pending_approval" || customerFacingExecutionState === "validated_not_executed"
      ? "state_action_pending"
      : customerFacingExecutionState === "executed"
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
  if (customerFacingExecutionState !== executionState) {
    approvedFacts.push({ key: "customer_facing_execution_state", value: customerFacingExecutionState });
  }
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
    "same_thread_email_escalation",
    "redundant_same_thread_notification_request",
  ];
  const forbiddenClaims =
    customerFacingExecutionState === "executed"
      ? []
      : [
          "claim_action_completed",
          "claim_order_changed",
          "claim_refund_processed",
          "claim_cancellation_completed",
          "tell_customer_to_email_support_again",
          "tell_customer_to_notify_or_contact_us_again_about_the_same_request",
        ];

  if (
    technicalOrProductCase &&
    customerFacingExecutionState === "no_action" &&
    String(input.policyIntent || "OTHER").toUpperCase() === "OTHER" &&
    !hasReturnRefundIntent
  ) {
    mustNotInclude.push("return_or_refund_suggestions_without_explicit_support");
    forbiddenClaims.push("suggest_return_or_refund");
  }

  return {
    version: 1,
    mode,
    execution_state: customerFacingExecutionState,
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
      customerFacingExecutionState === "executed"
        ? ["may_confirm_completed_action"]
        : customerFacingExecutionState === "pending_approval" || customerFacingExecutionState === "validated_not_executed"
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
