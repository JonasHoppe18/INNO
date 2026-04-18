import { REPLY_ONLY_JSON_SCHEMA } from "./openai-schema.ts";
import type { ReplyStrategy } from "./reply-strategy.ts";
import type { ExecutionState } from "./reply-safety.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";
const OPENAI_ADVANCED_MODEL = Deno.env.get("OPENAI_ADVANCED_MODEL") ?? "gpt-4o";

type ApprovedFact = { key: string; value: string };

export type ReturnProcessReplyCompleteness = {
  expected: string[];
  present: string[];
  missing: string[];
  passed: boolean;
};

export type ReturnProcessReplyRevisionResult = {
  text: string;
  structuredRebuildUsed: boolean;
  normalizedAddressBlock: string;
  addressDuplicationPrevented: boolean;
};

const normalizeText = (value: string) =>
  String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const getApprovedFactValue = (facts: ApprovedFact[], key: string) =>
  String(facts.find((fact) => String(fact?.key || "") === key)?.value || "").trim();

const hasApprovedFact = (facts: ApprovedFact[], key: string, value = "true") =>
  facts.some((fact) => String(fact?.key || "") === key && String(fact?.value || "") === value);

function splitClosing(text: string) {
  const lines = String(text || "").split("\n");
  const closingIndex = lines.findIndex((line) =>
    /\b(?:hvis du har flere spørgsmål|hvis du har spørgsmål|du er velkommen til at svare her|lad os vide|if you have any questions|feel free to reply here|let us know here)\b/i
      .test(String(line || "").trim())
  );
  if (closingIndex <= 0) {
    return { body: String(text || "").trim(), closing: "" };
  }
  return {
    body: lines.slice(0, closingIndex).join("\n").trim(),
    closing: lines.slice(closingIndex).join("\n").trim(),
  };
}

function appendMissingReturnProcessSections(text: string, sections: string[]) {
  const { body, closing } = splitClosing(text);
  return [body, ...sections.filter(Boolean), closing].filter(Boolean).join("\n\n").trim();
}

function normalizeAddressBlock(value: string) {
  return String(value || "")
    .split("\n")
    .map((line) => String(line || "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function buildReturnProcessClosing(languageHint?: string | null) {
  return String(languageHint || "").toLowerCase() === "da"
    ? "Hvis du har flere spørgsmål, er du velkommen til at svare her."
    : "If you have any questions, you are welcome to reply here.";
}

function buildStructuredReturnProcessReply(options: {
  approvedFacts: ApprovedFact[];
  languageHint?: string | null;
}): ReturnProcessReplyRevisionResult {
  const isDanish = String(options.languageHint || "").toLowerCase() === "da";
  const addressBlock = normalizeAddressBlock(
    getApprovedFactValue(options.approvedFacts, "return_destination_address"),
  );
  const orderReference = getApprovedFactValue(options.approvedFacts, "order_reference");
  const itemName = getApprovedFactValue(options.approvedFacts, "return_item_name")
    || (isDanish ? "varen" : "the item");
  const includeOrderReference = hasApprovedFact(
    options.approvedFacts,
    "suggest_include_order_reference_with_parcel",
  ) && Boolean(orderReference);
  const lines = [
    isDanish
      ? `Du skal pakke ${itemName} forsvarligt ind og sende det til adressen nedenfor.`
      : `Please pack ${itemName} securely and send it to the address below.`,
    isDanish
      ? "Da der ikke følger en returlabel med, skal du selv arrangere forsendelsen."
      : "You will need to arrange the return shipment yourself.",
    isDanish
      ? "Du skal derfor gå til en pakkeshop eller fragtudbyder, købe en returlabel og sende pakken derfra."
      : "Please go to a parcel shop or shipping provider, buy a shipping label, and send the parcel from there.",
  ];
  if (addressBlock) {
    lines.push(addressBlock);
  }
  if (includeOrderReference) {
    lines.push(
      isDanish
        ? `Skriv gerne ordrenummer ${orderReference} på pakken eller læg en lille note i pakken, så vi kan matche returen, når den modtages.`
        : `Please include order reference ${orderReference} on or in the parcel so we can match the return when it arrives.`,
    );
  }
  lines.push(buildReturnProcessClosing(options.languageHint));

  return {
    text: lines.filter(Boolean).join("\n\n").trim(),
    structuredRebuildUsed: true,
    normalizedAddressBlock: addressBlock,
    addressDuplicationPrevented: true,
  };
}

export function evaluateReturnProcessFollowUpReplyCompleteness(
  text: string,
  approvedFacts: ApprovedFact[],
): ReturnProcessReplyCompleteness {
  const expected = ["physical_next_step"];
  const present: string[] = [];
  const normalized = normalizeText(text);
  const returnAddress = normalizeAddressBlock(
    getApprovedFactValue(approvedFacts, "return_destination_address"),
  );
  const expectSelfArranged = hasApprovedFact(approvedFacts, "customer_arranges_return_shipment");
  const expectOrderRef = hasApprovedFact(approvedFacts, "suggest_include_order_reference_with_parcel");
  const orderReference = getApprovedFactValue(approvedFacts, "order_reference");

  const hasPhysicalNextStep =
    /\b(?:pak|pakke|pack)\b/i.test(text) &&
    /\b(?:send|sende|ship|return)\b/i.test(text);
  if (hasPhysicalNextStep) present.push("physical_next_step");

  if (returnAddress) {
    expected.push("destination_address");
    const normalizedAddress = normalizeText(returnAddress.replace(/\n+/g, " "));
    const addressLines = returnAddress.split("\n").map((line) => line.trim()).filter(Boolean);
    const matchedLines = addressLines.filter((line) => normalized.includes(normalizeText(line)));
    if (
      normalized.includes(normalizedAddress) ||
      matchedLines.length >= Math.min(2, addressLines.length)
    ) {
      present.push("destination_address");
    }
  }

  if (expectSelfArranged) {
    expected.push("self_arranged_shipment");
    if (
      /\b(?:selv arrangere|selv stå for|arrangere forsendelsen selv|arrange the return shipment yourself|arrange shipping yourself|arrange the shipment yourself)\b/i
        .test(text)
      || /\b(?:pakkeshop|parcel shop|shipping provider|fragtudbyder|buy a shipping label|købe en returlabel)\b/i
        .test(text)
    ) {
      present.push("self_arranged_shipment");
    }
  }

  if (expectOrderRef) {
    expected.push("order_reference_with_parcel");
    if (
      (
        /\b(?:ordrenummer|order number|order reference)\b/i.test(text) ||
        (orderReference && normalized.includes(normalizeText(orderReference)))
      ) &&
      /\b(?:pakke|parcel|package|note i pakken|on the parcel|in the parcel)\b/i.test(text)
    ) {
      present.push("order_reference_with_parcel");
    }
  }

  const missing = expected.filter((item) => !present.includes(item));
  return { expected, present, missing, passed: missing.length === 0 };
}

export function reviseReturnProcessFollowUpReply(options: {
  text: string;
  approvedFacts: ApprovedFact[];
  languageHint?: string | null;
}): ReturnProcessReplyRevisionResult {
  const normalizedAddressBlock = normalizeAddressBlock(
    getApprovedFactValue(options.approvedFacts, "return_destination_address"),
  );
  const shouldUseStructuredRebuild =
    hasApprovedFact(options.approvedFacts, "return_process_followup") &&
    hasApprovedFact(options.approvedFacts, "customer_arranges_return_shipment") &&
    getApprovedFactValue(options.approvedFacts, "return_label_method") === "none" &&
    getApprovedFactValue(options.approvedFacts, "return_shipping_mode") === "customer_paid" &&
    Boolean(normalizedAddressBlock);

  if (shouldUseStructuredRebuild) {
    return buildStructuredReturnProcessReply({
      approvedFacts: options.approvedFacts,
      languageHint: options.languageHint,
    });
  }

  const completeness = evaluateReturnProcessFollowUpReplyCompleteness(
    options.text,
    options.approvedFacts,
  );
  if (completeness.passed) {
    return {
      text: options.text,
      structuredRebuildUsed: false,
      normalizedAddressBlock,
      addressDuplicationPrevented: false,
    };
  }

  const language = String(options.languageHint || "").toLowerCase();
  const isDanish = language === "da";
  const returnAddress = normalizedAddressBlock;
  const orderReference = getApprovedFactValue(options.approvedFacts, "order_reference");
  const itemName = getApprovedFactValue(options.approvedFacts, "return_item_name")
    || (isDanish ? "varen" : "the item");
  const sections: string[] = [];

  if (completeness.missing.includes("physical_next_step")) {
    sections.push(
      isDanish
        ? `Pak ${itemName} forsvarligt ind og send det til adressen nedenfor.`
        : `Please pack ${itemName} securely and send it to the address below.`,
    );
  }
  if (completeness.missing.includes("self_arranged_shipment")) {
    sections.push(
      isDanish
        ? "Du skal selv arrangere forsendelsen, da der ikke er en returlabel til denne retur."
        : "Please arrange the return shipment yourself, as no return label is provided for this return.",
    );
  }
  if (completeness.missing.includes("destination_address") && returnAddress) {
    sections.push(returnAddress);
  }
  if (completeness.missing.includes("order_reference_with_parcel") && orderReference) {
    sections.push(
      isDanish
        ? `Skriv gerne ${orderReference} på pakken eller læg en lille note i pakken, så vi kan matche returen, når den modtages.`
        : `Please include ${orderReference} on or in the parcel so we can match the return when it arrives.`,
    );
  }

  return {
    text: appendMissingReturnProcessSections(options.text, sections),
    structuredRebuildUsed: false,
    normalizedAddressBlock,
    addressDuplicationPrevented: false,
  };
}

export type ThreadHistoryMessage = {
  role: "customer" | "support";
  text: string;
};

export type GenerateReplyFromStrategyInput = {
  customerMessage: string;
  customerFirstName?: string | null;
  replyStrategy: ReplyStrategy;
  executionState: ExecutionState;
  factSummary: string;
  technicalKnowledgeSummary?: string | null;
  technicalDiagnosticFacts?: string[];
  policySummary?: string | null;
  policyExcerpt?: string | null;
  productSummary?: string | null;
  generalKnowledgeSummary?: string | null;
  personaInstructions?: string | null;
  languageHint?: string | null;
  threadHistory?: ThreadHistoryMessage[] | null;
  retryHint?: string | null;
};

export type QualityCheck = {
  answers_core_question: boolean;
  matches_brand_voice: boolean;
  contains_ungrounded_claims: boolean;
  ready_to_send: boolean;
};

export type GenerateReplyResult = {
  reply: string;
  quality_check: QualityCheck | null;
};

export async function generateReplyFromStrategy(
  input: GenerateReplyFromStrategyInput,
): Promise<GenerateReplyResult | null> {
  if (!OPENAI_API_KEY) return null;
  const forbidReturnOrRefundSuggestions = (input.replyStrategy.forbidden_claims || []).includes(
    "suggest_return_or_refund",
  );
  const hasTechnicalDiagnosticFacts = Array.isArray(input.technicalDiagnosticFacts) &&
    input.technicalDiagnosticFacts.length > 0;
  const knownOrderReference = (input.replyStrategy.approved_facts || []).some((fact) =>
    String(fact?.key || "") === "order_reference" && String(fact?.value || "").trim()
  );
  const ongoingReturnFlow = (input.replyStrategy.approved_facts || []).some((fact) =>
    String(fact?.key || "") === "ongoing_return_or_replacement_flow" && String(fact?.value || "") === "true"
  );
  const ongoingAddressClarificationFlow = (input.replyStrategy.approved_facts || []).some((fact) =>
    String(fact?.key || "") === "ongoing_address_clarification_flow" && String(fact?.value || "") === "true"
  );
  const ongoingTechnicalTroubleshootingFlow = (input.replyStrategy.approved_facts || []).some((fact) =>
    String(fact?.key || "") === "ongoing_technical_troubleshooting_flow" && String(fact?.value || "") === "true"
  );
  const defectReturnContext = (input.replyStrategy.approved_facts || []).some((fact) =>
    String(fact?.key || "") === "defect_return_context" && String(fact?.value || "") === "true"
  );
  const defectReturnShippingRule = String(
    (input.replyStrategy.approved_facts || []).find((fact) =>
      String(fact?.key || "") === "defect_return_shipping_rule"
    )?.value || "unspecified",
  ).trim().toLowerCase();
  const returnLabelMethod = String(
    (input.replyStrategy.approved_facts || []).find((fact) =>
      String(fact?.key || "") === "return_label_method"
    )?.value || "none",
  ).trim().toLowerCase();
  const returnShippingMode = String(
    (input.replyStrategy.approved_facts || []).find((fact) =>
      String(fact?.key || "") === "return_shipping_mode"
    )?.value || "customer_paid",
  ).trim().toLowerCase();
  const returnDestinationAddress = String(
    (input.replyStrategy.approved_facts || []).find((fact) =>
      String(fact?.key || "") === "return_destination_address"
    )?.value || "",
  ).trim();
  const returnLabelArtifactPresent = (input.replyStrategy.approved_facts || []).some((fact) =>
    String(fact?.key || "") === "return_label_artifact_present" && String(fact?.value || "") === "true"
  );
  const returnProcessFollowUp = (input.replyStrategy.approved_facts || []).some((fact) =>
    String(fact?.key || "") === "return_process_followup" && String(fact?.value || "") === "true"
  );
  const customerArrangesReturnShipment = (input.replyStrategy.approved_facts || []).some((fact) =>
    String(fact?.key || "") === "customer_arranges_return_shipment" && String(fact?.value || "") === "true"
  );
  const suggestIncludeOrderReferenceWithParcel = (input.replyStrategy.approved_facts || []).some((fact) =>
    String(fact?.key || "") === "suggest_include_order_reference_with_parcel" &&
    String(fact?.value || "") === "true"
  );
  const addressClarificationIssue = (input.replyStrategy.approved_facts || []).some((fact) =>
    String(fact?.key || "") === "address_clarification_issue" && String(fact?.value || "") === "true"
  );
  const addressResolutionPreferred = (input.replyStrategy.approved_facts || []).some((fact) =>
    String(fact?.key || "") === "address_resolution_preferred" && String(fact?.value || "") === "true"
  );
  const physicalDamageClaim = (input.replyStrategy.approved_facts || []).some((fact) =>
    String(fact?.key || "") === "physical_damage_claim" && String(fact?.value || "") === "true"
  );
  const customerSaysNotDropped = (input.replyStrategy.approved_facts || []).some((fact) =>
    String(fact?.key || "") === "customer_says_not_dropped" && String(fact?.value || "") === "true"
  );
  const photoEvidenceRequestedOrOffered = (input.replyStrategy.approved_facts || []).some((fact) =>
    String(fact?.key || "") === "photo_evidence_requested_or_offered" && String(fact?.value || "") === "true"
  );
  const replyGoal = String(
    (input.replyStrategy.approved_facts || []).find((fact) =>
      String(fact?.key || "") === "reply_goal"
    )?.value || "",
  ).trim();
  const damageAssessmentFlow = physicalDamageClaim &&
    (
      photoEvidenceRequestedOrOffered ||
      replyGoal === "request_photo_evidence_for_damage_assessment" ||
      replyGoal === "assess_physical_damage_claim"
    );
  const isContinuation = ongoingReturnFlow || ongoingAddressClarificationFlow || ongoingTechnicalTroubleshootingFlow;

  const isComplexCase =
    damageAssessmentFlow ||
    hasTechnicalDiagnosticFacts ||
    ongoingTechnicalTroubleshootingFlow ||
    Boolean(input.retryHint) ||
    (input.replyStrategy.approved_facts || []).length > 6;
  const selectedModel = isComplexCase ? OPENAI_ADVANCED_MODEL : OPENAI_MODEL;

  const directReturnContinuationQuestion = knownOrderReference &&
    (
      /\b(?:how do i send .* back|how do i return .*|send the old .* back|return the old .*|how do i send it back now that i (?:got|received) the new one)\b/i
        .test(input.customerMessage || "") ||
      /\b(?:hvordan får jeg sendt det gamle retur|hvordan sender jeg det tilbage|hvordan sender jeg det gamle \w+ tilbage|hvordan returnerer jeg det gamle|sende den gamle tilbage|hvordan sender jeg (?:det|varen|produktet) tilbage|hvor skal jeg sende det)\b/i
        .test(input.customerMessage || "")
    );

  const system = [
    "You are a customer support reply generator.",
    "",
    input.personaInstructions
      ? `BRAND VOICE (highest priority):\n${input.personaInstructions}`
      : "",
    "Your reply MUST reflect this brand voice throughout. If no persona is defined, use a warm, professional tone.",
    (() => {
      const lang = String(input.languageHint || "").toLowerCase();
      if (lang === "da") return "IMPORTANT: Write the reply in Danish. Do not use English.";
      if (lang === "en") return "IMPORTANT: Write the reply in English. Do not use Danish.";
      if (lang && lang !== "same_as_customer") return `IMPORTANT: Write the reply in this language: ${lang}. Match the customer's language exactly.`;
      return "IMPORTANT: Always reply in the same language as the customer's message. Never switch languages.";
    })(),
    "",
    "Return JSON only.",
    "Write the customer-facing draft text only.",
    "Do not propose, invent, or choose actions.",
    "Use only the approved context supplied in the prompt.",
    "If a fact is not in APPROVED FACTS, TECHNICAL SUPPORT FACTS, POLICY, PRODUCT FACTS, or GENERAL KNOWLEDGE, do not claim it.",
    "CRITICAL: Never invent, guess, or suggest email addresses, phone numbers, URLs, or contact details that are not explicitly provided in APPROVED FACTS or POLICY SUMMARY. If contact information is not available, do not mention it at all.",
    "Do not infer an exact root cause, missing field, or operational reason unless it is explicitly grounded in the approved context.",
    "Prefer operational wording over absolute wording when the evidence is limited.",
    input.executionState !== "executed"
      ? "Do not claim that any action has already been completed."
      : "You may confirm completion only if it is explicitly supported by the approved facts.",
    input.executionState !== "executed"
      ? "Do not say an order was changed, a refund was processed, a cancellation was completed, or an address was updated unless execution succeeded."
      : "",
    "Do not say a return label is attached, generated, or created unless the approved context explicitly supports that a label artifact exists.",
    "Do not claim who pays for return shipping unless the approved context explicitly supports that responsibility for this reply.",
    "Do not make more absolute statements than the evidence supports.",
    "Never use filler phrases like 'Thank you for your patience', 'Thanks for your patience', or similar patience-thanking phrases unless the customer explicitly mentioned waiting or a delay. These add no value and feel hollow.",
    "When confirming a completed action, state what actually happened specifically and directly. Write 'Order #X has been cancelled' not 'Your request has been approved'. The customer wants to know the outcome, not that a request was approved.",
    "Do not add redundant statements that restate what the customer already knows from context (e.g. do not say 'you will now only have one order' after cancelling one of two duplicate orders — that is obvious).",
    "Never use hedging words like 'typically', 'usually', 'generally', or 'in most cases' when the actual policy or rule is available in APPROVED FACTS or POLICY SUMMARY. If you know the rule, state it directly. If you genuinely do not know, acknowledge it — do not hedge.",
    "When providing return instructions (goal: provide_return_logistics), your reply must include ALL of the following elements that are available in APPROVED FACTS: (1) where to send the item (return_destination_address), (2) how many days the customer has to return it (return_window_days), (3) item condition requirements (require_unused_item, require_original_packaging), (4) who is responsible for return shipping costs (return_shipping_mode). Do not omit any of these — a customer who receives incomplete return instructions will be left confused about how to proceed.",
    forbidReturnOrRefundSuggestions
      ? "Do not suggest returns, refunds, exchanges, replacements, or warranty claims unless they are explicitly supported by the approved facts or requested by the reply strategy."
      : "",
    "The customer is already writing in the active support thread.",
    "Do not tell the customer to email support again, contact the same support email address, write to us by email, or reach out via email.",
    "Do not tell the customer to 'contact technical support', 'contact customer service', or 'reach out to support' — they are already in the support thread. If further help is needed, use 'let us know here' or 'reply here'.",
    "If continued contact is needed in this same thread, say things like 'reply here' or 'let us know here' instead.",
    "Do not ask the customer to notify, inform, or contact us again about the same return, request, or support issue they are already raising in this thread.",
    "You may ask for a missing detail such as order number, serial number, preferred date, or timing, but do not ask them to simply notify us again.",
    "Do not use 'contact us here', 'reply here', 'reach out to us', or 'let us know here' as a generic closing line or filler. The customer is already writing to you — they are already in contact. If you need something specific from them, ask for it directly. If the reply is complete, end without a hollow invitation to get in touch.",
    knownOrderReference
      ? "An order is already matched in approved context. Do not ask again for order number, purchase name, or other basic identity details unless a narrower missing detail is explicitly required."
      : "",
    ongoingReturnFlow
      ? "This is an ongoing return or replacement thread. Answer the practical logistics question directly instead of treating it like a fresh return-policy request."
      : "",
    ongoingReturnFlow || ongoingAddressClarificationFlow || ongoingTechnicalTroubleshootingFlow
      ? "This is a continuation of an already active support thread. Write like a continuation, not like a fresh ticket."
      : "",
    damageAssessmentFlow
      ? "This is a physical-damage review case, not a firmware, app, or connectivity troubleshooting case."
      : "",
    damageAssessmentFlow
      ? "Do not ask firmware questions, software questions, game-specific troubleshooting questions, or generic environment troubleshooting questions."
      : "",
    customerSaysNotDropped
      ? "The approved context indicates that the customer says the product was not dropped. Acknowledge that claim neutrally without overcommitting to the outcome."
      : "",
    photoEvidenceRequestedOrOffered
      ? "The approved context indicates that photo evidence should be requested or accepted. Ask the customer to reply here with photos and explain that the case will be reviewed after the photos are received."
      : "",
    damageAssessmentFlow
      ? "Treat the customer's current need as damage assessment next steps, not as firmware troubleshooting, connectivity troubleshooting, or a generic policy explanation."
      : "",
    damageAssessmentFlow
      ? "If photos are requested or offered, clearly ask the customer to reply in this same thread with photos of the damage."
      : "",
    damageAssessmentFlow
      ? "Explain that the case will be reviewed after the photos are received. Do not ask when the damage started, whether it gets worse in certain situations, or other troubleshooting-style intake questions unless explicitly required by approved facts."
      : "",
    ongoingReturnFlow || ongoingAddressClarificationFlow || ongoingTechnicalTroubleshootingFlow
      ? "Do not fall back to generic support phrasing, generic policy dumps, or generic 'let us know if you need more help' wording as the main substance of the reply."
      : "",
    ongoingReturnFlow
      ? "Prefer short practical return instructions early in the reply. Do not default to generic return-policy wording."
      : "",
    returnProcessFollowUp
      ? "This is a practical return-process follow-up question. Answer with concrete send-back steps, not just the return address."
      : "",
    returnProcessFollowUp
      ? "State the physical next steps plainly: pack the item, send it to the approved return address, and mention shipment arrangement only according to the approved return-label method."
      : "",
    directReturnContinuationQuestion
      ? "The customer is asking a direct practical send-back question in an ongoing order-linked thread. Answer with practical return instructions directly and do not ask again for order number, purchase name, or generic return intake details."
      : "",
    returnProcessFollowUp && returnDestinationAddress
      ? "A return destination address is approved context. Include it as part of the practical steps, preferably as a separate address block."
      : "",
    returnProcessFollowUp && customerArrangesReturnShipment
      ? "No return label is provided by default in approved context. Tell the customer to arrange the shipment themselves, but do not invent who pays unless that is explicitly grounded elsewhere."
      : "",
    returnProcessFollowUp && suggestIncludeOrderReferenceWithParcel
      ? "When natural, suggest including the known order reference in or on the parcel so the return can be matched."
      : "",
    directReturnContinuationQuestion || ongoingReturnFlow
      ? "Do not mention who pays return shipping unless the customer asks about shipping cost or the approved context explicitly requires that detail for this reply."
      : "",
    returnLabelMethod === "generate" && !returnLabelArtifactPresent
      ? "The shop uses generated return labels, but no label artifact is confirmed in approved context for this reply. Do not say a label is attached, generated, or already provided."
      : "",
    returnLabelMethod === "generate" && returnLabelArtifactPresent
      ? "A return-label artifact is confirmed in approved context. You may mention the provided return label if relevant, but do not overstate how it was delivered beyond the approved context."
      : "",
    returnLabelMethod === "pre_printed"
      ? "The shop uses a pre-printed return label. If return-label instructions are relevant, tell the customer to use the included or pre-printed return label. Do not say a new label was attached or generated."
      : "",
    returnLabelMethod === "none"
      ? "The shop does not provide a return label by default. Do not mention any attached, generated, included, enclosed, or pre-printed label."
      : "",
    defectReturnContext && defectReturnShippingRule === "merchant_pays"
      ? "This is a defect, warranty, or replacement-related return continuation. It is grounded that the merchant covers return shipping, so wording that the company covers return shipping is allowed if relevant."
      : "",
    defectReturnContext && defectReturnShippingRule === "customer_pays"
      ? "This is a defect, warranty, or replacement-related return continuation. It is grounded that the customer pays return shipping, so wording to that effect is allowed if relevant."
      : "",
    defectReturnContext && defectReturnShippingRule === "unspecified"
      ? "This is a defect, warranty, or replacement-related return continuation, but shipping responsibility is unspecified. Do not claim who pays return shipping."
      : "",
    ongoingReturnFlow || directReturnContinuationQuestion
      ? "For return, replacement, and return-label cases: do not claim that a return label is attached or generated unless the approved context explicitly confirms it."
      : "",
    addressClarificationIssue
      ? "This is an address or shipping-address clarification case, not a tracking-status request. Do not use tracking-update fallback wording like 'there is no new tracking update'."
      : "",
    addressClarificationIssue
      ? "Do not invent the exact address field that is wrong unless it is explicitly grounded in APPROVED FACTS, FACT SUMMARY, or CUSTOMER MESSAGE."
      : "",
    addressResolutionPreferred
      ? "Do not reply with vague wording like 'I will check' or 'we will check'. If the current address is already known to be unusable from the thread context, move directly to the practical next step by asking for an alternative usable shipping address."
      : "",
    addressResolutionPreferred
      ? "Use grounded operational wording for address-resolution cases. Prefer phrasing like 'our shipping broker is unable to accept the address as entered' or 'we're unable to proceed with the shipment using the address in its current form'. Do not say 'this address cannot be used for shipping' unless that stronger claim is explicitly grounded."
      : "",
    addressClarificationIssue
      ? "For address clarification cases: do not claim that a specific field such as the street, ZIP code, city, or state is wrong unless that exact defect is grounded."
      : "",
    ongoingTechnicalTroubleshootingFlow
      ? "This is an ongoing technical troubleshooting thread. Continue from the already-known troubleshooting state instead of restarting with generic first-line technical support questions."
      : "",
    ongoingTechnicalTroubleshootingFlow
      ? "If the customer has already answered prior troubleshooting questions or already tried steps, do not ask them to repeat those basics. Prefer the next practical troubleshooting step or one narrowly missing detail."
      : "",
    ongoingTechnicalTroubleshootingFlow
      ? "Do not output a generic starter checklist (e.g. 'charge for an hour', 'reset pairing list', 're-pair everything', 'try firmware update') unless each step is explicitly grounded in APPROVED TROUBLESHOOTING FACTS or directly requested in CUSTOMER MESSAGE."
      : "",
    hasTechnicalDiagnosticFacts
      ? "When APPROVED TROUBLESHOOTING FACTS are present, prioritize them over broader technical knowledge and use them to make the reply more concrete."
      : "",
    ongoingTechnicalTroubleshootingFlow || hasTechnicalDiagnosticFacts
      ? "For technical troubleshooting replies: do not overstate certainty. Describe concrete troubleshooting steps or observed symptoms, but do not claim you know the exact hardware root cause unless it is explicitly grounded."
      : "",
    input.executionState === "blocked" || input.executionState === "pending_approval" || input.executionState === "validated_not_executed"
      ? "For refund, cancellation, order-change, and shipping-update threads: if execution has not succeeded, describe the request or current status carefully without implying completion."
      : "",
    hasTechnicalDiagnosticFacts && input.replyStrategy.mode === "ask_for_missing_info"
      ? "For technical support replies, if APPROVED TROUBLESHOOTING FACTS contain relevant next steps, use 1-2 of those concrete troubleshooting steps before asking broader follow-up questions."
      : "",
    hasTechnicalDiagnosticFacts
      ? "Do not ignore a relevant troubleshooting step in APPROVED TROUBLESHOOTING FACTS and fall back to generic advice."
      : "",
    hasTechnicalDiagnosticFacts
      ? "Place the first concrete troubleshooting step early in the reply, immediately after briefly acknowledging the issue."
      : "",
    "Do not ask the customer to repeat or reconfirm facts they already clearly stated in CUSTOMER MESSAGE or APPROVED FACTS.",
    "If the customer already said things are updated, already retried steps, or already described the current setup or symptom pattern, do not ask those same questions again unless you need a narrower missing detail.",
    "If CUSTOMER MESSAGE or APPROVED FACTS already indicate updated/opdateret firmware or software, do not ask whether firmware or software is updated again.",
    "If CUSTOMER MESSAGE or APPROVED FACTS already indicate same frequency/samme frekvens or equivalent pairing/setup status, do not ask about frequency or basic setup confirmation again.",
    "If CUSTOMER MESSAGE or APPROVED FACTS already indicate the customer tried many things or already retried steps, do not ask whether they tried basic troubleshooting again.",
    "When follow-up questions are still needed, ask only for genuinely missing diagnostic details.",
    hasTechnicalDiagnosticFacts
      ? "If APPROVED TROUBLESHOOTING FACTS already provide a useful next step, do not lead with generic diagnostic questions."
      : "",
    "Do not open with generic filler phrases. Specifically banned openers (and close variants): 'Thank you for your message', 'Thank you for contacting us', 'Thank you for reaching out', 'Thank you for providing your details', 'Thank you for getting back to us', 'Thank you for the information', 'I hope this email finds you well', 'I understand your frustration', 'I can see that you are experiencing', 'I understand you are experiencing', 'I understand that...', 'It sounds like...', 'Tak for din besked', 'Tak for din henvendelse', 'Tak for at kontakte os', 'Tak for dine oplysninger', 'Det lyder som om...', 'Jeg forstår at...', or any other opener that only acknowledges receipt, re-states the problem, or uses hollow empathy framing.",
    "The very first meaningful sentence after the salutation must deliver actual help — the answer, the action taken, the next concrete step, or the key information. Do not use the opening sentence to confirm you received the message, to acknowledge the customer's situation in general terms, or to re-state what they already told you.",
    "If the customer raises multiple distinct questions or issues, address all of them. Do not focus only on the most prominent issue and silently ignore the others.",
    "Match the reply length to the situation — short and direct for simple requests, more detailed only when the topic genuinely requires it. Do not pad the reply with unnecessary filler sentences.",
    "Do not add a signature or sign-off valediction. Never end the reply with 'Med venlig hilsen', 'Venlig hilsen', 'Kind regards', 'Best regards', 'Mange hilsner', 'Mvh', 'Regards', or any standalone closing phrase on its own line. The signature is added separately by the system.",
    input.retryHint
      ? `\nREVISION NOTE: A previous draft failed the quality check. Specific issues: ${input.retryHint}\nYou MUST fix these issues in your reply before returning.`
      : "",
    "",
    "Before finalizing your JSON output, verify: 1) Does the reply directly answer what the customer asked? 2) Does the tone match the brand voice specified above? 3) Have you invented any facts not in APPROVED FACTS? Set quality_check fields accordingly. If ready_to_send is false, revise the reply field before returning.",
  ].join("\n");

  const approvedFactsText = (input.replyStrategy.approved_facts || [])
    .map((item) => `- ${item.key}: ${item.value}`)
    .join("\n");
  const technicalDiagnosticFactsText = (input.technicalDiagnosticFacts || [])
    .map((item) => `- ${item}`)
    .join("\n");

  const threadHistoryText = Array.isArray(input.threadHistory) && input.threadHistory.length > 0
    ? [
        "CONVERSATION HISTORY (oldest first — do NOT repeat or re-answer what SUPPORT already said):",
        ...input.threadHistory.map((m) =>
          `[${m.role === "support" ? "SUPPORT" : "CUSTOMER"}]: ${m.text}`
        ),
        "",
      ].join("\n")
    : "";

  const prompt = [
    threadHistoryText,
    "CUSTOMER MESSAGE (the latest message — this is what you are replying to):",
    input.customerMessage || "(empty)",
    "",
    "CUSTOMER INTENT SUMMARY:",
    `- Primary intent: ${input.replyStrategy.mode}`,
    replyGoal ? `- Reply goal: ${replyGoal}` : "",
    `- Urgency: ${input.replyStrategy.tone.empathy}`,
    `- Is followup: ${isContinuation}`,
    "The reply MUST directly address the primary intent above.",
    "Do not start the reply before you have answered the core question implied by the intent.",
    "",
    "REPLY STRATEGY:",
    `Mode: ${input.replyStrategy.mode}`,
    `Execution state: ${input.executionState}`,
    `Goal: ${input.replyStrategy.goal}`,
    ongoingReturnFlow
      ? "Reply structure: 1) answer the practical send-back/return question directly, 2) use the known order context if helpful, 3) only ask for a detail if something is genuinely still missing."
      : "",
    returnProcessFollowUp
      ? "Reply structure: 1) short acknowledgment, 2) practical next steps for physically sending the item back, 3) address block if available, 4) mention arranging shipment if no label is provided, 5) suggest including the order reference with the parcel if helpful, 6) short closing."
      : "",
    damageAssessmentFlow
      ? "Reply structure: 1) acknowledge the reported physical damage, 2) acknowledge the customer says it was not dropped if supported, 3) ask the customer to reply here with photos or attach pictures, 4) explain that the case will be reviewed after the photos are received, 5) do not switch into firmware or connectivity troubleshooting."
      : "",
    returnProcessFollowUp && returnShippingMode === "customer_paid"
      ? "If shipping arrangement is relevant, explain that the customer should arrange the return shipment themselves. Do not add unsupported policy details beyond that."
      : "",
    ongoingAddressClarificationFlow && !addressClarificationIssue
      ? "Reply structure: 1) continue the address-resolution thread directly, 2) use already-known order and address context, 3) ask only for the specific next practical detail if one is still missing."
      : "",
    directReturnContinuationQuestion && !ongoingReturnFlow
      ? "Reply structure: 1) answer the practical send-back question directly, 2) use the known order context if helpful, 3) do not ask again for order number or purchase name."
      : "",
    addressClarificationIssue
      ? "Reply structure: 1) acknowledge the clarification, 2) restate the address details already provided, 3) explain in grounded operational terms that we cannot proceed with the shipment using the address as currently entered, 4) ask directly for an alternative usable shipping address, 5) do not say 'I will check'."
      : "",
    ongoingTechnicalTroubleshootingFlow && !hasTechnicalDiagnosticFacts
      ? "Reply structure: 1) briefly acknowledge the customer's update, 2) continue from the concrete troubleshooting state already in the thread, 3) ask only 1-2 narrowly missing details if absolutely needed, 4) do not restart the troubleshooting intake."
      : "",
    hasTechnicalDiagnosticFacts && input.replyStrategy.mode === "ask_for_missing_info"
      ? "Reply structure: 1) acknowledge the reported issue briefly, 2) give one concrete troubleshooting step from APPROVED TROUBLESHOOTING FACTS, 3) ask only 1-2 genuinely missing diagnostic questions if needed."
      : "",
    "Known customer facts from CUSTOMER MESSAGE and APPROVED FACTS are already established. Do not ask the customer to reconfirm them.",
    input.replyStrategy.must_include.length
      ? `Must include:\n${input.replyStrategy.must_include.map((item) => `- ${item}`).join("\n")}`
      : "",
    input.replyStrategy.must_not_include.length
      ? `Must not include:\n${input.replyStrategy.must_not_include.map((item) => `- ${item}`).join("\n")}`
      : "",
    input.replyStrategy.allowed_claims.length
      ? `Allowed claims:\n${input.replyStrategy.allowed_claims.map((item) => `- ${item}`).join("\n")}`
      : "",
    input.replyStrategy.forbidden_claims.length
      ? `Forbidden claims:\n${input.replyStrategy.forbidden_claims.map((item) => `- ${item}`).join("\n")}`
      : "",
    input.replyStrategy.open_questions.length
      ? `Open questions:\n${input.replyStrategy.open_questions.map((item) => `- ${item}`).join("\n")}`
      : "",
    "",
    "APPROVED FACTS:",
    approvedFactsText || "- none",
    technicalDiagnosticFactsText ? `APPROVED TROUBLESHOOTING FACTS:\n${technicalDiagnosticFactsText}` : "",
    input.factSummary ? `FACT SUMMARY:\n${input.factSummary}` : "",
    input.technicalKnowledgeSummary ? `TECHNICAL SUPPORT FACTS:\n${input.technicalKnowledgeSummary}` : "",
    input.policySummary ? `POLICY SUMMARY:\n${input.policySummary}` : "",
    input.policyExcerpt ? `POLICY EXCERPT:\n${input.policyExcerpt}` : "",
    input.productSummary ? `PRODUCT FACTS:\n${input.productSummary}` : "",
    input.generalKnowledgeSummary ? `GENERAL KNOWLEDGE:\n${input.generalKnowledgeSummary}` : "",
    input.customerFirstName ? `Use the first name if natural: ${input.customerFirstName}` : "",
    "",
    "Return JSON with reply and quality_check fields.",
  ]
    .filter(Boolean)
    .join("\n");

  const body = {
    model: selectedModel,
    temperature: 0.3,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: REPLY_ONLY_JSON_SCHEMA,
    },
    max_tokens: 900,
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(json?.error?.message || `OpenAI error ${res.status}`);
  }
  const content = json?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") return null;
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed?.reply !== "string") return null;
    return {
      reply: parsed.reply.trim(),
      quality_check: parsed.quality_check ?? null,
    };
  } catch {
    return null;
  }
}
