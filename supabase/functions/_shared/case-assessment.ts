import type { EmailCategory } from "./email-category.ts";

export type GeneralCaseType =
  | "technical_issue"
  | "product_question"
  | "tracking_shipping"
  | "return_refund"
  | "order_change"
  | "billing_payment"
  | "warranty_complaint"
  | "general_support"
  | "mixed_case";

export type MetadataOnlySignal = {
  type:
    | "payment_date"
    | "purchase_date"
    | "order_date"
    | "place_of_purchase"
    | "invoice_number"
    | "purchase_channel";
  value: string;
  role: "purchase_identification" | "lookup_hint";
};

export type RetrievalNeeds = {
  order_facts: boolean;
  policy: boolean;
  product: boolean;
  product_manual: boolean;
  troubleshooting: boolean;
  support_process: boolean;
  examples: boolean;
};

export type CaseAssessment = {
  version: 2;
  primary_case_type: GeneralCaseType;
  secondary_case_types: GeneralCaseType[];
  intent_scores: Record<GeneralCaseType, number>;
  metadata_only_signals: MetadataOnlySignal[];
  retrieval_needs: RetrievalNeeds;
  case_type: GeneralCaseType;
  intent_labels: string[];
  language: string;
  customer_sentiment: "positive" | "neutral" | "negative";
  actionability: {
    reply_only_possible: boolean;
    likely_action_family: string | null;
    missing_required_inputs: string[];
  };
  entities: {
    order_numbers: string[];
    emails: string[];
    product_queries: string[];
    symptom_phrases: string[];
    context_phrases: string[];
    old_device_works: boolean;
    tried_fixes: boolean;
    address_candidate: {
      name: string;
      address1: string;
      address2: string;
      city: string;
      zip: string;
      country: string;
      phone: string;
    } | null;
  };
  risk_flags: string[];
  confidence: number;
  summary: string;
};

type AssessCaseInput = {
  subject?: string | null;
  body?: string | null;
  from?: string | null;
  fromEmail?: string | null;
  ticketCategory?: EmailCategory | null;
  workflow?: string | null;
  trackingIntent?: boolean;
  matchedSubjectNumber?: string | null;
  hasSelectedOrder?: boolean;
  styleLearningEnabled?: boolean;
};

const PRODUCT_FORM_FIELD_REGEX =
  /\b(?:what is your request regarding|product|model|item|request regarding)\s*[:\-]\s*([A-Z0-9][A-Z0-9 ./'()-]{1,80})/gi;
const PRODUCT_LIKE_TOKEN_REGEX = /\b([A-Z][A-Za-z0-9]+(?:[- ][A-Z0-9][A-Za-z0-9]+){0,3})\b/g;
const MONTH_NAME_REGEX =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;
const DATE_LIKE_PRODUCT_REGEXES = [
  /^\d{4}$/,
  /^(?:\d{1,2}[./-]){1,2}\d{2,4}$/,
  /^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+\d{1,2}(?:,\s*\d{4})?|\s+\d{4})$/i,
];

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const ORDER_NUMBER_REGEX = /#?\b(\d{3,})\b/g;
const INVOICE_REGEX = /\b(?:invoice|receipt|faktura|kvittering)(?:\s*(?:no|number|nr))?[:#]?\s*([A-Z0-9-]{3,})\b/gi;

const CASE_TYPES: GeneralCaseType[] = [
  "technical_issue",
  "product_question",
  "tracking_shipping",
  "return_refund",
  "order_change",
  "billing_payment",
  "warranty_complaint",
  "general_support",
  "mixed_case",
];

type SignalRule = {
  type: Exclude<GeneralCaseType, "mixed_case">;
  score: number;
  patterns: RegExp[];
};

const SIGNAL_RULES: SignalRule[] = [
  {
    type: "technical_issue",
    score: 4,
    patterns: [
      /\b(not working|doesn'?t work|won'?t work|broken|defective|faulty|damaged)\b/i,
      /\b(won'?t connect|not connecting|disconnects|cuts out|no sound|mic not working)\b/i,
      /\b(battery issue|pairing problem|technical issue|hardware issue)\b/i,
    ],
  },
  {
    type: "technical_issue",
    score: 2,
    patterns: [/\b(problem|issue|bug|error|repair|replace because defective)\b/i],
  },
  {
    type: "product_question",
    score: 4,
    patterns: [/\b(compatible with|does it support|what are the specs|what size|what material)\b/i],
  },
  {
    type: "product_question",
    score: 2,
    patterns: [/\b(product|model|version|feature|how do i use|manual)\b/i],
  },
  {
    type: "tracking_shipping",
    score: 4,
    patterns: [/\b(where is my order|where is my package|not delivered|shipment delayed)\b/i],
  },
  {
    type: "tracking_shipping",
    score: 2,
    patterns: [/\b(tracking|shipping|delivery|carrier|dispatch|package)\b/i],
  },
  {
    type: "return_refund",
    score: 4,
    patterns: [/\b(return|refund|money back|exchange|send back|return label)\b/i],
  },
  {
    type: "return_refund",
    score: 2,
    patterns: [/\b(refund status|return request|exchange request)\b/i],
  },
  {
    type: "order_change",
    score: 4,
    patterns: [/\b(change address|update address|cancel order|change shipping method)\b/i],
  },
  {
    type: "order_change",
    score: 2,
    patterns: [/\b(update order|change email|change phone|edit order)\b/i],
  },
  {
    type: "billing_payment",
    score: 4,
    patterns: [/\b(charged twice|double charged|payment failed|billing issue|invoice problem)\b/i],
  },
  {
    type: "billing_payment",
    score: 2,
    patterns: [/\b(payment issue|invoice|receipt|charged|card declined|klarna)\b/i],
  },
  {
    type: "warranty_complaint",
    score: 4,
    patterns: [/\b(warranty|guarantee|complaint|consumer rights|claim)\b/i],
  },
  {
    type: "warranty_complaint",
    score: 2,
    patterns: [/\b(replacement due to defect|repair request)\b/i],
  },
];

function uniq(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function detectLanguage(subject: string, body: string) {
  const text = `${subject}\n${body}`.toLowerCase();
  if (/\b(hola|pedido|entrega|seguimiento)\b/.test(text)) return "es";
  if (/\b(hej|ordre|levering|pakke)\b|[æøå]/.test(text)) return "da";
  if (/\b(hi|hello|order|delivery|tracking)\b/.test(text)) return "en";
  return "same_as_customer";
}

function detectSentiment(body: string): "positive" | "neutral" | "negative" {
  const text = body.toLowerCase();
  if (/\b(thank|thanks|great|perfect|awesome)\b/.test(text)) return "positive";
  if (/\b(angry|upset|bad|terrible|frustrated|annoyed|complain|wrong)\b/.test(text)) {
    return "negative";
  }
  return "neutral";
}

function extractAddressCandidate(body: string) {
  const lines = String(body || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const joined = lines.join(" ");
  if (!/\b(address|ship to|street|road|avenue|ave|city|zip|postal)\b/i.test(joined)) {
    return null;
  }
  return {
    name: "",
    address1: lines[0] || "",
    address2: "",
    city: "",
    zip: "",
    country: "",
    phone: "",
  };
}

type IssueFacts = {
  symptom_phrases: string[];
  context_phrases: string[];
  old_device_works: boolean;
  tried_fixes: boolean;
};

function normalizeCandidate(value: string) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stripLeadingFieldNoise(value: string) {
  return normalizeCandidate(
    String(value || "").replace(
      /^(?:body|name|email|country code|what do you need help with|what is your request regarding|issue type|issue|problem)\s*:\s*/i,
      "",
    ),
  );
}

function splitStructuredLines(text: string) {
  return String(text || "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function isDateLikeCandidate(value: string) {
  const normalized = normalizeCandidate(value);
  if (!normalized) return true;
  if (DATE_LIKE_PRODUCT_REGEXES.some((pattern) => pattern.test(normalized))) return true;
  if (MONTH_NAME_REGEX.test(normalized) && /\d/.test(normalized)) return true;
  if (/^(?:19|20)\d{2}$/.test(normalized)) return true;
  return false;
}

function isFieldLabelNoise(value: string) {
  return /(?:^|\b)(?:body|name|email|country code|what do you need help with|what is your request regarding|issue type|request regarding|product name|model|item)\s*:/i
    .test(value);
}

function isSentenceLikeNoise(value: string) {
  const normalized = normalizeCandidate(value);
  if (!normalized) return true;
  if (normalized.length > 60) return true;
  if (/\b(?:with|when|because|that|which|have|has|had|using|used|works|working|fine|problem)\b/i.test(normalized) && normalized.split(/\s+/).length >= 5) {
    return true;
  }
  return false;
}

function cleanProductCandidate(value: string) {
  const normalized = stripLeadingFieldNoise(value);
  if (!normalized) return "";
  if (isFieldLabelNoise(value)) return "";
  if (isDateLikeCandidate(normalized)) return "";
  if (isSentenceLikeNoise(normalized)) return "";
  return normalized;
}

function cleanSymptomCandidate(value: string) {
  const normalized = stripLeadingFieldNoise(value);
  if (!normalized) return "";
  if (isFieldLabelNoise(value)) return "";
  if (/^(?:with my old|my old|with the old|the old)\b/i.test(normalized)) return "";
  if (normalized.length > 80) return "";
  if (!/(?:issue|issues|mic|microphone|speaker|audio|sound|freeze|freezes|freezing|shut(?:s)? down|shutdown|connect|disconnect|pairing|battery|charge|crash)/i.test(normalized)) {
    return "";
  }
  return normalized;
}

function extractStructuredFieldValues(text: string, labels: string[]) {
  const normalizedLabels = labels.map((label) => label.toLowerCase());
  const lines = splitStructuredLines(text);
  const values: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lower = line.toLowerCase();
    const matchedLabel = normalizedLabels.find((label) => lower.startsWith(label));
    if (!matchedLabel) continue;

    const inlineValue = normalizeCandidate(line.slice(matchedLabel.length).replace(/^[:?\- ]+/, ""));
    if (inlineValue) {
      values.push(inlineValue);
      continue;
    }

    const nextLine = normalizeCandidate(lines[index + 1] || "");
    if (nextLine && !normalizedLabels.some((label) => nextLine.toLowerCase().startsWith(label))) {
      values.push(nextLine);
    }
  }
  return uniq(values.map((value) => normalizeCandidate(value)));
}

function extractIssueFacts(subject: string, body: string): IssueFacts {
  const text = `${subject}\n${body}`;
  const structuredIssueValues = extractStructuredFieldValues(text, [
    "issue type",
    "issue",
    "problem",
    "what issue are you experiencing",
    "speaker / microphone issues",
  ]);
  const symptomPatterns: RegExp[] = [
    /\b(?:speaker\s*\/\s*microphone issues?|speaker microphone issues?)\b/i,
    /\b(?:microphone issues?|mic issues?|mic not working|microphone not working)\b/i,
    /\b(?:speaker issues?|no sound|sound not working|audio issue)\b/i,
    /\b(?:freez(?:e|ing)|shut(?:s)? down|shutdown|crash(?:es|ing)?)\b/i,
    /\b(?:won'?t connect|not connecting|disconnects|pairing problem|connection issue)\b/i,
    /\b(?:battery issue|battery problem|won'?t charge)\b/i,
  ];
  const contextPatterns: RegExp[] = [
    /\b(?:cs2|cs|counter[- ]?strike|fortnite|call of duty|discord|teams|zoom|playstation|xbox|pc|mac)\b/i,
    /\b(?:voice chat|chat|microphone test|in game|the game|game)\b/i,
  ];
  const symptom_phrases = uniq([
    ...structuredIssueValues,
    ...symptomPatterns
      .map((pattern) => text.match(pattern)?.[0] || "")
      .filter(Boolean)
      .map((value) => normalizeCandidate(value)),
  ]
    .map((value) => cleanSymptomCandidate(value))
    .filter(Boolean));
  const context_phrases = uniq(
    contextPatterns
      .map((pattern) => text.match(pattern)?.[0] || "")
      .filter(Boolean)
      .map((value) => normalizeCandidate(value)),
  );
  const old_device_works =
    /\b(?:old|previous|other)\s+(?:headset|device|one)\b.*\b(?:works|working|fine|okay|ok)\b/i.test(text) ||
    /\bworks fine with (?:my )?(?:old|other)\s+(?:headset|device)\b/i.test(text) ||
    /\bmy old headset works fine\b/i.test(text) ||
    /\bthe old headset works fine\b/i.test(text) ||
    /\bi haven'?t experienced the problem with my old\b/i.test(text) ||
    /\bthe only thing that solves it is if i change to my old (?:headset|device)\b/i.test(text) ||
    /\b(?:changing|switching|swapping) to my old (?:headset|device) solves (?:it|the issue|the problem)\b/i.test(text) ||
    /\bthe only thing that solves it is if i (?:change|switch|swap) to my old (?:headset|device)\b/i.test(text) ||
    /\bswitching back to (?:my )?old (?:headset|device) (?:solves|fixes) (?:it|the issue|the problem)\b/i.test(text);
  const tried_fixes =
    /\b(?:tried|already tried|tested|attempted)\b.*\b(?:many|multiple|all|several)\b.*\b(?:fixes|steps|things|solutions)\b/i
      .test(text) ||
    /\b(?:tried a lot of things|tried many things|tried so many things|already tried fixes|already tried a lot|tried many fixes)\b/i.test(text) ||
    /\bi have tried a lot of things to fix (?:this|the) problem\b/i.test(text) ||
    /\bi have tried a lot of things\b/i.test(text) ||
    /\bi have tried many things(?: already)?\b/i.test(text) ||
    /\bi tried a lot of things to fix this\b/i.test(text) ||
    /\bi[' ]?ve tried a lot of things(?: already)?\b/i.test(text) ||
    /\btried many things already\b/i.test(text) ||
    /\balready tried several fixes\b/i.test(text) ||
    /\b(?:factory reset|reset|reinstall|updated|re-paired|paired again|troubleshooting)\b/i.test(text);

  return {
    symptom_phrases,
    context_phrases,
    old_device_works,
    tried_fixes,
  };
}

function extractProductQueries(subject: string, body: string): string[] {
  const text = `${subject}\n${body}`;
  const lower = text.toLowerCase();
  const results: string[] = [];
  const issueFacts = extractIssueFacts(subject, body);
  const add = (value: string) => {
    const normalized = cleanProductCandidate(value);
    if (!normalized) return;
    if (normalized.length < 2 || normalized.length > 120) return;
    if (/^(?:speaker|microphone|issue|issues|request|regarding|product|model|item)$/i.test(normalized)) return;
    if (results.includes(normalized)) return;
    results.push(normalized);
  };

  const structuredProducts: string[] = [];
  const structuredFieldProducts = extractStructuredFieldValues(text, [
    "what is your request regarding",
    "product",
    "product name",
    "model",
    "item",
    "request regarding",
  ]);
  for (const candidate of structuredFieldProducts) {
    const cleaned = cleanProductCandidate(candidate);
    if (cleaned) {
      structuredProducts.push(cleaned);
      add(cleaned);
    }
  }
  for (const match of text.matchAll(PRODUCT_FORM_FIELD_REGEX)) {
    const candidate = normalizeCandidate(String(match[1] || ""));
    const cleaned = cleanProductCandidate(candidate);
    if (cleaned) {
      structuredProducts.push(cleaned);
      add(cleaned);
    }
  }

  const likelyModels = new Set<string>();
  for (const match of text.matchAll(PRODUCT_LIKE_TOKEN_REGEX)) {
    const token = String(match[1] || "").trim();
    if (
      /^(What|Order|Payment|Purchase|Invoice|Speaker|Microphone|Issues|Issue|Request|Regarding)$/i.test(
        token,
      )
    ) {
      continue;
    }
    if (!cleanProductCandidate(token)) continue;
    if (/[A-Z]/.test(token) && /[-\d]/.test(token)) {
      const cleaned = cleanProductCandidate(token);
      if (!cleaned) continue;
      likelyModels.add(cleaned);
      add(cleaned);
    }
  }

  const symptomTerms = issueFacts.symptom_phrases.length
    ? issueFacts.symptom_phrases
    : [
      "microphone issue",
      "speaker issue",
      "speaker / microphone issues",
      "connection issue",
      "battery issue",
    ].filter((term) => lower.includes(term));

  const baseProducts = structuredProducts.length ? structuredProducts : Array.from(likelyModels);
  for (const model of baseProducts) {
    if (!cleanProductCandidate(model)) continue;
    add(model);
    if (symptomTerms.length) {
      add(`${model} ${symptomTerms[0]}`);
      if (symptomTerms.length > 1) {
        add(`${model} ${symptomTerms.slice(0, 2).join(" ")}`);
      }
    }
  }

  return results.slice(0, 5);
}

function initializeScores(): Record<GeneralCaseType, number> {
  return {
    technical_issue: 0,
    product_question: 0,
    tracking_shipping: 0,
    return_refund: 0,
    order_change: 0,
    billing_payment: 0,
    warranty_complaint: 0,
    general_support: 1,
    mixed_case: 0,
  };
}

function applyRules(text: string, scores: Record<GeneralCaseType, number>) {
  for (const rule of SIGNAL_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        scores[rule.type] += rule.score;
      }
    }
  }
}

function applyLegacyHints(
  input: AssessCaseInput,
  scores: Record<GeneralCaseType, number>,
) {
  const category = String(input.ticketCategory || "").toLowerCase();
  const workflow = String(input.workflow || "").toLowerCase();
  if (input.trackingIntent || category === "tracking" || workflow === "tracking") {
    scores.tracking_shipping += 3;
  }
  if (category === "return" || workflow === "return" || category === "refund" || workflow === "refund") {
    scores.return_refund += 3;
  }
  if (category === "exchange" || workflow === "exchange" || category === "address change" || workflow === "address_change") {
    scores.order_change += 2;
  }
  if (category === "product question" || workflow === "product_question") {
    scores.product_question += 2;
  }
}

function extractMetadataOnlySignals(subject: string, body: string): MetadataOnlySignal[] {
  const text = `${subject}\n${body}`;
  const signals: MetadataOnlySignal[] = [];
  const add = (type: MetadataOnlySignal["type"], value: string, role: MetadataOnlySignal["role"]) => {
    const normalized = String(value || "").trim();
    if (!normalized) return;
    if (signals.some((item) => item.type === type && item.value === normalized)) return;
    signals.push({ type, value: normalized, role });
  };

  const metadataPatterns: Array<[MetadataOnlySignal["type"], RegExp]> = [
    ["payment_date", /\b(?:payment date|paid on)\s*[:\-]?\s*([A-Z0-9,./ -]{4,30})/gi],
    ["purchase_date", /\b(?:purchase date|purchased on|bought on)\s*[:\-]?\s*([A-Z0-9,./ -]{4,30})/gi],
    ["order_date", /\b(?:order date)\s*[:\-]?\s*([A-Z0-9,./ -]{4,30})/gi],
    ["place_of_purchase", /\b(?:bought from|purchased at|ordered via)\s*[:\-]?\s*([A-Z0-9&.,' -]{3,40})/gi],
    ["purchase_channel", /\b(?:amazon|retailer|dealer|webshop|website|store)\b/gi],
  ];

  for (const [type, pattern] of metadataPatterns) {
    for (const match of text.matchAll(pattern)) {
      add(type, String(match[1] || match[0] || ""), "purchase_identification");
    }
  }
  for (const match of text.matchAll(INVOICE_REGEX)) {
    add("invoice_number", String(match[1] || ""), "lookup_hint");
  }
  return signals;
}

function choosePrimaryAndSecondary(
  scores: Record<GeneralCaseType, number>,
): { primary: GeneralCaseType; secondary: GeneralCaseType[]; confidence: number } {
  const ranked = CASE_TYPES.filter((type) => type !== "mixed_case")
    .map((type) => ({ type, score: scores[type] }))
    .sort((left, right) => right.score - left.score);
  const top = ranked[0] || { type: "general_support" as GeneralCaseType, score: 1 };
  const second = ranked[1] || { type: "general_support" as GeneralCaseType, score: 0 };
  const total = ranked.reduce((sum, item) => sum + item.score, 0);
  const confidence = total > 0 ? Math.min(0.98, Math.max(0.35, top.score / total)) : 0.35;
  const closeScores = top.score > 0 && second.score > 0 && Math.abs(top.score - second.score) <= 2;
  const primary = closeScores ? "mixed_case" : top.type;
  const secondary = closeScores
    ? uniq([top.type, second.type])
    : ranked.filter((item) => item.type !== top.type && item.score >= 3).slice(0, 2).map((item) => item.type);
  scores.mixed_case = closeScores ? top.score + second.score : 0;
  return { primary, secondary, confidence };
}

function buildRetrievalNeeds(primary: GeneralCaseType, secondary: GeneralCaseType[]): RetrievalNeeds {
  const types = new Set<GeneralCaseType>([primary, ...secondary]);
  return {
    order_facts: ["tracking_shipping", "return_refund", "order_change", "billing_payment"].some((type) => types.has(type as GeneralCaseType)),
    policy: ["return_refund", "warranty_complaint", "billing_payment"].some((type) => types.has(type as GeneralCaseType)),
    product: ["technical_issue", "product_question", "warranty_complaint"].some((type) => types.has(type as GeneralCaseType)),
    product_manual: ["technical_issue", "product_question", "warranty_complaint"].some((type) => types.has(type as GeneralCaseType)),
    troubleshooting: ["technical_issue", "warranty_complaint"].some((type) => types.has(type as GeneralCaseType)),
    support_process: ["return_refund", "tracking_shipping", "order_change", "billing_payment", "mixed_case"].some((type) => types.has(type as GeneralCaseType)),
    examples: false,
  };
}

function inferLikelyActionFamily(text: string): string | null {
  if (/\b(change address|update address|shipping address|ship to)\b/i.test(text)) {
    return "update_shipping_address";
  }
  if (/\b(cancel order|cancel my order|cancellation)\b/i.test(text)) {
    return "cancel_order";
  }
  if (/\b(refund|money back)\b/i.test(text)) {
    return "refund_order";
  }
  if (/\b(exchange|replacement)\b/i.test(text)) {
    return "create_exchange_request";
  }
  return null;
}

export function assessCase(input: AssessCaseInput): CaseAssessment {
  const subject = String(input.subject || "");
  const body = String(input.body || "");
  const text = `${subject}\n${body}`;
  const lower = text.toLowerCase();
  const matchedSubjectNumber = String(input.matchedSubjectNumber || "").replace(/\D/g, "");
  const orderNumbers = uniq(
    Array.from(body.matchAll(ORDER_NUMBER_REGEX))
      .map((match) => String(match[1] || "").trim())
      .concat(Array.from(subject.matchAll(ORDER_NUMBER_REGEX)).map((match) => String(match[1] || "").trim()))
      .concat(matchedSubjectNumber ? [matchedSubjectNumber] : []),
  );
  const emails = uniq([...(subject.match(EMAIL_REGEX) || []), ...(body.match(EMAIL_REGEX) || [])]);
  const metadataOnlySignals = extractMetadataOnlySignals(subject, body);
  const issueFacts = extractIssueFacts(subject, body);
  const productQueries = extractProductQueries(subject, body);

  const scores = initializeScores();
  applyRules(lower, scores);
  applyLegacyHints(input, scores);

  if (input.hasSelectedOrder) {
    scores.order_change += 1;
    scores.tracking_shipping += 1;
  }
  if (metadataOnlySignals.length > 0 && scores.billing_payment > 0) {
    const strongNonBillingSignals =
      scores.technical_issue >= 4 ||
      scores.product_question >= 4 ||
      scores.warranty_complaint >= 4;
    if (strongNonBillingSignals && scores.billing_payment <= 4) {
      scores.billing_payment = Math.max(0, scores.billing_payment - 2);
    }
  }

  const { primary, secondary, confidence } = choosePrimaryAndSecondary(scores);
  const retrievalNeeds = buildRetrievalNeeds(primary, secondary);
  const likelyActionFamily = inferLikelyActionFamily(lower);
  const missingRequiredInputs =
    likelyActionFamily && !input.hasSelectedOrder && orderNumbers.length === 0 ? ["order_number"] : [];
  const riskFlags = [
    ...(likelyActionFamily ? ["order_mutation"] : []),
    ...(scores.warranty_complaint >= 4 ? ["possible_warranty_case"] : []),
  ];
  const intentLabels = uniq(
    [
      primary,
      ...secondary,
      likelyActionFamily ? likelyActionFamily : "",
      metadataOnlySignals.length ? "metadata_present" : "",
    ].filter(Boolean),
  );
  return {
    version: 2,
    primary_case_type: primary,
    secondary_case_types: secondary,
    intent_scores: scores,
    metadata_only_signals: metadataOnlySignals,
    retrieval_needs: retrievalNeeds,
    case_type: primary,
    intent_labels: intentLabels,
    language: detectLanguage(subject, body),
    customer_sentiment: detectSentiment(body),
    actionability: {
      reply_only_possible: likelyActionFamily == null,
      likely_action_family: likelyActionFamily,
      missing_required_inputs: missingRequiredInputs,
    },
    entities: {
      order_numbers: orderNumbers,
      emails,
      product_queries:
        productQueries.length
          ? productQueries
          : primary === "technical_issue" || primary === "product_question" || secondary.includes("product_question")
          ? [subject || body.slice(0, 160)]
          : [],
      symptom_phrases: issueFacts.symptom_phrases,
      context_phrases: issueFacts.context_phrases,
      old_device_works: issueFacts.old_device_works,
      tried_fixes: issueFacts.tried_fixes,
      address_candidate: extractAddressCandidate(body),
    },
    risk_flags: riskFlags,
    confidence,
    summary:
      primary === "mixed_case"
        ? `Mixed case: ${secondary.join(", ")}`
        : `Primary issue is ${primary}${metadataOnlySignals.length ? " with metadata-only purchase identifiers present" : ""}.`,
  };
}
