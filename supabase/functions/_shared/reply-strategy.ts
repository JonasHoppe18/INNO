import type { CaseAssessment } from "./case-assessment.ts";
import type { ActionDecisionValidation } from "./action-validator.ts";
import type { ExecutionState } from "./reply-safety.ts";
import type {
  DefectReturnShippingRule,
  ReturnLabelMethod,
  ReturnShippingMode,
} from "./return-settings.ts";

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
  defectReturnShippingRule?: DefectReturnShippingRule;
  returnLabelMethod?: ReturnLabelMethod;
  returnShippingMode?: ReturnShippingMode;
  returnAddress?: string | null;
  messageUnderstanding?: {
    latest_user_request: string;
    ask_shape: string;
    is_continuation: boolean;
    prior_instruction_detected: boolean;
    unresolved_need: string;
    already_answered_need_detected: boolean;
  } | null;
  replyGoal?: {
    reply_goal: string;
    goal_family: string;
    requires_direct_answer: boolean;
    requires_action_explanation: boolean;
    continuation_style_reply: boolean;
    required_reply_elements: string[];
    forbidden_reply_moves: string[];
  } | null;
  recipientType?: {
    recipient_type: string;
    allowed_tone_profile: string;
    operational_jargon_allowed: boolean;
    direct_instruction_style_preferred: boolean;
  } | null;
  replyLanguage?: string | null;
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

function isPracticalReturnLogisticsFollowUp(assessment: CaseAssessment, selectedOrder?: Record<string, unknown> | null) {
  const types = new Set([assessment.primary_case_type, ...assessment.secondary_case_types]);
  const strongReturnLogisticsScore =
    Number(assessment.intent_scores.return_refund ?? 0) >= 5 &&
    Number(assessment.intent_scores.return_refund ?? 0) >= Number(assessment.intent_scores.tracking_shipping ?? 0);
  if (!types.has("return_refund") && !types.has("general_support") && !strongReturnLogisticsScore) return false;
  if (!selectedOrder) return false;
  const facts = [
    ...(assessment.entities.symptom_phrases || []),
    ...(assessment.entities.context_phrases || []),
  ]
    .map((value) => String(value || "").toLowerCase())
    .join("\n");
  return strongReturnLogisticsScore ||
    /\b(?:send (?:it|the old one|the old headset) back|return the old|old headset|replacement|exchange)\b/i
      .test(facts) ||
    /\b(?:sende den gamle tilbage|sende det gamle headset tilbage|returnere det|gamle headset|erstatning|ombytning)\b/i
      .test(facts);
}

function isAddressClarificationCase(assessment: CaseAssessment, selectedOrder?: Record<string, unknown> | null) {
  if (!selectedOrder) return false;
  const strongOrderChangeScore =
    Number(assessment.intent_scores.order_change ?? 0) >= 5 &&
    Number(assessment.intent_scores.order_change ?? 0) >= Number(assessment.intent_scores.tracking_shipping ?? 0);
  const facts = [
    ...(assessment.entities.context_phrases || []),
    ...(assessment.entities.symptom_phrases || []),
  ]
    .map((value) => String(value || "").toLowerCase())
    .join("\n");
  return strongOrderChangeScore ||
    /\b(?:address|city|state|zip|postal|apo|fpo|dpo|billing address|shipping address)\b/i.test(facts);
}

function isOngoingAddressClarificationFlow(assessment: CaseAssessment, selectedOrder?: Record<string, unknown> | null) {
  if (!selectedOrder) return false;
  if (!isAddressClarificationCase(assessment, selectedOrder)) return false;
  const facts = [
    ...(assessment.entities.context_phrases || []),
    ...(assessment.entities.symptom_phrases || []),
  ]
    .map((value) => String(value || "").toLowerCase())
    .join("\n");
  return /\b(?:alternative shipping address|different delivery address|confirm another address|use this address instead|ship it here instead|broker|carrier)\b/i
      .test(facts) ||
    Number(assessment.intent_scores.order_change ?? 0) >= 6;
}

function isOngoingTechnicalTroubleshootingFlow(assessment: CaseAssessment) {
  if (!hasStrongTechnicalIssue(assessment)) return false;
  const knownTechnicalContext = [
    ...(assessment.entities.context_phrases || []),
    ...(assessment.entities.symptom_phrases || []),
  ]
    .map((value) => String(value || "").toLowerCase())
    .join("\n");
  return Boolean(assessment.entities.tried_fixes) ||
    Boolean(assessment.entities.old_device_works) ||
    /\b(?:dongle|receiver|same frequency|same channel|updated|retried|troubleshooting|replacement|old headset)\b/i
      .test(knownTechnicalContext);
}

function isTechnicalEscalationCase(assessment: CaseAssessment) {
  return hasStrongTechnicalIssue(assessment) && Boolean(assessment.troubleshooting_exhausted);
}

function isDefectReturnContext(assessment: CaseAssessment, selectedOrder?: Record<string, unknown> | null) {
  if (!selectedOrder) return false;
  const types = new Set([assessment.primary_case_type, ...assessment.secondary_case_types]);
  if (types.has("warranty_complaint")) return true;
  const returnLike = types.has("return_refund") || hasAssessmentFact(assessment, [
    /\breplacement\b/,
    /\bexchange\b/,
    /\bfaulty\b/,
    /\bdefective\b/,
    /\bold headset\b/,
    /\berstatning\b/,
    /\bombytning\b/,
    /\bdefekt\b/,
    /\bgamle headset\b/,
  ]);
  return returnLike && (
    hasStrongTechnicalIssue(assessment) ||
    Boolean(assessment.troubleshooting_exhausted) ||
    isPracticalReturnLogisticsFollowUp(assessment, selectedOrder)
  );
}

function isPhysicalDamageCase(assessment: CaseAssessment) {
  const facts = [
    ...(assessment.entities.symptom_phrases || []),
    ...(assessment.entities.context_phrases || []),
  ]
    .map((value) => String(value || "").toLowerCase())
    .join("\n");
  return /\b(?:crack|cracked|cracking|broken hinge|broken plastic|physically damaged|knække|knækket|revne|revnet|sprække|gået i stykker|fysisk skadet)\b/i
    .test(facts);
}

function customerSaysNotDroppedInAssessment(assessment: CaseAssessment) {
  const facts = [
    ...(assessment.entities.symptom_phrases || []),
    ...(assessment.entities.context_phrases || []),
  ]
    .map((value) => String(value || "").toLowerCase())
    .join("\n");
  return /\b(?:not dropped|did not drop|was not dropped|wasn't dropped|didn't drop|ikke tabt|jeg har ikke tabt det|den er ikke blevet tabt)\b/i
    .test(facts);
}

export function buildReplyStrategy(input: BuildReplyStrategyInput): ReplyStrategy {
  const messageUnderstanding = input.messageUnderstanding || null;
  const replyGoal = input.replyGoal || null;
  const recipientType = input.recipientType || null;
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
  const practicalReturnLogisticsFollowUp = isPracticalReturnLogisticsFollowUp(
    input.assessment,
    input.selectedOrder,
  );
  const returnProcessFollowUpMatched =
    input.assessment.latest_message_override_debug?.return_process_followup_matched === true;
  const addressClarificationCase = isAddressClarificationCase(
    input.assessment,
    input.selectedOrder,
  );
  const ongoingAddressClarificationFlow = isOngoingAddressClarificationFlow(
    input.assessment,
    input.selectedOrder,
  );
  const ongoingTechnicalTroubleshootingFlow = isOngoingTechnicalTroubleshootingFlow(
    input.assessment,
  );
  const technicalEscalationCase = isTechnicalEscalationCase(input.assessment);
  const defectReturnContext = isDefectReturnContext(input.assessment, input.selectedOrder);
  const physicalDamageCase = isPhysicalDamageCase(input.assessment);
  const unresolvedNeed = String(messageUnderstanding?.unresolved_need || "").trim();
  const latestUserRequest = String(messageUnderstanding?.latest_user_request || "").trim();
  const replyGoalLabel = String(replyGoal?.reply_goal || "").trim();
  const replyGoalRequiredElements = Array.isArray(replyGoal?.required_reply_elements)
    ? replyGoal.required_reply_elements.filter(Boolean)
    : [];
  const replyGoalForbiddenMoves = Array.isArray(replyGoal?.forbidden_reply_moves)
    ? replyGoal.forbidden_reply_moves.filter(Boolean)
    : [];
  const goalPrefersDirectAnswer = replyGoal?.requires_direct_answer === true;
  const continuationByNewArtifacts =
    messageUnderstanding?.is_continuation === true ||
    replyGoal?.continuation_style_reply === true;
  const damageAssessmentGoal = [
    "request_photo_evidence_for_damage_assessment",
    "assess_physical_damage_claim",
  ].includes(replyGoalLabel);
  const diagnosticQuestions: string[] = [];
  if (strongTechnicalIssue && customerFacingExecutionState === "no_action" && !damageAssessmentGoal) {
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
  const continuationFlowActive =
    practicalReturnLogisticsFollowUp ||
    ongoingAddressClarificationFlow ||
    ongoingTechnicalTroubleshootingFlow ||
    continuationByNewArtifacts;
  const goalDrivenAnswerQuestion = [
    "answer_practical_question",
    "provide_return_logistics",
    "clarify_return_label_availability",
    "explain_shipping_blocker_without_overclaiming",
    "explain_repair_logistics_next_step",
    "request_photo_evidence_for_damage_assessment",
    "assess_physical_damage_claim",
    "continue_troubleshooting",
    "troubleshoot_connectivity_issue",
    "explain_tracking_status",
    "confirm_next_step",
    "explain_blocker_without_overclaiming",
  ].includes(replyGoalLabel);
  const goalDrivenAskForMissingInfo = [
    "ask_for_missing_info",
    "resolve_missing_required_order_field",
  ].includes(replyGoalLabel);
  const goalDrivenMustInclude = goalDrivenAnswerQuestion
    ? uniq([
      ...replyGoalRequiredElements,
      ...(technicalOrProductCase
        ? ["acknowledge_the_specific_reported_issue", "use_concrete_customer_issue_facts"]
        : []),
      ...(continuationByNewArtifacts ? ["continue_the_existing_thread"] : []),
      ...(goalPrefersDirectAnswer ? ["address_current_unresolved_need"] : []),
    ])
    : [];
  const mode =
    missingInputs.length > 0
      ? "ask_for_missing_info"
      : customerFacingExecutionState === "blocked"
      ? "decline_or_block_action"
      : customerFacingExecutionState === "pending_approval" || customerFacingExecutionState === "validated_not_executed"
      ? "state_action_pending"
      : customerFacingExecutionState === "executed"
      ? "confirm_completed_action"
      : goalDrivenAskForMissingInfo
      ? "ask_for_missing_info"
      : goalDrivenAnswerQuestion || goalPrefersDirectAnswer
      ? "answer_question"
      : practicalReturnLogisticsFollowUp
      ? "answer_question"
      : ongoingAddressClarificationFlow || addressClarificationCase
      ? "answer_question"
      : ongoingTechnicalTroubleshootingFlow
      ? "answer_question"
      : technicalEscalationCase
      ? "answer_question"
      : strongTechnicalIssue
      ? "ask_for_missing_info"
      : input.assessment.intent_labels.length > 1 && !continuationFlowActive
      ? "mixed_response"
      : "answer_question";
  const approvedFacts: Array<{ key: string; value: string }> = [];
  const orderName = String(input.selectedOrder?.name || input.selectedOrder?.order_number || "").trim();
  if (orderName) approvedFacts.push({ key: "order_reference", value: orderName });
  if (latestUserRequest) {
    approvedFacts.push({ key: "latest_user_request", value: latestUserRequest });
  }
  if (unresolvedNeed) {
    approvedFacts.push({ key: "unresolved_need", value: unresolvedNeed });
  }
  if (replyGoalLabel) {
    approvedFacts.push({ key: "reply_goal", value: replyGoalLabel });
  }
  if (physicalDamageCase) {
    approvedFacts.push({ key: "physical_damage_claim", value: "true" });
  }
  if (
    customerSaysNotDroppedInAssessment(input.assessment) ||
    /\b(?:not dropped|ikke tabt|did not drop|was not dropped)\b/i.test(
      `${latestUserRequest}\n${unresolvedNeed}`,
    )
  ) {
    approvedFacts.push({ key: "customer_says_not_dropped", value: "true" });
  }
  if (damageAssessmentGoal) {
    approvedFacts.push({ key: "photo_evidence_requested_or_offered", value: "true" });
  }
  if (recipientType?.recipient_type) {
    approvedFacts.push({ key: "recipient_type", value: recipientType.recipient_type });
  }
  if (practicalReturnLogisticsFollowUp) {
    approvedFacts.push({ key: "ongoing_return_or_replacement_flow", value: "true" });
  }
  if (returnProcessFollowUpMatched) {
    approvedFacts.push({ key: "return_process_followup", value: "true" });
  }
  if (defectReturnContext) {
    approvedFacts.push({ key: "defect_return_context", value: "true" });
    approvedFacts.push({
      key: "defect_return_shipping_rule",
      value: String(input.defectReturnShippingRule || "unspecified"),
    });
  }
  approvedFacts.push({
    key: "return_label_method",
    value: String(input.returnLabelMethod || "none"),
  });
  approvedFacts.push({
    key: "return_shipping_mode",
    value: String(input.returnShippingMode || "customer_paid"),
  });
  if (practicalReturnLogisticsFollowUp && String(input.returnAddress || "").trim()) {
    approvedFacts.push({
      key: "return_destination_address",
      value: String(input.returnAddress || "").trim(),
    });
  }
  if (practicalReturnLogisticsFollowUp) {
    const lineItems = Array.isArray((input.selectedOrder as any)?.line_items)
      ? (input.selectedOrder as any).line_items
      : [];
    const firstItemTitle = String(lineItems[0]?.title || lineItems[0]?.name || "").trim();
    if (firstItemTitle) {
      approvedFacts.push({ key: "return_item_name", value: firstItemTitle });
    }
  }
  if (practicalReturnLogisticsFollowUp && String(input.returnLabelMethod || "none") === "none") {
    approvedFacts.push({ key: "customer_arranges_return_shipment", value: "true" });
  }
  if (
    practicalReturnLogisticsFollowUp &&
    orderName &&
    !input.validation.allowed_actions.length
  ) {
    approvedFacts.push({ key: "suggest_include_order_reference_with_parcel", value: "true" });
  }
  if (addressClarificationCase) {
    approvedFacts.push({ key: "address_clarification_issue", value: "true" });
    approvedFacts.push({ key: "address_resolution_preferred", value: "true" });
  }
  if (ongoingAddressClarificationFlow) {
    approvedFacts.push({ key: "ongoing_address_clarification_flow", value: "true" });
  }
  if (ongoingTechnicalTroubleshootingFlow) {
    approvedFacts.push({ key: "ongoing_technical_troubleshooting_flow", value: "true" });
  }
  if (technicalEscalationCase) {
    approvedFacts.push({ key: "troubleshooting_exhausted", value: "true" });
    approvedFacts.push({ key: "technical_escalation_selected", value: "true" });
  }
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
  if (!recipientType?.operational_jargon_allowed) {
    mustNotInclude.push("unnecessary_operational_jargon");
  }
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
  forbiddenClaims.push(...replyGoalForbiddenMoves);

  if (
    customerFacingExecutionState === "pending_approval" ||
    customerFacingExecutionState === "validated_not_executed"
  ) {
    forbiddenClaims.push("provide_return_instructions_before_approval");
    forbiddenClaims.push("provide_return_shipping_address_before_approval");
  }

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
    language: String(input.replyLanguage || input.assessment.language || "same_as_customer"),
    goal:
      unresolvedNeed && goalDrivenAnswerQuestion
        ? `Address the sender's current unresolved need directly: ${unresolvedNeed}`
        : replyGoalLabel === "request_photo_evidence_for_damage_assessment"
        ? "Acknowledge the reported physical damage, note that the customer says the product was not dropped, ask them to reply with photos, and explain that the case will be reviewed after the photos are received."
        : replyGoalLabel === "assess_physical_damage_claim"
        ? "Acknowledge the reported physical damage, note that the customer says the product was not dropped, and explain the next damage-assessment step without switching to firmware troubleshooting."
        : mode === "state_action_pending"
        ? "Explain that the requested action is pending approval or manual review. Do not provide return instructions, shipping addresses, or logistics details yet — those come after approval."
        : replyGoalLabel === "provide_return_logistics"
        ? `Provide practical return logistics that solve the sender's current need: ${unresolvedNeed || latestUserRequest || "Explain how to send the item back."}`
        : replyGoalLabel === "clarify_return_label_availability"
        ? `Clarify return label availability and explain the next practical return step using approved facts only.`
        : replyGoalLabel === "explain_shipping_blocker_without_overclaiming"
        ? `Explain the current shipping or label blocker carefully without overclaiming, and make the next logistics step clear.`
        : replyGoalLabel === "explain_repair_logistics_next_step"
        ? `Explain the next repair or return logistics step clearly and acknowledge urgency or turnaround concern when relevant.`
        : replyGoalLabel === "request_photo_evidence_for_damage_assessment"
        ? `Request photo evidence for the reported physical damage and explain the review step that follows.`
        : replyGoalLabel === "assess_physical_damage_claim"
        ? `Explain the next review step for the reported physical damage claim without switching to generic troubleshooting.`
        : replyGoalLabel === "continue_troubleshooting"
        ? `Continue the existing troubleshooting thread and target the sender's current unresolved need: ${unresolvedNeed || latestUserRequest || "Continue troubleshooting."}`
        : replyGoalLabel === "troubleshoot_connectivity_issue"
        ? `Help resolve the current connectivity issue directly using the latest reported symptoms and already-known context.`
        : replyGoalLabel === "resolve_missing_required_order_field"
        ? `Resolve the operational blocker by asking only for the specific still-missing required field.`
        : replyGoalLabel === "confirm_next_step"
        ? `Explain the current next step clearly and concisely using approved context only.`
        : replyGoalLabel === "explain_tracking_status"
        ? `Answer the sender's current shipment-status question directly using grounded tracking context only.`
        :
      mode === "ask_for_missing_info" && strongTechnicalIssue
        ? "Acknowledge the reported technical issue, reflect the concrete symptoms already provided, and ask 2-4 targeted troubleshooting follow-up questions."
        : mode === "ask_for_missing_info"
        ? "Collect the missing details needed before taking action."
        : practicalReturnLogisticsFollowUp
        ? "Answer the customer's practical return or send-back question directly using the known order context and continue the existing thread naturally."
          + " Explain the practical next steps, not just the destination address."
        : ongoingAddressClarificationFlow || addressClarificationCase
        ? "Answer the shipping or address clarification question directly using the known order context. Do not use tracking-status wording or vague 'we will check' phrasing. Prefer an immediate practical next step."
        : ongoingTechnicalTroubleshootingFlow
        ? "Continue the existing troubleshooting thread using the concrete symptoms and already-known troubleshooting context. Do not restart with generic first-line support questions."
        : technicalEscalationCase
        ? "The technical issue appears unresolved after troubleshooting was already attempted. Continue the thread without restarting first-line troubleshooting and support the escalation path clearly."
        : mode === "decline_or_block_action"
        ? "Explain clearly that the requested action cannot be completed."
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
          ...replyGoalRequiredElements,
        ]
        : damageAssessmentGoal
        ? uniq([
          ...replyGoalRequiredElements,
          "use_concrete_customer_issue_facts",
          "do_not_switch_to_firmware_or_generic_troubleshooting_questions",
          ...(continuationByNewArtifacts ? ["continue_the_existing_thread"] : []),
        ])
        : goalDrivenAnswerQuestion && replyGoalRequiredElements.length
        ? goalDrivenMustInclude
        : practicalReturnLogisticsFollowUp
        ? [
          "answer_the_practical_return_logistics_question_directly",
          "continue_the_existing_thread",
          "use_known_order_context",
          "include_practical_next_steps",
          "include_return_destination_address_when_available",
          "state_if_customer_must_arrange_shipment_when_no_label_is_provided",
          "suggest_including_order_reference_with_the_parcel_when_helpful",
        ]
        : ongoingAddressClarificationFlow || addressClarificationCase
        ? [
          "answer_the_address_or_shipping_issue_directly",
          "use_known_order_context",
          "avoid_tracking_status_language",
          "prefer_immediate_address_resolution_over_we_will_check_wording",
        ]
        : ongoingTechnicalTroubleshootingFlow
        ? [
          "continue_the_existing_troubleshooting_thread",
          "use_concrete_customer_issue_facts",
          "do_not_restart_with_generic_first_line_troubleshooting",
        ]
        : technicalEscalationCase
        ? [
          "acknowledge_that_troubleshooting_has_already_been_attempted",
          "do_not_restart_generic_troubleshooting",
          "support_the_escalation_or_replacement_path_using_known_order_context",
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
    open_questions:
      messageUnderstanding?.already_answered_need_detected
        ? []
        : damageAssessmentGoal
        ? []
        : practicalReturnLogisticsFollowUp
        ? []
        : ongoingAddressClarificationFlow
        ? []
        : ongoingTechnicalTroubleshootingFlow
        ? []
        : technicalEscalationCase
        ? []
        : goalDrivenAnswerQuestion
        ? []
        : goalDrivenAskForMissingInfo
        ? combinedOpenQuestions
        : mode === "ask_for_missing_info"
        ? combinedOpenQuestions
        : missingInputs,
    approved_facts: approvedFacts,
    tone: {
      style:
        recipientType?.allowed_tone_profile === "operational_partner_direct"
          ? "operational_direct"
          : recipientType?.direct_instruction_style_preferred
          ? "direct_support"
          : "concise_support",
      empathy: input.assessment.customer_sentiment === "negative" ? "medium" : "low",
    },
    summary:
      `${mode} for ${replyGoalLabel || input.assessment.case_type}` +
      `${continuationFlowActive ? " (continuation_flow)" : ""}`,
  };
}
