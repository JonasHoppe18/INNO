import {
  cleanLatestMessageBody,
  cleanLatestMessageSubject,
  type CaseAssessment,
} from "./case-assessment.ts";
import type { ActionDecisionValidation } from "./action-validator.ts";
import type { ReplyStrategy } from "./reply-strategy.ts";

export type InboundNormalizedMessageArtifact = {
  artifact_type: "inbound_normalized_message";
  source_shape: "contact_form" | "plain_email" | "reply_email" | "unknown";
  structured_fields_detected: boolean;
  normalized_name: string | null;
  normalized_email: string | null;
  normalized_order_reference: string | null;
  normalized_product: string | null;
  normalized_help_topic: string | null;
  normalized_body: string;
  body_source: "contact_form_body_field" | "raw_body_fallback";
  noise_removed: string[];
  confidence: number;
  explanation: string;
};

export type ReplyLanguageDecisionArtifact = {
  artifact_type: "reply_language_decision";
  detected_latest_message_language: string;
  latest_message_language_confidence: number;
  detected_thread_language: string;
  thread_language_confidence: number;
  legacy_language: string;
  chosen_reply_language: string;
  source_of_truth: "latest_message" | "thread_history" | "legacy";
  confidence: number;
  explanation: string;
};

export type MessageUnderstandingArtifact = {
  artifact_type: "message_understanding";
  latest_user_request: string;
  ask_shape:
    | "question"
    | "followup_question"
    | "status_check"
    | "missing_info_request"
    | "troubleshooting_request"
    | "clarification_request"
    | "operational_request";
  is_continuation: boolean;
  prior_instruction_detected: boolean;
  prior_instruction_summary: string | null;
  unresolved_need: string;
  already_answered_need_detected: boolean;
  message_noise_detected: boolean;
  noise_signals: string[];
  signature_detected: boolean;
  quoted_history_detected: boolean;
  used_normalized_inbound_body?: boolean;
  logistics_continuation_detected?: boolean;
  prior_repair_logistics_context_detected?: boolean;
  prior_label_blocker_detected?: boolean;
  label_availability_signals?: string[];
  process_blocker_signals?: string[];
  urgency_signals?: string[];
  tracking_vs_logistics_reason?: string;
  sender_role_hint: "customer" | "partner" | "warehouse" | "unknown";
  confidence: number;
  explanation: string;
};

export type ReplyGoalArtifact = {
  artifact_type: "reply_goal";
  reply_goal:
    | "answer_practical_question"
    | "provide_return_logistics"
    | "clarify_return_label_availability"
    | "explain_shipping_blocker_without_overclaiming"
    | "explain_repair_logistics_next_step"
    | "request_photo_evidence_for_damage_assessment"
    | "assess_physical_damage_claim"
    | "continue_troubleshooting"
    | "troubleshoot_connectivity_issue"
    | "resolve_missing_required_order_field"
    | "ask_for_missing_info"
    | "explain_tracking_status"
    | "answer_policy_question"
    | "confirm_next_step"
    | "explain_blocker_without_overclaiming";
  secondary_reply_goal: string | null;
  goal_family:
    | "explain"
    | "clarify"
    | "collect"
    | "confirm"
    | "troubleshoot"
    | "operational_resolution";
  requires_direct_answer: boolean;
  requires_action_explanation: boolean;
  continuation_style_reply: boolean;
  required_reply_elements: string[];
  forbidden_reply_moves: string[];
  based_on_case_type: string;
  based_on_message_understanding: string;
  based_on_thread_context: string | null;
  confidence: number;
  explanation: string;
};

export type RecipientTypeArtifact = {
  artifact_type: "recipient_type";
  recipient_type:
    | "customer"
    | "warehouse_partner"
    | "shipping_partner"
    | "vendor"
    | "internal_operator"
    | "unknown";
  confidence: number;
  signals: string[];
  allowed_tone_profile: string;
  operational_jargon_allowed: boolean;
  direct_instruction_style_preferred: boolean;
  explanation: string;
};

const TRACKING_STATUS_RE =
  /\b(?:where is my package|where is the parcel|where is my order|tracking|tracking number|delivery status|hvornår kommer den|har i sendt den|kan jeg få tracking|pakken er ikke kommet|jeg kan ikke finde pakken|tracking virker ikke)\b/i;
const RETURN_GUIDANCE_RE =
  /\b(?:hvordan gør jeg|kan i gå mig igennem|hvad skal jeg gøre|hvordan sender jeg den retur|hvordan returnerer jeg|how do i return it|how do i send it back|walk me through|what do i do)\b/i;
const TECH_REQUEST_RE =
  /\b(?:disconnects|disconnecting|no sound|crackling|shuts off|10 seconds|dongle|same frequency|disconnecter|ingen lyd|knitrer|slukker)\b/i;
const PHYSICAL_DAMAGE_RE =
  /\b(?:crack|cracked|cracking|broken hinge|broken plastic|physically damaged|damage to the shell|knække|knækket|revne|revnet|cracke|sprække|gået i stykker|fysisk skadet)\b/i;
const NOT_DROPPED_RE =
  /\b(?:i did not drop it|it was not dropped|wasn't dropped|didn't drop it|jeg har ikke tabt det|den er ikke blevet tabt|ikke tabt)\b/i;
const PHOTO_EVIDENCE_RE =
  /\b(?:send photos|send pictures|attach photos|attach pictures|reply with photos|i can send photos|i can attach photos|vedhæfte billeder|sende billeder|sende fotos|jeg kan sende billeder|jeg kan vedhæfte billeder|når i svarer kan jeg sende billeder)\b/i;
const ADDRESS_RE =
  /\b(?:address|shipping address|billing address|city:|state:|zip(?: code)?|postal code|address1|address2|adresse|postnummer|by:|stat:|brug denne adresse|use this address instead)\b/i;
const SIGNATURE_RE =
  /(?:^|\n)(?:best regards|kind regards|regards|venlig hilsen|mvh|med venlig hilsen|thanks[,!]?$|tak[,!]?$)/i;
const REPEAT_ANSWER_RE =
  /\b(?:again|once more|remind me|hvad var adressen|kan du gentage|kan i gentage)\b/i;
const LABEL_AVAILABILITY_RE =
  /\b(?:can you send a label now|could you send a label now|would it be possible to send a label now|is label possible now|is it now possible to send a label|send a label now|kan i sende en label nu|kan du sende en label nu|er det muligt at sende en label nu|kan i sende en returlabel nu|er returlabel mulig nu)\b/i;
const SHIPPING_BLOCKER_RE =
  /\b(?:has the shipping issue been resolved|has the shipping problem been resolved|is the shipping issue resolved|shipping issue resolved|is the issue resolved now|er shipping problemet løst|er forsendelsesproblemet løst|er problemet løst nu|kan det lade sig gøre nu)\b/i;
const PROCESS_URGENCY_RE =
  /\b(?:i need a speedy process|i need a fast process|i use the headset daily|how long will it take once sent|how long will it take when sent|jeg bruger headsettet dagligt|jeg har brug for en hurtig proces|hvor lang tid tager det når det er sendt|hvor lang tid tager det når jeg har sendt det)\b/i;
const CONTACT_FORM_FIELD_LABELS = [
  { key: "country_code", pattern: /^country code\b\s*:?\s*(.*)$/i },
  { key: "name", pattern: /^name\b\s*:?\s*(.*)$/i },
  { key: "email", pattern: /^email\b\s*:?\s*(.*)$/i },
  { key: "company_team", pattern: /^company\s*\/\s*team\b\s*:?\s*(.*)$/i },
  { key: "your_country", pattern: /^your country\b\s*:?\s*(.*)$/i },
  {
    key: "purchase_order",
    pattern: /^if applicable,\s*place of purchase and order number\b\s*:?\s*(.*)$/i,
  },
  {
    key: "request_regarding",
    pattern: /^what is your request regarding\??\b\s*:?\s*(.*)$/i,
  },
  {
    key: "help_topic",
    pattern: /^what do you need help with\??\b\s*:?\s*(.*)$/i,
  },
  { key: "body", pattern: /^body\b\s*:?\s*(.*)$/i },
] as const;
const CONTACT_FORM_NOISE_LABELS = [
  "country_code",
  "name",
  "email",
  "company_team",
  "your_country",
  "purchase_order",
  "request_regarding",
  "help_topic",
  "body",
];

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function normalizeInlineFieldValue(value: string) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanNormalizedBodyText(value: string) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => String(line || "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractContactFormFields(body: string) {
  const lines = String(body || "").replace(/\r\n/g, "\n").split("\n");
  const extracted: Record<string, string> = {};
  let detectedLabels = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = String(lines[index] || "").trim();
    if (!line) continue;
    let matchedLabel: { key: string; value: string } | null = null;
    for (const label of CONTACT_FORM_FIELD_LABELS) {
      const match = line.match(label.pattern);
      if (match) {
        matchedLabel = {
          key: label.key,
          value: normalizeInlineFieldValue(match[1] || ""),
        };
        break;
      }
    }
    if (!matchedLabel) continue;
    detectedLabels += 1;
    const collected: string[] = [];
    if (matchedLabel.value) collected.push(matchedLabel.value);
    let cursor = index + 1;
    while (cursor < lines.length) {
      const nextLine = String(lines[cursor] || "");
      const trimmed = nextLine.trim();
      if (!trimmed) {
        cursor += 1;
        if (matchedLabel.key !== "body" && collected.length > 0) break;
        continue;
      }
      const nextIsLabel = CONTACT_FORM_FIELD_LABELS.some((label) => label.pattern.test(trimmed));
      if (nextIsLabel) break;
      collected.push(trimmed);
      cursor += 1;
      if (matchedLabel.key !== "body" && collected.length >= 4) break;
    }
    extracted[matchedLabel.key] = cleanNormalizedBodyText(collected.join("\n"));
    index = Math.max(index, cursor - 1);
  }
  return { extracted, detectedLabels };
}

function inferSourceShape(body: string, structuredDetected: boolean, quotedHistoryDetected: boolean) {
  if (structuredDetected) return "contact_form" as const;
  if (quotedHistoryDetected) return "reply_email" as const;
  if (String(body || "").trim()) return "plain_email" as const;
  return "unknown" as const;
}

function extractOrderReferenceFromText(value: string) {
  const match = String(value || "").match(/#?(\d{3,})\b/);
  return match?.[1] ? match[1] : null;
}

function detectLanguageFromText(text: string): { language: string; confidence: number } {
  const value = String(text || "").trim().toLowerCase();
  if (!value) return { language: "unknown", confidence: 0.2 };
  const danishSignals = [
    /\b(?:hej|ikke|med|jeg|kan|hvad|hvordan|returlabel|forsendelse|headsettet|dagligt)\b/i,
    /[æøå]/i,
  ];
  const englishSignals = [
    /\b(?:hi|hello|the|and|what|how|label|shipping|issue|resolved|daily|process)\b/i,
  ];
  const danishScore = danishSignals.reduce((score, pattern) => score + (pattern.test(value) ? 1 : 0), 0);
  const englishScore = englishSignals.reduce((score, pattern) => score + (pattern.test(value) ? 1 : 0), 0);
  if (danishScore > englishScore) return { language: "da", confidence: 0.82 };
  if (englishScore > danishScore) return { language: "en", confidence: 0.82 };
  return { language: "unknown", confidence: 0.35 };
}

function detectContinuationLogisticsSignals(cleanBody: string, assessment: CaseAssessment) {
  const body = String(cleanBody || "");
  const priorThreadText = String(assessment.cleanup_debug?.raw_body_preview || "");
  const combinedThreadContext = `${body}\n${priorThreadText}`;
  const labelSignals: string[] = [];
  const processBlockerSignals: string[] = [];
  const urgencySignals: string[] = [];
  if (LABEL_AVAILABILITY_RE.test(body)) labelSignals.push("label_availability");
  if (SHIPPING_BLOCKER_RE.test(body)) processBlockerSignals.push("shipping_blocker");
  if (PROCESS_URGENCY_RE.test(body)) urgencySignals.push("urgency_or_turnaround");
  const priorRepairLogisticsContextDetected =
    assessment.latest_message_override_debug?.return_context_detected === true ||
    assessment.primary_case_type === "return_refund" ||
    assessment.historical_context_intents.includes("return_refund") ||
    /\b(?:repair|return|send-in|shipment label|return label|returlabel|repair flow|repair process|send it in|send the headset in|arrange shipment|arrange shipping|return shipment|repair return)\b/i
      .test(combinedThreadContext);
  const priorLabelBlockerDetected =
    /\b(?:unable to create label|cannot create label|can't create label|label issue|shipping issue|returlabel.*ikke mulig|kan ikke oprette label|kan ikke lave label|cannot send a label yet|not possible to send a label)\b/i
      .test(combinedThreadContext);
  const trackingStatusPresent = TRACKING_STATUS_RE.test(body);
  const logisticsDetected =
    (priorRepairLogisticsContextDetected || priorLabelBlockerDetected) &&
    (labelSignals.length > 0 || processBlockerSignals.length > 0 || urgencySignals.length > 0) &&
    !trackingStatusPresent;
  return {
    logisticsDetected,
    priorRepairLogisticsContextDetected,
    priorLabelBlockerDetected,
    labelSignals,
    processBlockerSignals,
    urgencySignals,
    trackingStatusPresent,
    returnContextPresent: priorRepairLogisticsContextDetected,
  };
}

function firstMeaningfulSentence(text: string) {
  const normalized = String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
  if (!normalized) return "";
  const questionMatch = normalized.match(/[^.?!]*\?/);
  if (questionMatch?.[0]) return questionMatch[0].trim();
  const sentenceMatch = normalized.match(/[^.?!]+[.?!]?/);
  return String(sentenceMatch?.[0] || normalized).trim();
}

function hasPhysicalDamageSignals(assessment: CaseAssessment) {
  const values = [
    ...(assessment.entities.symptom_phrases || []),
    ...(assessment.entities.context_phrases || []),
    ...(assessment.entities.product_queries || []),
  ]
    .map((value) => String(value || ""))
    .join("\n");
  return PHYSICAL_DAMAGE_RE.test(values);
}

function hasPhotoEvidenceOffer(assessment: CaseAssessment) {
  const values = [
    ...(assessment.entities.symptom_phrases || []),
    ...(assessment.entities.context_phrases || []),
  ]
    .map((value) => String(value || ""))
    .join("\n");
  return PHOTO_EVIDENCE_RE.test(values);
}

function summarizeLatestUserRequest(cleanSubject: string, cleanBody: string, assessment: CaseAssessment) {
  const combined = [cleanSubject, cleanBody].filter(Boolean).join("\n").trim();
  const firstSentence = firstMeaningfulSentence(combined);
  const logisticsSignals = detectContinuationLogisticsSignals(combined, assessment);
  if (PHYSICAL_DAMAGE_RE.test(combined)) {
    return PHOTO_EVIDENCE_RE.test(combined)
      ? "Customer reports physical damage or cracking and wants to send photo evidence."
      : "Customer reports physical damage or cracking and needs the next assessment step.";
  }
  if (logisticsSignals.logisticsDetected && logisticsSignals.labelSignals.length > 0) {
    return "Customer wants to know whether a return or repair label can be sent now and what the next logistics step is.";
  }
  if (logisticsSignals.logisticsDetected && logisticsSignals.processBlockerSignals.length > 0) {
    return "Customer wants to know whether the shipping or repair logistics blocker has been resolved and how to proceed.";
  }
  if (assessment.latest_message_override_debug?.return_process_followup_matched) {
    return "Customer wants practical guidance on how to return or send the item back.";
  }
  if (assessment.primary_case_type === "tracking_shipping" || TRACKING_STATUS_RE.test(combined)) {
    return "Customer wants a shipment or tracking status update.";
  }
  if (
    assessment.primary_case_type === "order_change" &&
    (ADDRESS_RE.test(combined) || assessment.entities.address_candidate)
  ) {
    return "Customer wants to clarify or change shipping-related order details.";
  }
  if (assessment.primary_case_type === "technical_issue" || TECH_REQUEST_RE.test(combined)) {
    return "Customer is asking for help with a concrete product issue.";
  }
  if (assessment.primary_case_type === "return_refund") {
    return "Customer wants help with a return or send-back process.";
  }
  return firstSentence || "Customer is asking for support on the current thread topic.";
}

function inferAskShape(cleanBody: string, assessment: CaseAssessment): MessageUnderstandingArtifact["ask_shape"] {
  const body = String(cleanBody || "").trim();
  const logisticsSignals = detectContinuationLogisticsSignals(body, assessment);
  if (TRACKING_STATUS_RE.test(body)) return "status_check";
  if (logisticsSignals.logisticsDetected) return "operational_request";
  if (PHYSICAL_DAMAGE_RE.test(body)) {
    return PHOTO_EVIDENCE_RE.test(body) ? "operational_request" : "clarification_request";
  }
  if (TECH_REQUEST_RE.test(body) && /\?/.test(body)) return "troubleshooting_request";
  if (ADDRESS_RE.test(body)) return "clarification_request";
  if (RETURN_GUIDANCE_RE.test(body)) {
    return assessment.historical_context_intents.length > 0 ? "followup_question" : "question";
  }
  if (/\b(?:missing|mangler|need|requires|required|phone number|telefonnummer)\b/i.test(body)) {
    return "missing_info_request";
  }
  if (/\?/.test(body)) {
    return assessment.historical_context_intents.length > 0 ? "followup_question" : "question";
  }
  if (
    assessment.primary_case_type === "return_refund" ||
    assessment.primary_case_type === "order_change"
  ) return "operational_request";
  return "question";
}

function inferPriorInstructionSummary(assessment: CaseAssessment): string | null {
  if (
    assessment.primary_case_type === "warranty_complaint" ||
    (assessment.primary_case_type === "technical_issue" && hasPhysicalDamageSignals(assessment))
  ) {
    return "Prior thread likely involves warranty or damage review context.";
  }
  if (assessment.latest_message_override_debug?.return_context_detected) {
    return "Prior thread already contains return or exchange guidance.";
  }
  if (assessment.primary_case_type === "technical_issue" && assessment.entities.tried_fixes) {
    return "Prior thread already contains troubleshooting context or attempted steps.";
  }
  if (
    assessment.primary_case_type === "order_change" &&
    assessment.entities.address_candidate
  ) {
    return "Prior thread already contains operational order or address handling context.";
  }
  if (assessment.historical_context_intents.length) {
    return `Prior thread context exists around: ${assessment.historical_context_intents.join(", ")}.`;
  }
  return null;
}

function inferUnresolvedNeed(
  latestUserRequest: string,
  assessment: CaseAssessment,
  askShape: MessageUnderstandingArtifact["ask_shape"],
) {
  const logisticsSignals = detectContinuationLogisticsSignals(latestUserRequest, assessment);
  if (hasPhysicalDamageSignals(assessment) || PHYSICAL_DAMAGE_RE.test(latestUserRequest)) {
    return PHOTO_EVIDENCE_RE.test(latestUserRequest) || hasPhotoEvidenceOffer(assessment)
      ? "The sender needs the next damage-assessment step and a clear way to send photo evidence."
      : "The sender needs the next step for reviewing a physical damage claim.";
  }
  if (logisticsSignals.logisticsDetected && logisticsSignals.labelSignals.length > 0) {
    return "The sender needs a clear answer on whether a return or repair label can be provided now and what the next logistics step is.";
  }
  if (logisticsSignals.logisticsDetected) {
    return "The sender needs a clear explanation of the current logistics blocker, next step, and likely turnaround without overclaiming.";
  }
  if (assessment.latest_message_override_debug?.return_process_followup_matched) {
    return "The sender still needs practical next-step return instructions.";
  }
  if (assessment.primary_case_type === "tracking_shipping") {
    return "The sender still needs a tracking or delivery status answer.";
  }
  if (assessment.primary_case_type === "order_change") {
    return "The sender still needs a clear operational answer about the order or address issue.";
  }
  if (assessment.primary_case_type === "technical_issue") {
    return askShape === "troubleshooting_request"
      ? "The sender still needs concrete troubleshooting or resolution guidance."
      : "The sender still needs help resolving the technical issue.";
  }
  return latestUserRequest;
}

function inferSenderRoleHint(recipientType: RecipientTypeArtifact["recipient_type"]): MessageUnderstandingArtifact["sender_role_hint"] {
  switch (recipientType) {
    case "warehouse_partner":
      return "warehouse";
    case "shipping_partner":
    case "vendor":
      return "partner";
    case "customer":
      return "customer";
    default:
      return "unknown";
  }
}

export function buildRecipientTypeArtifact(input: {
  from?: string | null;
  fromEmail?: string | null;
  subject?: string | null;
  body?: string | null;
}): RecipientTypeArtifact {
  const from = String(input.from || "").trim();
  const fromEmail = String(input.fromEmail || "").trim().toLowerCase();
  const combined = `${input.subject || ""}\n${input.body || ""}\n${from}`.toLowerCase();
  const signals: string[] = [];
  let recipientType: RecipientTypeArtifact["recipient_type"] = "unknown";
  let confidence = 0.45;

  if (
    /\b(?:warehouse|fulfillment|3pl|lager|pluk|pack|picking|logistics team)\b/i.test(combined) ||
    /\b(?:warehouse|fulfillment|3pl|lager|logistics)\b/i.test(fromEmail)
  ) {
    recipientType = "warehouse_partner";
    confidence = 0.9;
    signals.push("warehouse_terms_detected");
  } else if (
    /\b(?:dhl|ups|fedex|gls|dpd|postnord|bring|usps|carrier|shipment hold|shipping broker)\b/i.test(combined) ||
    /\b(?:dhl|ups|fedex|gls|dpd|postnord|bring|usps)\b/i.test(fromEmail)
  ) {
    recipientType = "shipping_partner";
    confidence = 0.9;
    signals.push("shipping_partner_terms_detected");
  } else if (
    /\b(?:vendor|supplier|manufacturer|leverandør|distributor)\b/i.test(combined) ||
    /\b(?:vendor|supplier|manufacturer)\b/i.test(fromEmail)
  ) {
    recipientType = "vendor";
    confidence = 0.82;
    signals.push("vendor_terms_detected");
  } else if (
    /\b(?:support agent|support team|customer support|internal note|operator)\b/i.test(combined)
  ) {
    recipientType = "internal_operator";
    confidence = 0.7;
    signals.push("internal_operator_terms_detected");
  } else if (fromEmail) {
    recipientType = "customer";
    confidence = 0.62;
    signals.push("default_external_sender");
  }

  return {
    artifact_type: "recipient_type",
    recipient_type: recipientType,
    confidence,
    signals,
    allowed_tone_profile:
      recipientType === "customer"
        ? "customer_support_plain"
        : recipientType === "internal_operator"
        ? "internal_compact"
        : "operational_partner_direct",
    operational_jargon_allowed: recipientType !== "customer" && recipientType !== "unknown",
    direct_instruction_style_preferred: recipientType !== "customer",
    explanation:
      recipientType === "customer"
        ? "The sender looks like an external end customer, so customer-facing tone is appropriate."
        : `The sender appears to be ${recipientType.replace(/_/g, " ")} based on grounded sender cues.`,
  };
}

export function buildInboundNormalizedMessageArtifact(input: {
  subject?: string | null;
  body?: string | null;
  caseAssessment: CaseAssessment;
}): InboundNormalizedMessageArtifact {
  const rawBody = String(input.body || "");
  const cleanedRawBody = cleanLatestMessageBody(rawBody).cleanBodyText;
  const { extracted, detectedLabels } = extractContactFormFields(rawBody);
  const structuredFieldsDetected =
    detectedLabels >= 4 &&
    Boolean(extracted.body || extracted.help_topic || extracted.request_regarding);
  const normalizedBodyFromField = cleanNormalizedBodyText(extracted.body || "");
  const normalizedBody = normalizedBodyFromField || cleanedRawBody;
  const bodySource = normalizedBodyFromField
    ? "contact_form_body_field"
    : "raw_body_fallback";
  const normalizedHelpTopic = normalizeInlineFieldValue(
    extracted.help_topic || extracted.request_regarding || "",
  ) || null;
  const normalizedProduct = normalizeInlineFieldValue(
    extracted.request_regarding ||
      extracted.help_topic?.match(/\b(?:A-?Spire Wireless|A-?Rise|A-?Live)\b/i)?.[0] ||
      "",
  ) || null;
  const confidence = clamp(
    structuredFieldsDetected
      ? 0.62 + (normalizedBodyFromField ? 0.16 : 0) + Math.min(detectedLabels, 8) * 0.02
      : 0.38,
  );

  return {
    artifact_type: "inbound_normalized_message",
    source_shape: inferSourceShape(
      rawBody,
      structuredFieldsDetected,
      Boolean(input.caseAssessment.cleanup_debug?.quoted_history_detected),
    ),
    structured_fields_detected: structuredFieldsDetected,
    normalized_name: normalizeInlineFieldValue(extracted.name || "") || null,
    normalized_email: normalizeInlineFieldValue(extracted.email || "") || null,
    normalized_order_reference: extractOrderReferenceFromText(extracted.purchase_order || ""),
    normalized_product: normalizedProduct,
    normalized_help_topic: normalizedHelpTopic,
    normalized_body: normalizedBody,
    body_source: bodySource,
    noise_removed: structuredFieldsDetected ? CONTACT_FORM_NOISE_LABELS : [],
    confidence,
    explanation: structuredFieldsDetected
      ? normalizedBodyFromField
        ? "Detected contact-form style fields and used the Body field as the primary customer message."
        : "Detected contact-form style fields, but the Body field was missing or unusable, so cleaned raw body was used."
      : "No reliable contact-form structure detected, so cleaned raw body was used.",
  };
}

export function buildReplyLanguageDecisionArtifact(input: {
  subject?: string | null;
  body?: string | null;
  caseAssessment: CaseAssessment;
  inboundNormalizedMessage?: InboundNormalizedMessageArtifact | null;
}): ReplyLanguageDecisionArtifact {
  const latestMessageText = String(
    input.inboundNormalizedMessage?.normalized_body ||
      cleanLatestMessageBody(String(input.body || "")).cleanBodyText ||
      "",
  ).trim();
  const threadText = `${input.subject || ""}\n${input.body || ""}`.trim();
  const latestLanguage = detectLanguageFromText(latestMessageText);
  const threadLanguage = detectLanguageFromText(threadText);
  const legacyLanguage = String(input.caseAssessment.language || "unknown").trim().toLowerCase();
  const chosenReplyLanguage =
    latestLanguage.language !== "unknown"
      ? latestLanguage.language
      : threadLanguage.language !== "unknown"
      ? threadLanguage.language
      : legacyLanguage || "same_as_customer";
  const sourceOfTruth =
    latestLanguage.language !== "unknown"
      ? "latest_message"
      : threadLanguage.language !== "unknown"
      ? "thread_history"
      : "legacy";
  const confidence =
    sourceOfTruth === "latest_message"
      ? latestLanguage.confidence
      : sourceOfTruth === "thread_history"
      ? threadLanguage.confidence
      : 0.6;
  return {
    artifact_type: "reply_language_decision",
    detected_latest_message_language: latestLanguage.language,
    latest_message_language_confidence: latestLanguage.confidence,
    detected_thread_language: threadLanguage.language,
    thread_language_confidence: threadLanguage.confidence,
    legacy_language: legacyLanguage,
    chosen_reply_language: chosenReplyLanguage,
    source_of_truth: sourceOfTruth,
    confidence,
    explanation:
      sourceOfTruth === "latest_message"
        ? "Reply language follows the latest cleaned customer message."
        : sourceOfTruth === "thread_history"
        ? "Latest message language was weak or ambiguous, so recent thread text was used."
        : "Latest message and thread language were ambiguous, so legacy language was used as fallback.",
  };
}

export function buildMessageUnderstandingArtifact(input: {
  subject?: string | null;
  body?: string | null;
  caseAssessment: CaseAssessment;
  recipientType: RecipientTypeArtifact;
  inboundNormalizedMessage?: InboundNormalizedMessageArtifact | null;
}): MessageUnderstandingArtifact {
  const normalizedInboundBody = String(input.inboundNormalizedMessage?.normalized_body || "").trim();
  const useNormalizedInboundBody =
    Boolean(normalizedInboundBody) &&
    input.inboundNormalizedMessage?.source_shape === "contact_form" &&
    input.inboundNormalizedMessage?.structured_fields_detected === true;
  const cleanedBody = useNormalizedInboundBody
    ? normalizedInboundBody
    : cleanLatestMessageBody(String(input.body || "")).cleanBodyText;
  const cleanedSubject = cleanLatestMessageSubject(String(input.subject || ""));
  const latestUserRequest = summarizeLatestUserRequest(
    cleanedSubject,
    cleanedBody,
    input.caseAssessment,
  );
  const askShape = inferAskShape(cleanedBody, input.caseAssessment);
  const priorInstructionSummary = inferPriorInstructionSummary(input.caseAssessment);
  const priorInstructionDetected = Boolean(priorInstructionSummary);
  const quotedHistoryDetected = Boolean(input.caseAssessment.cleanup_debug?.quoted_history_detected);
  const signatureDetected = SIGNATURE_RE.test(String(input.body || ""));
  const noiseSignals = [
    ...(quotedHistoryDetected ? ["quoted_history"] : []),
    ...(signatureDetected ? ["signature"] : []),
    ...(input.caseAssessment.cleanup_debug?.parser_strategy === "raw_body_prefix" ? ["raw_body_prefix_cleanup"] : []),
  ];
  const messageNoiseDetected = noiseSignals.length > 0;
  const alreadyAnsweredNeedDetected = REPEAT_ANSWER_RE.test(cleanedBody);
  const isContinuation =
    input.caseAssessment.historical_context_intents.length > 0 ||
    input.caseAssessment.latest_message_override_debug?.return_context_detected === true ||
    input.caseAssessment.current_message_should_override_thread_route;
  const unresolvedNeed = inferUnresolvedNeed(latestUserRequest, input.caseAssessment, askShape);
  const logisticsSignals = detectContinuationLogisticsSignals(cleanedBody, input.caseAssessment);
  const physicalDamageDetected = PHYSICAL_DAMAGE_RE.test(cleanedBody) || hasPhysicalDamageSignals(input.caseAssessment);
  const photoEvidenceOffered = PHOTO_EVIDENCE_RE.test(cleanedBody) || hasPhotoEvidenceOffer(input.caseAssessment);
  const notDroppedClaimDetected = NOT_DROPPED_RE.test(cleanedBody);
  const confidence = clamp(
    0.45 +
      (cleanedBody.trim().length > 20 ? 0.12 : 0) +
      (priorInstructionDetected ? 0.1 : 0) +
      (messageNoiseDetected ? -0.06 : 0) +
      Number(input.caseAssessment.latest_message_confidence || 0) * 0.28,
  );

  return {
    artifact_type: "message_understanding",
    latest_user_request: latestUserRequest,
    ask_shape: askShape,
    is_continuation: isContinuation,
    prior_instruction_detected: priorInstructionDetected,
    prior_instruction_summary: priorInstructionSummary,
    unresolved_need: unresolvedNeed,
    already_answered_need_detected: alreadyAnsweredNeedDetected,
    message_noise_detected: messageNoiseDetected,
    noise_signals: noiseSignals,
    signature_detected: signatureDetected,
    quoted_history_detected: quotedHistoryDetected,
    used_normalized_inbound_body: useNormalizedInboundBody,
    logistics_continuation_detected: logisticsSignals.logisticsDetected,
    prior_repair_logistics_context_detected: logisticsSignals.priorRepairLogisticsContextDetected,
    prior_label_blocker_detected: logisticsSignals.priorLabelBlockerDetected,
    label_availability_signals: logisticsSignals.labelSignals,
    process_blocker_signals: logisticsSignals.processBlockerSignals,
    urgency_signals: logisticsSignals.urgencySignals,
    tracking_vs_logistics_reason: logisticsSignals.logisticsDetected
      ? "Treated as return or repair logistics continuation because label/process signals were present in a return-context thread without a real parcel-status ask."
      : logisticsSignals.trackingStatusPresent
      ? "Tracking-status phrasing was present in the latest message."
      : "No strong continuation logistics signal detected.",
    sender_role_hint: inferSenderRoleHint(input.recipientType.recipient_type),
    confidence,
    explanation:
      physicalDamageDetected
        ? photoEvidenceOffered
          ? `The latest cleaned message indicates a physical damage claim${notDroppedClaimDetected ? ", states it was not dropped," : ""} and offers photo evidence.`
          : `The latest cleaned message indicates a physical damage claim${notDroppedClaimDetected ? " and states it was not dropped" : ""}, so the next need is damage assessment rather than generic troubleshooting.`
        : logisticsSignals.logisticsDetected
        ? "The latest cleaned message is a continuation logistics question about label availability, process blocker resolution, or turnaround rather than parcel tracking."
        : useNormalizedInboundBody
        ? "This artifact summarizes the latest ask using normalized inbound Body content rather than the contact-form wrapper."
        : "This artifact summarizes the latest cleaned ask in context, rather than relying only on a one-label message intent.",
  };
}

function mapGoalFamily(goal: ReplyGoalArtifact["reply_goal"]): ReplyGoalArtifact["goal_family"] {
  if (goal === "request_photo_evidence_for_damage_assessment" || goal === "assess_physical_damage_claim") {
    return "clarify";
  }
  if (goal === "clarify_return_label_availability") return "clarify";
  if (goal === "explain_shipping_blocker_without_overclaiming") return "explain";
  if (goal === "explain_repair_logistics_next_step") return "operational_resolution";
  if (goal === "ask_for_missing_info" || goal === "resolve_missing_required_order_field") return "collect";
  if (goal === "continue_troubleshooting" || goal === "troubleshoot_connectivity_issue") return "troubleshoot";
  if (goal === "confirm_next_step") return "confirm";
  if (goal === "provide_return_logistics") return "operational_resolution";
  return "explain";
}

function inferReplyGoalLabel(input: {
  assessment: CaseAssessment;
  messageUnderstanding: MessageUnderstandingArtifact;
  replyStrategy?: ReplyStrategy | null;
  validation?: ActionDecisionValidation | null;
}): ReplyGoalArtifact["reply_goal"] {
  const facts = input.replyStrategy?.approved_facts || [];
  const hasFact = (key: string, value = "true") =>
    facts.some((fact) => String(fact?.key || "") === key && String(fact?.value || "") === value);
  const logisticsContinuation =
    input.messageUnderstanding.logistics_continuation_detected === true;
  const labelAvailabilitySignals = input.messageUnderstanding.label_availability_signals || [];
  const processBlockerSignals = input.messageUnderstanding.process_blocker_signals || [];
  if (hasFact("return_process_followup") || hasFact("ongoing_return_or_replacement_flow")) {
    return "provide_return_logistics";
  }
  if (logisticsContinuation && labelAvailabilitySignals.length > 0) {
    return "clarify_return_label_availability";
  }
  if (logisticsContinuation && processBlockerSignals.length > 0) {
    return "explain_shipping_blocker_without_overclaiming";
  }
  if (logisticsContinuation && (input.messageUnderstanding.urgency_signals || []).length > 0) {
    return "explain_repair_logistics_next_step";
  }
  if (
    (hasPhysicalDamageSignals(input.assessment) ||
      PHYSICAL_DAMAGE_RE.test(input.messageUnderstanding.latest_user_request)) &&
    (hasPhotoEvidenceOffer(input.assessment) ||
      PHOTO_EVIDENCE_RE.test(input.messageUnderstanding.latest_user_request))
  ) {
    return "request_photo_evidence_for_damage_assessment";
  }
  if (
    hasPhysicalDamageSignals(input.assessment) ||
    PHYSICAL_DAMAGE_RE.test(input.messageUnderstanding.latest_user_request)
  ) {
    return "assess_physical_damage_claim";
  }
  if (
    input.assessment.primary_case_type === "return_refund" &&
    facts.some((fact) => String(fact?.key || "") === "return_label_method")
  ) {
    return "clarify_return_label_availability";
  }
  if (hasFact("ongoing_technical_troubleshooting_flow")) {
    return "continue_troubleshooting";
  }
  if (
    input.assessment.primary_case_type === "technical_issue" &&
    TECH_REQUEST_RE.test(input.messageUnderstanding.latest_user_request)
  ) {
    return "troubleshoot_connectivity_issue";
  }
  if (input.assessment.primary_case_type === "technical_issue") {
    return input.messageUnderstanding.is_continuation
      ? "continue_troubleshooting"
      : "answer_practical_question";
  }
  if (
    input.assessment.primary_case_type === "tracking_shipping" ||
    input.messageUnderstanding.ask_shape === "status_check"
  ) {
    return "explain_tracking_status";
  }
  if (
    input.assessment.primary_case_type === "order_change" &&
    input.messageUnderstanding.ask_shape === "missing_info_request"
  ) {
    return "resolve_missing_required_order_field";
  }
  if (input.replyStrategy?.mode === "ask_for_missing_info") return "ask_for_missing_info";
  if (
    input.validation &&
    input.validation.allowed_actions.length > 0 &&
    input.replyStrategy &&
    input.replyStrategy.execution_state !== "no_action"
  ) {
    return "confirm_next_step";
  }
  if (input.assessment.primary_case_type === "return_refund") return "answer_practical_question";
  if (input.assessment.primary_case_type === "general_support") return "answer_practical_question";
  return "answer_policy_question";
}

function requiredReplyElementsForGoal(goal: ReplyGoalArtifact["reply_goal"], facts: ReplyStrategy["approved_facts"] = []) {
  const hasFact = (key: string, value = "true") =>
    facts.some((fact) => String(fact?.key || "") === key && String(fact?.value || "") === value);
  switch (goal) {
    case "request_photo_evidence_for_damage_assessment":
      return [
        "acknowledge_physical_damage_report",
        "acknowledge_customer_says_not_dropped",
        "invite_customer_to_reply_with_photo_evidence",
        "state_case_will_be_reviewed_after_photos",
      ];
    case "assess_physical_damage_claim":
      return [
        "acknowledge_physical_damage_report",
        "acknowledge_customer_says_not_dropped",
        "explain_next_damage_assessment_step",
      ];
    case "provide_return_logistics":
      return [
        "direct_practical_answer",
        ...(hasFact("return_destination_address") ? ["return_destination_address"] : []),
        ...(hasFact("customer_arranges_return_shipment") ? ["shipment_arrangement_instruction"] : []),
        ...(hasFact("suggest_include_order_reference_with_parcel") ? ["parcel_reference_hint"] : []),
      ];
    case "continue_troubleshooting":
      return ["acknowledge_current_issue_state", "continue_existing_troubleshooting_context"];
    case "troubleshoot_connectivity_issue":
      return ["acknowledge_connectivity_issue", "provide_next_troubleshooting_step"];
    case "resolve_missing_required_order_field":
      return ["state_missing_required_field", "request_specific_missing_field_only"];
    case "explain_tracking_status":
      return ["tracking_status_answer_or_limit"];
    case "confirm_next_step":
      return ["explain_current_next_step"];
    case "clarify_return_label_availability":
      return ["state_label_availability", "state_next_return_step"];
    case "explain_shipping_blocker_without_overclaiming":
      return ["explain_current_blocker_carefully", "state_next_logistics_step"];
    case "explain_repair_logistics_next_step":
      return ["state_next_logistics_step", "acknowledge_turnaround_or_urgency_when_relevant"];
    case "explain_blocker_without_overclaiming":
      return ["explain_current_blocker_carefully", "state_next_logistics_step", "acknowledge_turnaround_or_urgency_when_relevant"];
    case "ask_for_missing_info":
      return ["ask_only_for_missing_info"];
    default:
      return ["answer_customer_need_directly"];
  }
}

export function buildReplyGoalArtifact(input: {
  assessment: CaseAssessment;
  messageUnderstanding: MessageUnderstandingArtifact;
  recipientType: RecipientTypeArtifact;
  replyStrategy?: ReplyStrategy | null;
  validation?: ActionDecisionValidation | null;
}): ReplyGoalArtifact {
  const replyGoal = inferReplyGoalLabel(input);
  const replyStrategy = input.replyStrategy;
  const continuationStyleReply =
    input.messageUnderstanding.is_continuation ||
    (replyStrategy?.approved_facts || []).some((fact) =>
      /^ongoing_/.test(String(fact?.key || "")) && String(fact?.value || "") === "true"
    );
  const requiresActionExplanation =
    Boolean(input.validation?.allowed_actions?.length) &&
    replyStrategy?.execution_state !== "no_action";
  const secondaryReplyGoal =
    replyGoal === "provide_return_logistics" &&
      (replyStrategy?.approved_facts || []).some((fact) =>
        String(fact?.key || "") === "return_label_method"
      )
      ? "clarify_return_label_availability"
      : replyGoal === "explain_shipping_blocker_without_overclaiming"
      ? "clarify_return_label_availability"
      : replyGoal === "explain_repair_logistics_next_step"
      ? "clarify_return_label_availability"
      : replyGoal === "assess_physical_damage_claim" && hasPhotoEvidenceOffer(input.assessment)
      ? "request_photo_evidence_for_damage_assessment"
      : null;
  const requiredReplyElements = requiredReplyElementsForGoal(
    replyGoal,
    replyStrategy?.approved_facts || [],
  );
  const forbiddenReplyMoves = [
    ...(replyStrategy?.forbidden_claims || []),
    ...(input.recipientType.recipient_type === "customer"
      ? ["unsupported_operational_jargon"]
      : []),
  ];
  const goalFamily = mapGoalFamily(replyGoal);
  const requiresDirectAnswer = [
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
    "answer_policy_question",
    "explain_shipping_blocker_without_overclaiming",
    "explain_repair_logistics_next_step",
    "explain_blocker_without_overclaiming",
  ].includes(replyGoal);
  const confidence = clamp(
    0.48 +
      Number(input.assessment.confidence || 0) * 0.25 +
      Number(input.messageUnderstanding.confidence || 0) * 0.2 +
      (continuationStyleReply ? 0.06 : 0),
  );

  return {
    artifact_type: "reply_goal",
    reply_goal: replyGoal,
    secondary_reply_goal: secondaryReplyGoal,
    goal_family: goalFamily,
    requires_direct_answer: requiresDirectAnswer,
    requires_action_explanation: requiresActionExplanation,
    continuation_style_reply: continuationStyleReply,
    required_reply_elements: requiredReplyElements,
    forbidden_reply_moves: Array.from(new Set(forbiddenReplyMoves.filter(Boolean))),
    based_on_case_type: input.assessment.primary_case_type,
    based_on_message_understanding: input.messageUnderstanding.latest_user_request,
    based_on_thread_context: input.messageUnderstanding.prior_instruction_summary,
    confidence,
    explanation:
      "This artifact captures what the reply should accomplish now, which is distinct from case type, workflow, or recipient assumptions.",
  };
}
