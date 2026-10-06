// Deterministic Product Support authoring for the canonical Knowledge path.
//
// This accepts only deterministic Product Support procedure and structured
// customer-knowledge shapes. Unsupported or ambiguous prose stays evidence
// and is never promoted to generic free-text runtime Knowledge.

import { randomUUID } from "node:crypto";

// Product Support is a generic contract.  These are issue families, not
// merchant or product names.  A procedure can add typed conditions (for
// example a wired path working while a receiver path fails) without creating a
// new issue key for every merchant's wording.
// Stems cover EN + common DA morphology so customer wording maps to the same
// typed families (not merchant-specific phrases). "appen"/"connecte"/"forbind"
// must resolve like "app"/"connect".
const APP_STEM = String.raw`(?:app(?:en)?|mobile|bluetooth)`;
const CONNECT_STEM = String.raw`(?:pair(?:ing)?|parr(?:e|ing)?|connect(?:s|ed|e|ion|ivity|ing)?|forbind(?:e|else)?|reconnect|genforbind|disconnected|afbrudt)`;
const ISSUE_FAMILIES = [
  { family: "microphone", terms: /\b(?:microphone|mic|mikrofon(?:en)?)\b/i },
  { family: "app_pairing", terms: new RegExp(String.raw`\b${APP_STEM}\b[\s\S]{0,80}\b${CONNECT_STEM}\b|\b${CONNECT_STEM}\b[\s\S]{0,80}\b${APP_STEM}\b`, "i") },
  { family: "firmware", terms: /\b(?:firmware|software\s+update|driver\s+update|opdater(?:e|ing)?)\b/i },
  { family: "power", terms: /\b(?:power|charging|charge|oplad(?:e|ning)?|turn\s+on|turn\s+off|tænd(?:e|er|t)?|sluk(?:ke|ker|ket)?|einschalt(?:en|et)?)\b/i },
  // EN + common DA/DE morphology for wireless audio dropouts (not merchant phrases).
  { family: "wireless_interference", terms: /\b(?:interference|drop[- ]?out|cut[- ]?outs?|wireless\s+audio|audio\s+stream|skratter|knitrer|knitren)\b/i },
  { family: "audio", terms: /\b(?:audio|hissing|crackling|distorted|pulsating|ear\s*cup|earpiece|one[- ]ear|left\s+ear|right\s+ear|lyd|knitren|knitrer|skratter|forvrænget|sidetone|side[- ]?tone)\b/i },
  { family: "connectivity", terms: new RegExp(String.raw`\b(?:dongle|receiver|connection|${CONNECT_STEM}|pairing\s+mode)\b`, "i") },
];

const ACTION_HINTS = [
  ["disconnect", /disconnect|unplug|remove/i],
  ["power_on", /power\s+on|turn\s+on|switch\s+on/i],
  ["power_off", /power\s+off|turn\s+off|switch\s+off/i],
  ["hold_button", /hold|press\s+and\s+hold/i],
  ["connect", /connect|plug\s+(?:in|into)|reconnect/i],
  ["wait_reconnect", /wait|automatically|reconnect/i],
  ["explain", /because|means|rather\s+than|make\s+sure|ensure/i],
];

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function splitSentences(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((sentence) => sentence.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}

function stableProductModelKey({ shopId, productId }) {
  return `shop_${String(shopId).replace(/[^a-zA-Z0-9]+/g, "_")}_product_${String(productId)}`;
}

/**
 * Normalize catalog title/handle/alias tokens into the legacy slug form used by
 * older published `applies_to_models` lists (e.g. "A-Spire Wireless" →
 * "a_spire_wireless"). Runtime bindings use `stableProductModelKey`; this keeps
 * both key shapes selectable without merchant-specific forks.
 */
export function catalogProductModelSlug(value) {
  const slug = String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  return slug || null;
}

/**
 * Expand a resolved catalog product into every model token that may appear in
 * published procedure `applies_to_models` (stable shop/product key + handle /
 * title / alias slugs).
 */
export function expandProductSupportModelTokens({
  modelKey = null,
  handle = null,
  title = null,
  aliases = [],
} = {}) {
  const tokens = new Set();
  if (modelKey) tokens.add(String(modelKey));
  for (const raw of [handle, title, ...(Array.isArray(aliases) ? aliases : [])]) {
    const slug = catalogProductModelSlug(raw);
    if (slug) tokens.add(slug);
  }
  return [...tokens];
}

/** True when a published applies_to_models list covers any resolved model token. */
export function procedureAppliesToProductModel(appliesToModels, modelTokens) {
  const wanted = new Set(
    (Array.isArray(modelTokens) ? modelTokens : [modelTokens])
      .filter((token) => token != null && String(token).trim())
      .map((token) => String(token)),
  );
  if (!wanted.size) return false;
  return (Array.isArray(appliesToModels) ? appliesToModels : [])
    .some((model) => wanted.has(String(model)));
}

function issueFamilyForText(value) {
  const text = String(value ?? "");
  if (/audio/i.test(text) && /charg/i.test(text)) return "audio";
  if (/(?:dongle|receiver)/i.test(text) && /(?:driver|reset)/i.test(text)) return "connectivity";
  return ISSUE_FAMILIES.find((candidate) => candidate.terms.test(text))?.family || null;
}

/**
 * Normalize both the new generic issue-family field and the old frozen
 * problem_key field.  Existing releases remain readable while newly compiled
 * merchant documents never need a merchant-specific problem id.
 */
export function canonicalProductSupportIssueFamily(value) {
  const text = String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!text) return null;
  if (/audio/.test(text) && /charg/.test(text)) return "audio";
  const direct = ISSUE_FAMILIES.find((candidate) => candidate.family === text)?.family;
  if (direct) return direct;
  // Compatibility for frozen releases that pre-date the generic family field.
  if (/microphone|mic|mikrofon/.test(text)) return "microphone";
  if (/app|mobile|bluetooth/.test(text) && /pair|parr|connect|forbind|disconnected|afbrudt/.test(text)) return "app_pairing";
  if (/firmware|software|driver|opdater/.test(text)) return "firmware";
  if (/audio|hiss|crack|distort|pulsat|lyd|knitren|knitrer|skratter|forvræng|sidetone/.test(text)) return "audio";
  if (/power|turn on|turn off|charg|oplad|tænd|sluk|einschalt/.test(text)) return "power";
  if (/interference|drop out|cut out|wireless|audio while|skratter|knitrer/.test(text)) return "wireless_interference";
  if (/dongle|receiver|connect|forbind|reconnect|genforbind|pairing|parr|disconnected|afbrudt/.test(text)) return "connectivity";
  return text;
}

/**
 * When several issue families match the same message, pick the one whose typed
 * routing concepts best explain the customer need. Declaration order alone lets
 * a secondary mention (e.g. microphone / bluetooth) shadow the primary symptom
 * (wired USB, sidetone, wireless crackle).
 *
 * Uses only already-published concept vocabulary — no merchant phrase maps.
 */
export function selectPrimaryIssueFamily(families = [], concepts = []) {
  const list = [...new Set((Array.isArray(families) ? families : []).filter(Boolean))];
  if (list.length <= 1) return list[0] ?? null;
  const conceptSet = new Set((Array.isArray(concepts) ? concepts : []).map((c) => String(c)));
  // Physical wire cues — not mere "disconnected" which also lights wired_connection.
  const hasPhysicalWireCue = [...conceptSet].some((concept) =>
    /^(?:usb|wired|cable|cables|cord|cords)(?:-?c)?$/i.test(concept));
  const affinity = {
    microphone: ["microphone"],
    app_pairing: ["app_pairing"],
    firmware: [],
    power: ["power"],
    wireless_interference: ["ear_audio", "wireless_receiver"],
    audio: ["ear_audio", "ear_pads", "sidetone"],
    // wired_connection alone is too weak (matches "disconnected"); require physical wire cue.
    connectivity: ["wireless_receiver"],
  };
  let best = list[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  const tiebreak = [
    "wireless_interference",
    "connectivity",
    "power",
    "firmware",
    "audio",
    "app_pairing",
    "microphone",
  ];
  for (const family of list) {
    const keys = affinity[family] || [];
    let score = keys.reduce((n, key) => n + (conceptSet.has(key) ? 1 : 0), 0);
    // Decisive typed bridges when multiple families matched the same prose.
    if (family === "connectivity" && conceptSet.has("wired_connection") && hasPhysicalWireCue) {
      score += 3;
    }
    if (family === "app_pairing" && conceptSet.has("app_pairing") && !hasPhysicalWireCue) {
      score += 2;
    }
    if (family === "audio" && (conceptSet.has("sidetone") || conceptSet.has("ear_audio"))) score += 2;
    if (family === "wireless_interference"
      && conceptSet.has("ear_audio")
      && conceptSet.has("wireless_receiver")) {
      score += 3;
    }
    // Secondary mention demotions — only when a stronger competing family matched.
    if (family === "microphone"
      && (list.includes("audio") || list.includes("wireless_interference"))
      && (conceptSet.has("sidetone") || conceptSet.has("ear_audio"))) {
      score -= 1;
    }
    if (family === "app_pairing"
      && list.includes("connectivity")
      && conceptSet.has("wired_connection")
      && hasPhysicalWireCue) {
      score -= 1;
    }
    const betterScore = score > bestScore;
    const betterTie = score === bestScore
      && tiebreak.indexOf(family) >= 0
      && (tiebreak.indexOf(best) < 0 || tiebreak.indexOf(family) < tiebreak.indexOf(best));
    if (betterScore || betterTie) {
      bestScore = score;
      best = family;
    }
  }
  // If nothing scored above baseline, keep declaration order for stability.
  return bestScore > 0 ? best : list[0];
}

function hasExplicitFailure(value) {
  return /\b(?:not\s+(?:working|connecting|pairing)|doesn['’]?t\s+work|(?:won['’]?t|will\s+not)\s+(?:work|connect|turn\s+on)|fails?|failed|cannot|can['’]?t|kan\s+ikke|kunne\s+ikke|virker\s+ikke|unclear|no\s+(?:voice|sound)|lost\s+(?:connection|signal)|disconnected|afbrudt|problem|issue|troubleshoot|fejlsøg(?:e|ning)?|broken|crack(?:ed|ing)?|damage(?:d)?|water\s+damage|physical\s+damage)\b/i.test(String(value ?? ""));
}

// Frozen releases used a problem_key vocabulary. This compatibility alias is
// intentionally derived from the generic family and is never emitted by the
// new compiler payload.
function legacyProblemKeyForFamily(family) {
  return {
    microphone: "mic_not_working",
    connectivity: "dongle_connection_lost",
    app_pairing: "mobile_app_pairing",
    firmware: "firmware_update",
    power: "power_not_turning_on",
    wireless_interference: "wireless_interference",
    audio: "audio_while_charging",
  }[family] ?? family;
}

/** Extract generic, deterministic conditions from merchant prose. */
export function extractProductSupportSignals(value) {
  const text = String(value ?? "").replace(/[\u2018\u2019]/g, "'");
  const families = ISSUE_FAMILIES.filter((candidate) => candidate.terms.test(text)).map((candidate) => candidate.family);
  if (/audio/i.test(text) && /charg/i.test(text)) {
    families.splice(0, families.length, "audio");
  }
  const conditions = [];
  if (/(?:cable|wired|usb[- ]?c)/i.test(text) && /(?:works?|working|fine|ok)/i.test(text)
    && /(?:dongle|receiver|wireless)/i.test(text) && /(?:not|doesn['’]?t|won['’]?t|fail|problem|issue)/i.test(text)) {
    conditions.push("wired_path_works", "wireless_receiver_path_fails");
  }
  if (/(?:led|light|indicator)/i.test(text) && /white/i.test(text)) conditions.push("indicator_white");
  if (/(?:charge|charging)/i.test(text) && /(?:computer|usb)/i.test(text)) conditions.push("charging_from_computer");
  if (/(?:already|previously|have)\s+(?:tried|completed)/i.test(text)) conditions.push("prior_steps_attempted");
  const contextConditions = [];
  // Product SKU names like "A-Spire Wireless" must not imply a dongle/receiver
  // context for unrelated families (e.g. charging/power). Require an actual
  // wireless-path cue: dongle, receiver, or "wireless adapter".
  if (/\b(?:dongle|receiver|wireless\s+(?:adapter|dongle|receiver|usb))\b/i.test(text)) {
    contextConditions.push("wireless_receiver_mentioned");
  }
  const excludesConditions = [];
  // A sentence such as "the cable works but not the dongle" is the positive
  // condition for the receiver-specific procedure, not an exclusion of the
  // receiver.  Only mark the receiver as excluded when no corresponding
  // failure condition was extracted.
  if (!conditions.includes("wireless_receiver_path_fails")
    && /(?:wired|cable)[\s\S]{0,100}\bnot\b[\s\S]{0,60}(?:wireless|dongle|receiver)/i.test(text)) {
    excludesConditions.push("wireless_receiver_mentioned");
  }
  return {
    families: [...new Set(families)],
    conditions: [...new Set(conditions)],
    contextConditions: [...new Set(contextConditions)],
    excludesConditions: [...new Set(excludesConditions)],
    explicitFailure: hasExplicitFailure(text),
  };
}

function actionForStep(text) {
  const match = ACTION_HINTS.find(([, pattern]) => pattern.test(text));
  return match ? { action: match[0] } : undefined;
}

function branchForStep(text) {
  if (/led\s+(?:turns?|is)\s+white/i.test(text) && /reconnect|unplug/i.test(text)) {
    return {
      when_observe: "led_white",
      then_action: "reconnect_dongle",
      else_observe: "led_blue_red_flashing",
    };
  }
  return null;
}

function preconditionsForText(value) {
  const preconditions = [];
  if (/must\s+(?:stay|remain|be)\s+(?:powered\s+)?on|powers?\s+on\s+stably/i.test(value)) {
    preconditions.push({
      fact: "product_unit.powers_on_stably",
      must_be: "true",
      explain: "the product must stay powered on while the procedure is followed",
    });
  }
  if (/can\s+enter\s+pairing\s+mode|pairing\s+mode\s+is\s+available/i.test(value)) {
    preconditions.push({
      fact: "product_unit.can_enter_pairing_mode",
      must_be: "true",
      explain: "the product must be able to enter pairing mode",
    });
  }
  return preconditions;
}

/**
 * Parse the small, safe Product Support authoring contract. A product id is
 * supplied by the server from the authorized catalog; it is never inferred
 * from a display name.
 */
export function parseProductSupportGuidance(
  content,
  { shopId, productId, productExternalId = null } = {},
) {
  const original = String(content ?? "").replace(/\r\n?/g, "\n").trim();
  const issues = [];
  const unsupported = [];
  if (!original) {
    return {
      ok: false,
      productId: String(productId || ""),
      productExternalId,
      modelKey: stableProductModelKey({ shopId, productId }),
      issueFamily: null,
      issueKey: null,
      issueSentence: "",
      steps: [],
      preconditions: [],
      conditions: [],
      contextConditions: [],
      excludesConditions: [],
      specificityRank: 0,
      triggers: [],
      unsupported: [],
      ambiguities: [],
    };
  }

  const marker = original.match(/\b(?:first|step\s*1|1[.)])\b/i);
  const issueSentence = marker
    ? clean(original.slice(0, marker.index).replace(/[,:-]\s*$/, ""))
    : "";
  const signalText = issueSentence || original;
  const signals = extractProductSupportSignals(signalText);
  const fullSignals = extractProductSupportSignals(original);
  const issueFamily = issueFamilyForText(signalText) || signals.families[0] || null;
  const explicitProcedureHeading = /\b(?:pair(?:ing)?|connect(?:ivity|ion)?|firmware|update|charging|power|interference|microphone|mic|dongle|receiver)\b/i.test(issueSentence);
  if (!issueFamily) {
    unsupported.push({
      code: "product_support_topic_unsupported",
      sentence: original,
      message:
        "Name a supported product issue such as a microphone, connection, app pairing, firmware, power, charging or wireless interference problem.",
    });
  } else if (!signals.explicitFailure && !explicitProcedureHeading) {
    unsupported.push({
      code: "product_support_issue_not_explicit",
      sentence: original,
      message: "Describe the product problem or a clearly ordered troubleshooting procedure before it can be made executable.",
    });
  }

  // A lead-in ending in “first”/“step 1” identifies the issue sentence while
  // preserving the merchant's exact step wording as evidence.
  const stepText = marker ? original.slice(marker.index) : original;
  const sentences = splitSentences(stepText);
  const steps = sentences
    .map((text, index) => ({
      id: `s${index + 1}`,
      order: index + 1,
      text: clean(text.replace(/^first\s+/i, "")),
      op: actionForStep(text),
      branch: branchForStep(text),
    }))
    .filter((step) => step.text.length >= 3);
  if (steps.length < 2) {
    unsupported.push({
      code: "product_support_steps_required",
      sentence: original,
      message: "Add at least two ordered steps so Sona can guide the customer safely.",
    });
  }

  const preconditions = preconditionsForText(original);
  if (/if\s+[^.]+\b(?:otherwise|else)\b/i.test(original) && !steps.some((step) => step.branch)) {
    issues.push({
      code: "product_support_branch_unsupported",
      sentence: original,
      message: "This branch is not one of the supported device-observation branches yet.",
    });
  }

  return {
    ok: unsupported.length === 0 && issues.length === 0,
    productId: String(productId || ""),
    productExternalId,
    modelKey: stableProductModelKey({ shopId, productId }),
    issueFamily,
    // issueKey is retained as an in-memory compatibility alias for callers
    // that have not yet moved to the generic family name.
    issueKey: legacyProblemKeyForFamily(issueFamily),
    issueSentence,
    steps,
    preconditions,
    conditions: signals.conditions,
    excludesConditions: [...new Set(fullSignals.excludesConditions)],
    specificityRank: 10 + (signals.conditions.length * 10),
    triggers: signals.families,
    unsupported,
    ambiguities: issues,
  };
}

function normalizedHeading(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizedContent(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[`*_>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Generic, merchant-neutral concepts used to route product facts and
// compatibility/accessory sections. They are deliberately broader than the
// frozen troubleshooting families: a product document may answer a question
// without defining a new issue enum.
const PRODUCT_CONCEPT_ALIASES = [
  // These document-shape concepts make an explicitly titled overview or
  // specification section addressable without turning arbitrary prose into
  // runtime knowledge.  A question such as “what is this product?” can
  // therefore select a published overview, while an unrelated paragraph
  // remains evidence-only.
  ["product_overview", /\b(?:overview|description|features?|specifications?|product\s+information|details?)\b/i],
  ["usage_limitation", /\b(?:limitations?|not\s+supported|not\s+compatible|cannot\s+use|can['’]?t\s+use|do\s+not\s+use|only\s+works?)\b/i],
  ["wireless_receiver", /\b(?:dongle|receiver|wireless\s+adapter|usb\s+adapter)\b/i],
  // Shared concept bridge for partial wired/cable guidance and customer
  // disconnect wording. Must not invent a full USB-enumeration procedure.
  ["wired_connection", /\b(?:wired|cables?|cords?|usb(?:-c)?|jack|plugs?|plugged|unplugg?(?:ed|ing)?|reconnect(?:ion|ing)?|disconnect(?:ing|ed|s)?|loose\s+connections?|connections?)\b/i],
  ["ear_audio", /\b(?:ear\s*cup|earpiece|one[- ]ear|left\s+ear|right\s+ear|audio|sound|hiss(?:ing)?|crack(?:ling)?|skratter|knitrer|knitren|cut[- ]?outs?)\b/i],
  ["ear_pads", /\b(?:ear\s*pad|ear\s*cushion|earcup\s+pad|spare\s+parts?|replacement\s+part)\b/i],
  ["sidetone", /\b(?:sidetone|side[- ]?tone|hear\s+(?:my|myself|own)\s+voice|høre\s+mig\s+selv)\b/i],
  ["app_pairing", /\b(?:app|mobile|bluetooth|pair(?:ing)?|reconnect)\b/i],
  ["compatibility", /\b(?:compatible|compatibility|works?\s+with|supported\s+(?:on|for)|console|playstation|ps\s*\d|xbox|windows|mac(?:os)?|android|ios)\b/i],
  ["power", /\b(?:battery|batteries|charge|charging|power|drain(?:ing)?|turn\s+on|turn\s+off|einschalt(?:en|et)?)\b/i],
  ["microphone", /\b(?:microphone|mic|voice|mut(?:e|ed))\b/i],
  ["physical_damage", /\b(?:broken|damage(?:d)?|crack(?:ed)?|repair|replacement|wear|water)\b/i],
  ["escalation", /\b(?:contact|support|human|colleague|review|escalat(?:e|ion)|service|repair)\b/i],
];

const PRODUCT_CONCEPT_STOPWORDS = new Set([
  "the", "and", "or", "with", "without", "this", "that", "these", "those", "your", "my", "our", "their",
  "can", "could", "would", "should", "does", "do", "did", "is", "are", "was", "were", "be", "been", "being",
  "what", "where", "when", "why", "how", "which", "who", "please", "help", "need", "want", "like", "just",
  "product", "headset", "headphones", "customer", "customers", "first", "then", "also", "only", "not", "very",
  "for", "about", "know", "getting", "information", "question", "questions", "section", "sections",
  "works", "work", "use", "using", "used", "make", "made", "get", "gets", "got", "have", "has", "had",
]);

/** Extract generic routing concepts without introducing merchant-specific keys. */
export function extractProductKnowledgeConcepts(value) {
  const text = String(value ?? "").toLowerCase().replace(/[’']/g, "");
  const concepts = PRODUCT_CONCEPT_ALIASES
    .filter(([, pattern]) => pattern.test(text))
    .map(([concept]) => concept);
  const tokens = text
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !PRODUCT_CONCEPT_STOPWORDS.has(token));
  return [...new Set([...concepts, ...tokens])];
}

function responseFactsForSection(section) {
  return String(section?.content ?? "")
    .replace(/\r\n?/g, "\n")
    .split(/\n+|(?<=[.!?])\s+/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !/^(?:use|choose|start with|do not|don't)\s+(?:this|the)\s+(?:guide|procedure)\b/i.test(line))
    // Product documents may contain operational notes alongside customer
    // facts. Keep those notes as source evidence, but never put agent/writer
    // instructions into the runtime brief.
    .filter((line) => !/\b(?:internal|agent|writer|merchant|runtime|customer[- ]facing|knowledge|troubleshooting\s+guide|procedure)\b/i.test(line))
    // Keep customer-facing negative boundaries (for example “Do not use this
    // with Xbox”). Only discard operational instructions that tell the agent
    // how to use the document or how to phrase the answer.
    .filter((line) => !/^(?:always|never|do not|don't)\s+(?:promise|guarantee|tell|ask|clarify|confirm|repeat|restart|skip)\b/i.test(line));
}

function classifyKnowledgeSectionKind(section, { procedure = false } = {}) {
  if (section.internal) return "internal_guidance";
  if (procedure) return "procedure";
  const text = `${section.heading} ${section.content}`;
  if (!section.content.trim()) return "evidence_only";
  // A section can have a neutral heading while its body is explicitly
  // addressed to the agent/operator. Keep it as internal evidence even when
  // the same document also contains customer-facing sections.
  if (!responseFactsForSection(section).length
    && /\b(?:internal|agent|writer|merchant|runtime|customer[- ]facing|knowledge|troubleshooting|procedure)\b/i.test(text)) {
    return "internal_guidance";
  }
  // Curated support sections sometimes contain an explicit operator-only
  // boundary instead of an "Internal guidance" heading.  A statement that
  // verified material is insufficient, followed by an instruction to clarify
  // or escalate rather than guess, is evidence of a coverage gap—not a
  // customer-facing product fact.
  if (/(?:no|not|without|does\s+not|doesn['’]?t)[^.!?\n]{0,100}(?:sufficient|verified|reliable)[^.!?\n]{0,80}(?:guidance|information|details)/i.test(text)
    && /\b(?:clarif(?:y|ying)|escalat(?:e|ion)|do not invent|rather than guessing|do not guess)\b/i.test(text)) {
    return "internal_guidance";
  }
  if (/\b(?:needs?\s+review|ambiguous|unclear|conflict(?:ing)?|contradict(?:ory|ion))\b/i.test(text)) return "needs_review";
  if (/\b(?:overview|description|features?|specifications?|product\s+information|details?|how\s+it\s+works|product\s+behavior)\b/i.test(section.heading)) return "fact";
  if (/\b(?:battery|power|charging|charge)\b/i.test(section.heading)) return "fact";
  if (/\b(?:physical\s+damage|broken|cracked|water\s+damage|repair|escalat(?:e|ion))\b/i.test(section.heading)) return "escalation";
  if (/\b(?:not\s+supported|not\s+compatible|cannot|can['’]?t|won['’]?t|only\s+works?|limitation|avoid|do\s+not\s+use|not\s+available)\b/i.test(text)) return "limitation";
  if (/\b(?:compatible|compatibility|works?\s+with|supported\s+(?:on|for)|console|playstation|ps\s*\d|xbox|windows|mac(?:os)?|android|ios)\b/i.test(text)) return "compatibility";
  if (/\b(?:included|included\s+in|comes?\s+with|in\s+the\s+box|dongle|receiver|ear\s*pad|ear\s*cushion|cushion|spare\s+part|accessor(?:y|ies)|replacement(?:\s+part|\s+cushion|\s+pad)?)\b/i.test(text)) return "accessory";
  if (/\b(?:contact|support|human|colleague|review|escalat(?:e|ion)|service|repair|broken|damage(?:d)?|water)\b/i.test(text)) return "escalation";
  const knownConcepts = new Set(PRODUCT_CONCEPT_ALIASES.map(([concept]) => concept));
  return extractProductKnowledgeConcepts(text).some((concept) => knownConcepts.has(concept)) ? "fact" : "evidence_only";
}

function structuredSectionFor(section, kind, { shopId, productId, productExternalId, sourceId, policyId }) {
  const responseFacts = responseFactsForSection(section);
  const text = `${section.heading} ${section.content}`;
  const signals = extractProductSupportSignals(text);
  const concepts = extractProductKnowledgeConcepts(text);
  const titleConcepts = extractProductKnowledgeConcepts(section.heading);
  return {
    section_kind: kind,
    title: section.heading,
    meaning: section.heading,
    trigger_concepts: concepts,
    title_concepts: titleConcepts,
    // Context mentions (for example “dongle” in an accessory fact) are
    // routing concepts, not prerequisites. Only explicit typed conditions
    // gate a section at runtime.
    // Generic sections are customer-facing facts, compatibility notes, or
    // escalation guidance. Mentions such as “charge from a computer” are
    // context, not runtime prerequisites; only the frozen procedure compiler
    // may emit typed conditions that gate selection.
    conditions: [],
    exclusions: signals.excludesConditions ?? [],
    response_facts: responseFacts,
    ordered_steps: [],
    escalation_conditions: kind === "escalation" ? concepts : [],
    specificity_rank: Math.max(1, Math.min(50, concepts.length + (kind === "fact" ? 1 : 5))),
    internal_only: false,
    customer_facing: true,
    applies_to_models: [stableProductModelKey({ shopId, productId })],
    product_binding: {
      shop_id: `shop_${String(shopId).replace(/[^a-zA-Z0-9]+/g, "_")}`,
      product_id: String(productId),
      external_id: productExternalId ? String(productExternalId) : null,
    },
    provenance: sourceId ? [{ source_id: sourceId, role: "supports" }] : [],
    source_section: section.heading,
  };
}

// A merchant document may put routing/triage notes immediately above the
// ordered checks. Keep those notes as source evidence, but do not promote
// them to customer-facing procedure steps.
function customerProcedureContent(section) {
  return section.content
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph
      && !/^(?:use|choose|start with)\s+(?:this|the)\s+(?:guide|procedure)\b/i.test(paragraph)
      && !/^(?:do not|don't)\s+(?:use|choose|start with)\s+(?:this|the)\s+(?:guide|procedure)\b/i.test(paragraph)
      && !/^(?:if|when)\s+.+\b(?:instead|rather than)\b/i.test(paragraph))
    .join("\n");
}

/**
 * Split the merchant document at markdown headings.  A product document is
 * allowed to contain descriptive facts, customer-facing answers and internal
 * operating guidance. Procedures use the frozen typed contract; safe facts
 * and other customer-facing sections use generic structured guidance below.
 */
export function splitProductSupportDocument(content) {
  const lines = String(content ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const sections = [];
  let current = { heading: "General guidance", level: 0, lines: [], internal: false };
  const headingStack = [];
  const flush = () => {
    const body = current.lines.join("\n").trim();
    if (body || current.heading !== "General guidance") {
      sections.push({
        heading: current.heading.trim(),
        level: current.level,
        internal: current.internal,
        content: body,
        normalizedHeading: normalizedHeading(current.heading),
        normalizedContent: normalizedContent(body),
      });
    }
  };
  for (const line of lines) {
    const match = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (match) {
      flush();
      const level = match[1].length;
      while (headingStack.length && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      const heading = match[2];
      const internal = headingStack.some((entry) => entry.internal)
        || /internal(?: troubleshooting)? guidance/i.test(heading);
      current = { heading, level, lines: [], internal };
      headingStack.push({ level, internal });
    } else {
      current.lines.push(line);
    }
  }
  flush();
  return sections;
}

function supportedProcedureFamilyForHeading(heading, content = "") {
  const value = `${heading} ${content}`;
  const signals = extractProductSupportSignals(value);
  const family = issueFamilyForText(heading) || signals.families[0] || null;
  if (!family) return null;
  // Damage/replacement/escalation headings are safe customer-facing handover
  // guidance, not executable troubleshooting procedures, even when the body
  // contains ordered review questions. Keep them generic and typed as
  // escalation so the evaluator never promises a remedy.
  if (/(?:broken|damage|crack|water|repair|replacement|escalat|physical)/i.test(heading)
    && !/(?:firmware|update|pair|connect|reset|power|charg|microphone|mic|interference|audio|sound|hiss|pulsat)/i.test(heading)) return null;
  // A heading that is only a product fact (for example “Microphone”) is
  // evidence, not a procedure.  Explicit failure/procedure wording is needed
  // before the section becomes executable.
  // A neutral heading such as “Dongle” can still introduce a safe procedure
  // when its body contains explicit ordered actions.  Facts such as “The
  // dongle is included in the box” do not pass this gate because they lack
  // both an ordered marker and an actionable verb.
  const orderedProcedureEvidence = /(?:^|\n)\s*(?:first\b|\d+[.)]\s|[-*•]\s)/i.test(content)
    && /\b(?:check|confirm|connect|disconnect|reconnect|press|hold|select|open|enable|disable|remove|install|update|reset|test|try|charge|pair|plug|wait)\b/i.test(content);
  // A heading such as “Device pairing” or “Microphone” is document
  // structure, not an executable procedure. Promote it only when the body
  // contains explicit failure language or ordered actionable steps.
  return signals.explicitFailure || orderedProcedureEvidence ? family : null;
}

/**
 * Parse a complete canonical Product Knowledge document. Every section keeps
 * its source evidence and receives a generic classification. Procedures use
 * the frozen troubleshooting contract; customer-facing non-procedure sections
 * become structured guidance units.
 */
export function parseProductSupportDocument(
  content,
  { shopId, productId, productExternalId = null } = {},
) {
  const sections = splitProductSupportDocument(content);
  const unsupported = [];
  const ambiguities = [];
  const units = [];
  const seenProcedureShapes = new Set();
  const seenSections = new Set();
  const sectionResults = [];

  // Preserve the original compact authoring contract for a plain paragraph
  // without document headings. A plain paragraph that is not a safe procedure
  // is still usable as a customer-facing fact when it is not ambiguous.
  if (sections.length === 1 && sections[0].heading === "General guidance") {
    const parsed = parseProductSupportGuidance(String(content ?? ""), {
      shopId,
      productId,
      productExternalId,
    });
    if (parsed.ok) {
      sectionResults.push({ ...sections[0], classification: "procedure", kind: "procedure", typed: true, procedureKey: parsed.issueKey });
      units.push({ section: sections[0], parsed, kind: "procedure" });
    } else {
      const kind = classifyKnowledgeSectionKind(sections[0]);
      if (["fact", "compatibility", "accessory", "limitation", "escalation"].includes(kind)) {
        const structured = structuredSectionFor(sections[0], kind, { shopId, productId, productExternalId });
        if (structured.response_facts.length) {
          sectionResults.push({ ...sections[0], classification: kind, kind, typed: true });
          units.push({ section: sections[0], kind, structured });
        } else {
          unsupported.push({
            code: "product_support_customer_facts_missing",
            section: sections[0].heading,
            sentence: sections[0].content,
            message: "This section has no customer-facing facts that can be represented safely.",
          });
          sectionResults.push({ ...sections[0], classification: "evidence_only", kind: "evidence_only", typed: false });
        }
      } else {
        unsupported.push(...(parsed.unsupported || []));
        ambiguities.push(...(parsed.ambiguities || []));
        sectionResults.push({ ...sections[0], classification: kind, kind, typed: false });
      }
    }
    return {
      ok: units.length > 0 && ambiguities.length === 0,
      sections: sectionResults,
      units,
      unsupported,
      ambiguities,
    };
  }

  for (const section of sections) {
    const duplicateKey = `${section.normalizedHeading}:${section.normalizedContent}`;
    if (seenSections.has(duplicateKey)) {
      unsupported.push({
        code: "product_support_duplicate_section",
        section: section.heading,
        sentence: section.content,
        message: "This section duplicates another section in the product document and remains evidence only.",
      });
      sectionResults.push({ ...section, classification: "evidence_only", kind: "evidence_only", duplicate: true, typed: false });
      continue;
    }
    seenSections.add(duplicateKey);

    if (section.internal) {
      unsupported.push({
        code: "product_support_internal_evidence_only",
        section: section.heading,
        sentence: section.content,
        message: "Internal troubleshooting guidance remains source evidence and is not promoted to customer-facing runtime steps.",
      });
      sectionResults.push({ ...section, classification: "internal_guidance", kind: "internal_guidance", typed: false });
      continue;
    }

    // Keep the heading as the issue signal, but do not turn it into an
    // executable troubleshooting step.  The previous concatenation made a
    // heading such as “dongle pairing” become step 1, which polluted the
    // frozen brief and could leave the writer with no valid answer segments.
    // The explicit “First” marker preserves the heading-derived issue while
    // making the section body the ordered procedure evidence.
    const procedureContent = customerProcedureContent(section);
    const procedureKey = supportedProcedureFamilyForHeading(section.heading, procedureContent);
    const sectionText = [section.heading, procedureContent ? `First ${procedureContent}` : ""]
      .filter(Boolean)
      .join(". ")
      .trim();
    const parsed = parseProductSupportGuidance(sectionText, {
      shopId,
      productId,
      productExternalId,
    });
    if (!procedureKey) {
      const kind = classifyKnowledgeSectionKind(section);
      if (["fact", "compatibility", "accessory", "limitation", "escalation"].includes(kind)) {
        const structured = structuredSectionFor(section, kind, { shopId, productId, productExternalId });
        if (structured.response_facts.length) {
          sectionResults.push({ ...section, classification: kind, kind, typed: true });
          units.push({ section, kind, structured });
        } else {
          unsupported.push({
            code: "product_support_customer_facts_missing",
            section: section.heading,
            sentence: section.content,
            message: "This section has no customer-facing facts that can be represented safely.",
          });
          sectionResults.push({ ...section, classification: "evidence_only", kind: "evidence_only", typed: false });
        }
      } else {
        unsupported.push({
          code: `product_support_${kind}`,
          section: section.heading,
          sentence: section.content,
          message: "This product section remains source evidence until it can be represented safely.",
        });
        sectionResults.push({ ...section, classification: kind, kind, typed: false });
      }
      continue;
    }
    const shapeKey = `${procedureKey}:${[...(parsed.conditions ?? [])].sort().join(",")}`;
    if (seenProcedureShapes.has(shapeKey)) {
      unsupported.push({
        code: "product_support_duplicate_procedure",
        section: section.heading,
        sentence: section.content,
        message: `Another section already defines the ${procedureKey} procedure; this copy remains evidence only.`,
      });
      sectionResults.push({ ...section, classification: "evidence_only", kind: "evidence_only", duplicate: true, typed: false });
      continue;
    }
    if (!parsed.ok || parsed.issueFamily !== procedureKey) {
      // A section can mention a secondary symptom (for example a firmware
      // check inside a power-recovery guide).  The heading gates the allowed
      // contract; retain the parsed steps but normalize the procedure key to
      // that supported section shape when the ordered steps are otherwise
      // complete and unambiguous.
      // A heading may carry the supported procedure family while the body
      // starts with an authoring instruction (for example "Use this guide
      // when…") that is intentionally removed from customer-facing steps.
      // In that case the parser can report only a topic-unsupported finding
      // even though the remaining ordered steps are safe and deterministic.
      // Promote only this narrow, unambiguous shape; every other unsupported
      // or ambiguous section remains evidence/needs-review.
      const onlyTopicUnsupported = (parsed.unsupported ?? []).length > 0
        && (parsed.unsupported ?? []).every((finding) => finding.code === "product_support_topic_unsupported");
      if (procedureKey && parsed.steps.length >= 2 && !parsed.ambiguities?.length
        && (parsed.ok || onlyTopicUnsupported)) {
        const normalizedParsed = {
          ...parsed,
          ok: true,
          unsupported: [],
          issueKey: legacyProblemKeyForFamily(procedureKey),
          issueFamily: procedureKey,
        };
        seenProcedureShapes.add(shapeKey);
        sectionResults.push({ ...section, classification: "procedure", kind: "procedure", typed: true, procedureKey });
        units.push({ section, parsed: normalizedParsed, kind: "procedure" });
        continue;
      }
      const findings = [...(parsed.unsupported || []), ...(parsed.ambiguities || [])];
      const finding = findings[0] || {
        code: "product_support_procedure_incomplete",
        message: "The section names a supported procedure but does not contain two safe ordered steps.",
        sentence: section.content,
      };
      ambiguities.push({ ...finding, section: section.heading });
      sectionResults.push({ ...section, classification: "needs_review", kind: "needs_review", typed: false });
      continue;
    }
    seenProcedureShapes.add(shapeKey);
    sectionResults.push({ ...section, classification: "procedure", kind: "procedure", typed: true, procedureKey: parsed.issueKey });
    units.push({ section, parsed, kind: "procedure" });
  }

  return {
    ok: units.length > 0 && ambiguities.length === 0,
    sections: sectionResults,
    units,
    unsupported,
    ambiguities,
  };
}

export function compileProductSupportProcedure({
  parsed,
  shopId,
  productId,
  productExternalId = null,
  sourceId,
  policyId,
  unitId = randomUUID(),
}) {
  if (!parsed?.ok || !(parsed.issueFamily || parsed.issueKey) || parsed.steps.length < 2) return null;
  const issueFamily = parsed.issueFamily || parsed.issueKey;
  return {
    unit_id: unitId,
    kind: "procedure",
    domain_key: "product_support",
    family_key: "DIAG",
    slot_key: null,
    audience: "customer",
    scope: {},
    payload: {
      section_kind: "procedure",
      title: parsed.issueSentence || parsed.issueFamily || "Product support procedure",
      meaning: parsed.issueSentence || parsed.issueFamily || "Product support procedure",
      issue_family: issueFamily,
      // Generic trigger/condition metadata is what dispatch uses to choose a
      // procedure. It is intentionally separate from the merchant's prose.
      triggers: parsed.triggers ?? [],
      conditions: parsed.conditions ?? [],
      excludes_conditions: parsed.excludesConditions ?? [],
      specificity_rank: Number(parsed.specificityRank ?? 0),
      internal_only: false,
      customer_facing: true,
      title_concepts: extractProductKnowledgeConcepts(parsed.issueSentence ?? parsed.issueFamily ?? ""),
      trigger_concepts: extractProductKnowledgeConcepts(`${parsed.issueSentence ?? ""} ${(parsed.triggers ?? []).join(" ")}`),
      escalation_conditions: [],
      applies_to_models: [parsed.modelKey],
      product_binding: {
        // Keep the shop scope in a deterministic, non-UUID key. UUID-shaped
        // strings in arbitrary payload paths are rejected by the platform
        // reference validator; the stable model key below still carries the
        // full shop-scoped identity used by the evaluator.
        shop_id: `shop_${String(shopId).replace(/[^a-zA-Z0-9]+/g, "_")}`,
        product_id: String(productId),
        external_id: productExternalId ? String(productExternalId) : null,
      },
      preconditions: parsed.preconditions,
      steps: parsed.steps,
      on_exhausted: { exit_domain: "complaints_warranty" },
      provenance: sourceId ? [{ source_id: sourceId, role: "supports" }] : [],
    },
    origin_policy_id: policyId,
    evidence: parsed.steps.map((step) => step.text),
  };
}

/** Compile a customer-facing fact/compatibility/accessory section as guidance. */
export function compileProductSupportKnowledgeSection({
  section,
  kind,
  shopId,
  productId,
  productExternalId = null,
  sourceId,
  policyId,
  unitId = randomUUID(),
}) {
  if (!section?.content?.trim() || !["fact", "compatibility", "accessory", "limitation", "escalation"].includes(kind)) return null;
  const structured = structuredSectionFor(section, kind, {
    shopId,
    productId,
    productExternalId,
    sourceId,
    policyId,
  });
  if (!structured.response_facts.length) return null;
  return {
    unit_id: unitId,
    kind: "guidance",
    domain_key: "product_support",
    family_key: "DIAG",
    slot_key: null,
    audience: "customer",
    scope: {},
    payload: structured,
    origin_policy_id: policyId,
    evidence: structured.response_facts,
  };
}

export { stableProductModelKey };
