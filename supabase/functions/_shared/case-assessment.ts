import type { EmailCategory } from "./email-category.ts";
import { parseEmailReplyBodies } from "./email-reply-parser.ts";

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
  latest_message_primary_intent: GeneralCaseType;
  latest_message_confidence: number;
  historical_context_intents: GeneralCaseType[];
  intent_conflict_detected: boolean;
  current_message_should_override_thread_route: boolean;
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
const SUPPORT_HEADER_TAIL_RE =
  /^(?:den|on)\b.*\b(?:wrote|skrev|schrieb|a écrit)\b.*$|^(?:fra|from|från|sent|sendt|date|dato|to|til|subject|emne|cc|bcc)\s*:.*$/i;
const SUPPORT_SIGNATURE_TAIL_RE =
  /^(?:support|customer support|kundeservice|helpdesk)\b.*<[^>]+@[^>]+>$/i;
const SUBJECT_REPLY_PREFIX_RE = /^(?:(?:re|fw|fwd|sv|vs|aw)\s*:\s*)+/i;
const SUBJECT_NOISE_RE =
  /^(?:\[[^\]]+\]\s*)*(?:new customer message on|customer message on|new message on|message on)\b.*$/i;
const SUBJECT_DATE_TITLE_RE =
  /^(?:(?:13|14|15|16|17|18|19|20)\s+\w+\s+(?:19|20)\d{2}|\w+\s+\d{1,2},?\s+(?:19|20)\d{2})(?:.*)$/i;
const SUBJECT_RELAY_WORD_SALAD_RE =
  /^(?:(?:new|customer|message|march|april|may|june|july|august|september|october|november|december|\d{1,2}|\d{4}|at|kl\.?|on)\s+){4,}.*$/i;

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
      /\b(?:hopper af|hopper fra|afbryder|mister forbindelsen|kan ikke holde forbindelsen)\b/i,
      /\b(?:ingen lyd|lyden forsvinder|ingen forbindelse)\b/i,
      /\b(can'?t stay connected|cannot stay connected|loses connection|keeps disconnecting|disconnects again)\b/i,
      /\b(?:forbundet|forbinder) .* \b(?:dongle|receiver)\b.*\b(?:sekunder|sek)\b/i,
      /\b(?:connected|connects?) to (?:the )?dongle\b.*\b(?:seconds?|sec)\b/i,
      /\b(?:no sound|sound cuts out|audio drops)\b/i,
      /\b(battery issue|pairing problem|technical issue|hardware issue|parringsproblem|forbindelsesproblem)\b/i,
    ],
  },
  {
    type: "technical_issue",
    score: 2,
    patterns: [
      /\b(problem|issue|bug|error|repair|replace because defective)\b/i,
      /\b(?:opdateret|alt er opdateret|jeg har opdateret|prøvet trinene igen|prøvet igen|samme frekvens)\b/i,
      /\b(everything updated|fully updated|same frequency|same channel|retried the steps|tried the steps again)\b/i,
      /\b(dongle|wireless connection|frequency|receiver|frekvens|trådløs forbindelse)\b/i,
    ],
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
    patterns: [
      /\b(?:drop off|drop it off|come by|stop by|bring (?:it|the package)|deliver it in person|hand(?:ing)? in)\b.*\b(?:package|parcel|return|item|headset)\b/i,
      /\b(?:komme forbi|forbi med|aflevere|indlevere|komme ind med)\b.*\b(?:pakke|retur|vare|headset)\b/i,
      /\b(?:opening hours|opening times|business hours)\b.*\b(?:return|package|drop off|come by|shipping)\b/i,
      /\b(?:åbningstider|åbningstid)\b.*\b(?:retur|pakke|aflevere|sende)\b/i,
      /\b(?:avoid sending|instead of shipping|rather than shipping|easier than shipping)\b/i,
      /\b(?:slippe for at sende|undgå at sende)\b.*\b(?:pakke|retur)\b/i,
    ],
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

function cleanLatestMessageBody(body: string) {
  const parsed = parseEmailReplyBodies({ text: body });
  const lines = String(parsed.cleanBodyText || body)
    .split("\n")
    .map((line) => line.replace(/\u00a0/g, " ").trimEnd());
  const kept: string[] = [];

  for (const rawLine of lines) {
    const line = String(rawLine || "").trim();
    if (!line) {
      kept.push("");
      continue;
    }
    if (SUPPORT_HEADER_TAIL_RE.test(line)) break;
    if (SUPPORT_SIGNATURE_TAIL_RE.test(line)) break;
    kept.push(line);
  }

  const cleaned = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return {
    cleanBodyText: cleaned || String(parsed.cleanBodyText || body || "").trim(),
    parserStrategy: parsed.parserStrategy,
    quotedHistoryDetected: parsed.quotedHistoryDetected,
  };
}

function cleanLatestMessageSubject(subject: string) {
  const raw = String(subject || "").trim();
  if (!raw) return "";
  let next = raw;
  let previous = "";
  while (next && next !== previous) {
    previous = next;
    next = next.replace(SUBJECT_REPLY_PREFIX_RE, "").trim();
    next = next.replace(/^(?:\[[^\]]+\]\s*)+/, "").trim();
  }
  if (!next) return "";
  if (SUBJECT_NOISE_RE.test(next)) return "";
  if (SUBJECT_DATE_TITLE_RE.test(next) && !/[?!]/.test(next)) return "";
  if (SUBJECT_RELAY_WORD_SALAD_RE.test(next)) return "";
  if (
    /^(?:new|customer|message|march|april|may|june|july|august|september|october|november|december|\d{1,2}|\d{4}|at|kl\.?|on)\b/i
      .test(next) &&
    next.split(/\s+/).length >= 5
  ) {
    return "";
  }
  return next;
}

function isMeaningfulLatestMessageSubject(subject: string) {
  const normalized = cleanLatestMessageSubject(subject);
  if (!normalized) return false;
  if (SUBJECT_NOISE_RE.test(normalized)) return false;
  if (SUBJECT_DATE_TITLE_RE.test(normalized) && !/[?!]/.test(normalized)) return false;
  if (SUBJECT_RELAY_WORD_SALAD_RE.test(normalized)) return false;
  return true;
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

function isCompactProductLikeValue(value: string) {
  const normalized = normalizeCandidate(value);
  if (!normalized) return false;
  if (/[.!?]/.test(normalized)) return false;
  if (/^(?:hej|hello|hi|dear|thanks|tak)\b/i.test(normalized)) return false;
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length > 4) return false;
  return true;
}

function cleanSymptomCandidate(value: string) {
  const normalized = stripLeadingFieldNoise(value);
  if (!normalized) return "";
  if (isFieldLabelNoise(value)) return "";
  if (/^(?:with my old|my old|with the old|the old)\b/i.test(normalized)) return "";
  if (normalized.length > 80) return "";
  if (
    !/(?:issue|issues|mic|microphone|speaker|audio|sound|freeze|freezes|freezing|shut(?:s)? down|shutdown|connect|disconnect|pairing|battery|charge|crash|dongle|receiver|frequency|wireless|updated|seconds?|sekunder|ingen lyd|hopper af|mister forbindelsen|frekvens|opdateret|forbindelse|parring)/i
      .test(normalized)
  ) {
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
  const compactText = normalizeCandidate(text).toLowerCase();
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
    /\b(?:ingen lyd|lyden forsvinder|ingen forbindelse)\b/i,
    /\b(?:freez(?:e|ing)|shut(?:s)? down|shutdown|crash(?:es|ing)?)\b/i,
    /\b(?:won'?t connect|not connecting|disconnects|pairing problem|connection issue)\b/i,
    /\b(?:hopper af|hopper fra|afbryder|mister forbindelsen|kan ikke holde forbindelsen|forbindelsen ryger)\b/i,
    /\b(?:disconnects again|keeps disconnecting|loses connection|drops connection|can'?t stay connected|cannot stay connected)\b/i,
    /\b(?:forbundet|forbinder) .* \b(?:dongle|receiver)\b.*\b(?:10\s*sekunder|sekunder|sek)\b/i,
    /\b(?:connected|connects?) to (?:the )?dongle\b.*\b(?:10\s*seconds?|ten seconds?|few seconds?|seconds?)\b/i,
    /\b(?:dongle|receiver|wireless connection|same frequency|same channel|trådløs forbindelse|samme frekvens)\b/i,
    /\b(?:alt er opdateret|opdateret|prøvet trinene igen|prøvet igen)\b/i,
    /\b(?:everything updated|fully updated|all updated|already updated|updated everything)\b/i,
    /\b(?:battery issue|battery problem|won'?t charge)\b/i,
  ];
  const contextPatterns: RegExp[] = [
    /\b(?:cs2|cs|counter[- ]?strike|fortnite|call of duty|discord|teams|zoom|playstation|xbox|pc|mac)\b/i,
    /\b(?:voice chat|chat|microphone test|in game|the game|game)\b/i,
    /\b(?:dongle|receiver|wireless|same frequency|same channel|trådløs|samme frekvens|frekvens)\b/i,
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
    /\b(?:old|previous|other)\s+(?:headset|device|one)\b.*\b(?:works|working|fine|okay|ok)\b/i.test(compactText) ||
    /\bworks fine with (?:my )?(?:old|other)\s+(?:headset|device)\b/i.test(compactText) ||
    /\bmy old headset works fine\b/i.test(compactText) ||
    /\bthe old headset works fine\b/i.test(compactText) ||
    /\bi haven'?t experienced the problem with my old\b/i.test(compactText) ||
    /\bthe only thing that solves it is if i (?:change|switch|swap)(?: back)? to my old (?:headset|device)\b/i.test(compactText) ||
    /\b(?:changing|switching|swapping) (?:back )?to my old (?:headset|device) (?:solves|fixes) (?:it|the issue|the problem)\b/i.test(compactText) ||
    /\bwith my old (?:headset|device) i haven'?t experienced (?:this )?(?:problem|issue)\b/i.test(compactText);
  const tried_fixes =
    /\b(?:tried|already tried|tested|attempted)\b.*\b(?:many|multiple|all|several)\b.*\b(?:fixes|steps|things|solutions)\b/i
      .test(compactText) ||
    /\b(?:tried a lot of things|tried many things|tried so many things|already tried fixes|already tried a lot|tried many fixes)\b/i.test(compactText) ||
    /\bi have tried a lot of things to fix (?:this|the) problem\b/i.test(compactText) ||
    /\bi have tried a lot of things(?: already)?\b/i.test(compactText) ||
    /\bi have tried many things(?: already)?\b/i.test(compactText) ||
    /\bi tried a lot of things to fix this\b/i.test(compactText) ||
    /\bi[' ]?ve tried a lot of things(?: already)?\b/i.test(compactText) ||
    /\btried many things already\b/i.test(compactText) ||
    /\balready tried several fixes\b/i.test(compactText) ||
    /\b(?:factory reset|reset|reinstall|updated|re-paired|paired again|troubleshooting)\b/i.test(compactText);

  return {
    symptom_phrases,
    context_phrases,
    old_device_works,
    tried_fixes,
  };
}

function extractProductQueries(subject: string, body: string): string[] {
  const effectiveSubject = isMeaningfulLatestMessageSubject(subject) ? subject : "";
  const text = `${effectiveSubject}\n${body}`;
  const lower = text.toLowerCase();
  const results: string[] = [];
  const issueFacts = extractIssueFacts(effectiveSubject, body);
  const add = (value: string, options?: { allowLongStructured?: boolean }) => {
    const normalized = cleanProductCandidate(value);
    if (!normalized) return;
    if (normalized.length < 2 || normalized.length > 120) return;
    if (!options?.allowLongStructured && !isCompactProductLikeValue(normalized)) return;
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
      add(cleaned, { allowLongStructured: true });
    }
  }
  for (const match of text.matchAll(PRODUCT_FORM_FIELD_REGEX)) {
    const candidate = normalizeCandidate(String(match[1] || ""));
    const cleaned = cleanProductCandidate(candidate);
    if (cleaned) {
      structuredProducts.push(cleaned);
      add(cleaned, { allowLongStructured: true });
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

function applyTechnicalConnectivitySignals(text: string, scores: Record<GeneralCaseType, number>) {
  let connectivitySignals = 0;
  if (/\b(?:dongle|receiver|wireless connection|same frequency|same channel|trådløs forbindelse|samme frekvens)\b/i.test(text)) {
    scores.technical_issue += 2;
    connectivitySignals += 1;
  }
  if (
    /\b(?:disconnects?|disconnecting|disconnects again|drops connection|loses connection|can't stay connected|cannot stay connected|hopper af|hopper fra|afbryder|mister forbindelsen|kan ikke holde forbindelsen|forbindelsen ryger)\b/i
      .test(text)
  ) {
    scores.technical_issue += 3;
    connectivitySignals += 1;
  }
  if (/\b(?:no sound|audio drops|sound cuts out|ingen lyd|lyden forsvinder)\b/i.test(text)) {
    scores.technical_issue += 2;
    connectivitySignals += 1;
  }
  if (
    /\b(?:10\s*seconds?|ten seconds?|few seconds?|shortly after connecting|after about \d+\s*seconds?|10\s*sekunder|sekunder|sek)\b/i
      .test(text)
  ) {
    scores.technical_issue += 2;
    connectivitySignals += 1;
  }
  if (
    /\b(?:everything updated|fully updated|all updated|already updated|retried the steps|tried the steps again|opdateret|alt er opdateret|prøvet trinene igen|prøvet igen)\b/i
      .test(text)
  ) {
    scores.technical_issue += 1;
    connectivitySignals += 1;
  }
  if (
    /\b(?:dongle|receiver)\b/i.test(text) &&
    /\b(?:disconnects?|loses connection|drops connection|can't stay connected|cannot stay connected|hopper af|mister forbindelsen|kan ikke holde forbindelsen)\b/i
      .test(text)
  ) {
    scores.technical_issue += 3;
  }
  if (
    /\b(?:no sound|audio drops|sound cuts out|ingen lyd|lyden forsvinder)\b/i.test(text) &&
    /\b(?:disconnects?|loses connection|drops connection|can't stay connected|cannot stay connected|hopper af|mister forbindelsen|kan ikke holde forbindelsen)\b/i
      .test(text)
  ) {
    scores.technical_issue += 2;
  }

  const explicitTrackingAsk =
    /\b(?:where is my order|where is my package|tracking number|shipment delayed|not delivered|delivery status)\b/i
      .test(text);
  if (connectivitySignals >= 2 && !explicitTrackingAsk) {
    scores.tracking_shipping = Math.max(0, scores.tracking_shipping - 5);
    scores.product_question += 1;
  }
}

function applyProcessLogisticsSignals(text: string, scores: Record<GeneralCaseType, number>) {
  const lower = String(text || "").toLowerCase();
  const inPersonLogistics =
    /\b(?:drop off|come by|stop by|deliver it in person|opening hours|opening times|business hours)\b/i
      .test(text) ||
    /\b(?:komme forbi|forbi med|aflevere|indlevere|åbningstider|åbningstid)\b/i.test(text);
  const shippingOrReturnContext =
    /\b(?:package|parcel|shipping|send|return|retur|pakke|sende)\b/i.test(text);
  const avoidShipping =
    /\b(?:avoid sending|instead of shipping|rather than shipping|easier than shipping)\b/i.test(text) ||
    /\b(?:slippe for at sende|undgå at sende)\b/i.test(text);

  if (inPersonLogistics && (shippingOrReturnContext || avoidShipping)) {
    scores.return_refund += 4;
    scores.general_support += 2;
    if (scores.tracking_shipping > 0 && !/\b(?:where is my order|where is my package|tracking number|not delivered|shipment delayed)\b/i.test(text)) {
      scores.tracking_shipping = Math.max(0, scores.tracking_shipping - 2);
    }
  }

  if (
    lower.includes("opening hours") ||
    lower.includes("opening times") ||
    lower.includes("business hours") ||
    lower.includes("åbningstider") ||
    lower.includes("åbningstid")
  ) {
    scores.general_support += 2;
  }
}

function applyLegacyHints(
  input: AssessCaseInput,
  scores: Record<GeneralCaseType, number>,
) {
  const category = String(input.ticketCategory || "").toLowerCase();
  const workflow = String(input.workflow || "").toLowerCase();
  if (category === "tracking" || workflow === "tracking") {
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

function inferHistoricalContextIntents(input: AssessCaseInput): GeneralCaseType[] {
  const category = String(input.ticketCategory || "").trim().toLowerCase();
  const workflow = String(input.workflow || "").trim().toLowerCase();
  const intents = new Set<GeneralCaseType>();

  if (category === "tracking" || workflow === "tracking") {
    intents.add("tracking_shipping");
  }
  if (
    category === "return" ||
    workflow === "return" ||
    category === "refund" ||
    workflow === "refund" ||
    category === "exchange" ||
    workflow === "exchange"
  ) {
    intents.add("return_refund");
  }
  if (
    category === "address change" ||
    workflow === "address_change" ||
    category === "cancellation" ||
    workflow === "cancellation"
  ) {
    intents.add("order_change");
  }
  if (category === "payment" || workflow === "payment") {
    intents.add("billing_payment");
  }
  if (category === "product question" || workflow === "product_question") {
    intents.add("product_question");
  }
  if (category === "general" || workflow === "general") {
    intents.add("general_support");
  }

  return Array.from(intents);
}

function chooseLatestMessagePrimaryIntent(
  scores: Record<GeneralCaseType, number>,
): { primary: GeneralCaseType; confidence: number } {
  const ranked = CASE_TYPES.filter((type) => type !== "mixed_case")
    .map((type) => ({ type, score: scores[type] }))
    .sort((left, right) => right.score - left.score);
  const top = ranked[0] || { type: "general_support" as GeneralCaseType, score: 1 };
  const total = ranked.reduce((sum, item) => sum + item.score, 0);
  const confidence = total > 0 ? Math.min(0.98, Math.max(0.35, top.score / total)) : 0.35;
  return { primary: top.type, confidence };
}

function detectIntentConflict(
  latestMessagePrimaryIntent: GeneralCaseType,
  historicalContextIntents: GeneralCaseType[],
  scores: Record<GeneralCaseType, number>,
) {
  const historical = historicalContextIntents.filter((intent) => intent !== "general_support");
  if (!historical.length) return false;
  const staleTrackingRoute = historical.includes("tracking_shipping");
  const meaningfulNonTrackingAsk =
    latestMessagePrimaryIntent === "return_refund" ||
    latestMessagePrimaryIntent === "order_change" ||
    (latestMessagePrimaryIntent === "general_support" &&
      ((scores.return_refund ?? 0) >= 3 || (scores.order_change ?? 0) >= 3)) ||
    ((scores.return_refund ?? 0) >= 4 && (scores.tracking_shipping ?? 0) <= 2);
  if (staleTrackingRoute && meaningfulNonTrackingAsk) return true;
  if (latestMessagePrimaryIntent === "general_support") return false;
  return !historical.includes(latestMessagePrimaryIntent);
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
  const rawSubject = String(input.subject || "");
  const subject = cleanLatestMessageSubject(rawSubject);
  const subjectIsMeaningful = isMeaningfulLatestMessageSubject(subject);
  const rawBody = String(input.body || "");
  const cleanedLatestMessage = cleanLatestMessageBody(rawBody);
  const body = cleanedLatestMessage.cleanBodyText;
  const text = `${subject}\n${body}`;
  const lower = text.toLowerCase();
  const matchedSubjectNumber = String(input.matchedSubjectNumber || "").replace(/\D/g, "");
  const orderNumbers = uniq(
    Array.from(body.matchAll(ORDER_NUMBER_REGEX))
      .map((match) => String(match[1] || "").trim())
      .concat(
        subjectIsMeaningful
          ? Array.from(subject.matchAll(ORDER_NUMBER_REGEX)).map((match) => String(match[1] || "").trim())
          : [],
      )
      .concat(subjectIsMeaningful && matchedSubjectNumber ? [matchedSubjectNumber] : []),
  );
  const emails = uniq([
    ...(subjectIsMeaningful ? subject.match(EMAIL_REGEX) || [] : []),
    ...(body.match(EMAIL_REGEX) || []),
  ]);
  const metadataOnlySignals = extractMetadataOnlySignals(subject, body);
  const issueFacts = extractIssueFacts(subject, body);
  const productQueries = extractProductQueries(subject, body);

  const latestMessageScores = initializeScores();
  applyRules(lower, latestMessageScores);
  applyTechnicalConnectivitySignals(text, latestMessageScores);
  applyProcessLogisticsSignals(text, latestMessageScores);
  if (input.hasSelectedOrder) {
    latestMessageScores.order_change += 1;
    latestMessageScores.tracking_shipping += 1;
  }
  if (metadataOnlySignals.length > 0 && latestMessageScores.billing_payment > 0) {
    const strongNonBillingSignals =
      latestMessageScores.technical_issue >= 4 ||
      latestMessageScores.product_question >= 4 ||
      latestMessageScores.warranty_complaint >= 4;
    if (strongNonBillingSignals && latestMessageScores.billing_payment <= 4) {
      latestMessageScores.billing_payment = Math.max(0, latestMessageScores.billing_payment - 2);
    }
  }
  const {
    primary: latestMessagePrimaryIntent,
    confidence: latestMessageConfidence,
  } = chooseLatestMessagePrimaryIntent(latestMessageScores);
  const historicalContextIntents = inferHistoricalContextIntents(input);
  const intentConflictDetected = detectIntentConflict(
    latestMessagePrimaryIntent,
    historicalContextIntents,
    latestMessageScores,
  );
  const currentMessageShouldOverrideThreadRoute =
    intentConflictDetected && latestMessagePrimaryIntent !== "general_support";

  const scores = initializeScores();
  applyRules(lower, scores);
  applyTechnicalConnectivitySignals(text, scores);
  applyProcessLogisticsSignals(text, scores);
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
    latest_message_primary_intent: latestMessagePrimaryIntent,
    latest_message_confidence: latestMessageConfidence,
    historical_context_intents: historicalContextIntents,
    intent_conflict_detected: intentConflictDetected,
    current_message_should_override_thread_route: currentMessageShouldOverrideThreadRoute,
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
        productQueries.length ? productQueries : [],
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
