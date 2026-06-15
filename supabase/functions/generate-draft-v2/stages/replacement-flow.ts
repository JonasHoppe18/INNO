// supabase/functions/generate-draft-v2/stages/replacement-flow.ts
//
// Multi-turn troubleshooting → replacement/warranty flow control.
//
// Observed failure (A-Spire Wireless Bluetooth):
//   1. Sona repeats the SAME Bluetooth pairing steps after the customer has
//      already said they did not work.
//   2. When the customer asks "Kan jeg få et nyt?" Sona treats it as a generic
//      `other` instead of a replacement/warranty request.
//   3. After the customer confirms the purchase channel ("via jeres hjemmeside")
//      Sona jumps straight to "vi sender et nyt headset … du vil modtage en
//      bekræftelse når det er afsendt" WITHOUT identifying the order.
//
// This module is a deterministic, product/shop-agnostic scan of the conversation
// (agent + customer turns) that produces:
//   - the set of troubleshooting topics the AGENT already provided (so the
//     writer does not repeat them),
//   - whether troubleshooting is exhausted,
//   - whether the customer is asking for a replacement,
//   - whether the purchase source is known and whether the order is identified,
//   - a writer directive that gates the replacement flow on the order number,
//   - an intent signal so a clear replacement flow is not classified as `other`.
//
// No DB writes, no LLM, no shop/product names — patterns are generic EN + DA
// support vocabulary.

export interface ConversationTurn {
  role: "customer" | "agent";
  text: string;
}

type TroubleshootingTopic = {
  id: string;
  label: string;
  patterns: RegExp[];
};

// Generic troubleshooting topics an agent reply may contain. Each pairs an
// action/instruction with its component so a passing mention does not count.
const TROUBLESHOOTING_TOPICS: TroubleshootingTopic[] = [
  {
    id: "bluetooth_pairing",
    label: "Bluetooth pairing steps",
    patterns: [
      /\bbluetooth\b[^.]{0,60}\b(par\w*|forbind\w*|tilslut\w*|pair\w*|connect\w*|indstil\w*)/i,
      /\b(par\w*|forbind\w*|pair\w*|connect\w*)\b[^.]{0,40}\bbluetooth\b/i,
      /\bglem\s+enhed\b|\bforget\s+device\b|\bremove\s+the\s+device\b/i,
    ],
  },
  {
    id: "firmware_update",
    label: "firmware update",
    patterns: [
      /\bfirmware\b/i,
      /\bopdater\w*\b[^.]{0,30}\b(software|firmware)\b/i,
    ],
  },
  {
    id: "driver_reinstall",
    label: "driver reinstall",
    patterns: [
      /\b(geninstaller\w*|reinstall\w*)\b[^.]{0,30}\b(driver|usb)/i,
      /\bdriver\b[^.]{0,30}\b(geninstaller\w*|reinstall\w*)/i,
    ],
  },
  {
    id: "factory_reset",
    label: "factory reset",
    patterns: [/\bfactory\s+reset\b/i, /\bfabriksnulstil\w*/i, /\breset\b[^.]{0,20}\bheadset\b/i],
  },
  {
    id: "recharge",
    label: "charging / battery check",
    patterns: [/\b(oplad\w*|genoplad\w*|recharge|charge)\b[^.]{0,30}\b(headset|batteri|battery)/i],
  },
];

function lower(value: string | null | undefined): string {
  return String(value ?? "").toLowerCase();
}

function agentText(history: ConversationTurn[] | null | undefined): string {
  return (Array.isArray(history) ? history : [])
    .filter((t) => t.role === "agent")
    .map((t) => String(t.text ?? ""))
    .join("\n");
}

function customerText(history: ConversationTurn[] | null | undefined): string {
  return (Array.isArray(history) ? history : [])
    .filter((t) => t.role === "customer")
    .map((t) => String(t.text ?? ""))
    .join("\n");
}

// Troubleshooting topics the AGENT has already provided across the thread.
export function detectAgentProvidedTroubleshooting(
  history: ConversationTurn[] | null | undefined,
): string[] {
  const text = agentText(history);
  if (!text.trim()) return [];
  const found: string[] = [];
  for (const topic of TROUBLESHOOTING_TOPICS) {
    if (topic.patterns.some((p) => p.test(text))) found.push(topic.id);
  }
  return found;
}

const STILL_NOT_WORKING_RE =
  /\b(virker\s+ikke|virker\s+stadig\s+ikke|vil\s+stadig\s+ikke|stadig\s+ikke|kan\s+stadig\s+ikke|det\s+hjalp\s+ikke|ikke\s+forbinde|ikke\s+connecte|still\s+(?:not|won'?t|doesn'?t|can'?t)|doesn'?t\s+work|not\s+working|didn'?t\s+help|no\s+luck)\b/i;

// How many times the customer has reported a failure (incl. the latest message).
export function countFailedAttempts(
  history: ConversationTurn[] | null | undefined,
  latestMessage?: string | null,
): number {
  const turns = (Array.isArray(history) ? history : [])
    .filter((t) => t.role === "customer")
    .map((t) => String(t.text ?? ""));
  if (latestMessage) turns.push(String(latestMessage));
  let count = 0;
  for (const t of turns) {
    if (STILL_NOT_WORKING_RE.test(t)) count += 1;
  }
  return count;
}

const REPLACEMENT_REQUEST_RE =
  /\b(?:få\s+et\s+nyt|et\s+nyt\s+(?:headset|produkt|et)|nyt\s+headset|ny\s+enhed|ombyt\w*|ombytning|erstatning|reklam\w*|garanti|get\s+a\s+new|new\s+(?:one|unit|headset)|replace\w*|warranty|exchange)\b/i;

// Customer is asking for a replacement / warranty swap.
export function isReplacementRequest(message: string | null | undefined): boolean {
  return REPLACEMENT_REQUEST_RE.test(lower(message));
}

const PURCHASE_SOURCE_RE =
  /\b(?:købt\s+(?:det|den|the?t)?\s*(?:via|hos|på|gennem|fra)|via\s+(?:jeres|deres|din)\s+(?:hjemmeside|webshop|side|shop)|jeres\s+hjemmeside|deres\s+hjemmeside|jeres\s+webshop|på\s+jeres\s+side|bought\s+(?:it|this)?\s*(?:from|on|via|at|through)|from\s+your\s+(?:website|webshop|store|site|shop)|your\s+website|forhandler|retailer|webshop|official\s+website|acezone|amazon|proshop|elgiganten|power)\b/i;

// Customer has stated where the product was purchased.
export function isPurchaseSourceStated(message: string | null | undefined): boolean {
  return PURCHASE_SOURCE_RE.test(lower(message));
}

export interface ReplacementFlowState {
  alreadyProvidedTopics: string[];
  failedAttempts: number;
  replacementRequested: boolean;
  troubleshootingExhausted: boolean;
  purchaseSourceKnown: boolean;
  orderNumberKnown: boolean;
}

// Troubleshooting is exhausted when the agent has already worked the path and
// the customer keeps reporting failure: ≥2 distinct agent topics provided, OR a
// firmware update already suggested, paired with at least one failure report.
export function isTroubleshootingExhausted(state: {
  alreadyProvidedTopics: string[];
  failedAttempts: number;
}): boolean {
  const distinct = new Set(state.alreadyProvidedTopics);
  const enoughSteps = distinct.size >= 2 || distinct.has("firmware_update");
  return enoughSteps && state.failedAttempts >= 1;
}

export function resolveReplacementFlowState(opts: {
  history: ConversationTurn[] | null | undefined;
  latestMessage: string | null | undefined;
  purchaseSourceKnown: boolean;
  orderNumberKnown: boolean;
}): ReplacementFlowState {
  const alreadyProvidedTopics = detectAgentProvidedTroubleshooting(opts.history);
  const failedAttempts = countFailedAttempts(opts.history, opts.latestMessage);
  const replacementRequested = isReplacementRequest(opts.latestMessage) ||
    (Array.isArray(opts.history) &&
      opts.history.some((t) => t.role === "customer" && isReplacementRequest(t.text)));
  const purchaseSourceKnown = opts.purchaseSourceKnown ||
    isPurchaseSourceStated(opts.latestMessage) ||
    (Array.isArray(opts.history) &&
      opts.history.some((t) => t.role === "customer" && isPurchaseSourceStated(t.text)));
  return {
    alreadyProvidedTopics,
    failedAttempts,
    replacementRequested,
    troubleshootingExhausted: isTroubleshootingExhausted({ alreadyProvidedTopics, failedAttempts }),
    purchaseSourceKnown,
    orderNumberKnown: opts.orderNumberKnown,
  };
}

// A clear replacement/warranty flow should not be classified as generic `other`.
// Returns "exchange" when we should upgrade a weak planner intent, else null.
export function replacementIntentOverride(
  state: ReplacementFlowState,
  currentIntent: string,
): string | null {
  const weak = currentIntent === "other" || currentIntent === "product_question";
  if (!weak) return null;
  if (state.replacementRequested || state.troubleshootingExhausted) return "exchange";
  return null;
}

const TOPIC_LABELS = new Map(TROUBLESHOOTING_TOPICS.map((t) => [t.id, t.label]));

// Writer directive enforcing: no repeated troubleshooting, move to replacement
// after failed attempts, and gate replacement-will-be-sent language on the
// order number. Empty when there is nothing to enforce.
export function buildReplacementFlowDirective(state: ReplacementFlowState): string {
  const inReplacementPath = state.replacementRequested || state.troubleshootingExhausted;
  const hasRepeatRisk = state.alreadyProvidedTopics.length > 0;
  if (!inReplacementPath && !hasRepeatRisk && state.failedAttempts < 2) return "";

  const lines = ["# Troubleshooting progression & replacement flow"];

  if (hasRepeatRisk) {
    const labels = state.alreadyProvidedTopics
      .map((id) => TOPIC_LABELS.get(id) ?? id)
      .join("; ");
    lines.push(
      `- Already provided to the customer earlier in this thread: ${labels}. Do NOT repeat these steps or restate equivalent variants (e.g. the same Bluetooth pairing instructions) — the customer has said they did not work.`,
    );
    lines.push(
      "- Only offer a NEW troubleshooting step if it is materially different from what was already tried.",
    );
  }

  if (!inReplacementPath && state.failedAttempts >= 2) {
    lines.push(
      "- The customer has reported failure multiple times. Stop repeating steps: either ask ONE targeted diagnostic question or move toward the replacement/warranty flow.",
    );
  }

  if (inReplacementPath) {
    lines.push(
      "- Relevant troubleshooting has been attempted without success. You MAY decide that a replacement/exchange (ombytning/reklamation) is the correct next step — do not just forward the case to a human when the next step is clear.",
    );
    if (!state.purchaseSourceKnown) {
      lines.push(
        "- The purchase channel is unknown. Acknowledge that we can look at a replacement, then ask where the product was purchased (e.g. \"Hvor har du købt headsettet?\"). Do NOT yet say a new unit will be sent.",
      );
    } else if (!state.orderNumberKnown) {
      lines.push(
        "- The purchase channel is confirmed but the ORDER is not yet identified. Thank the customer, confirm we can proceed with the ombytning/reklamation, and ask for the order number (e.g. \"Send gerne dit ordrenummer, så vi kan finde købet og gå videre med ombytningen.\").",
      );
      lines.push(
        "- HARD RULE: Because the order is not identified, you MUST NOT say a new unit will be sent/shipped, that \"vi sender et nyt headset\", or that the customer will receive a shipping/dispatch confirmation. No replacement order or shipment exists yet.",
      );
    } else {
      lines.push(
        "- The order is identified. Proceed with the replacement/warranty next step: confirm that we go ahead with the ombytning and that we will return with the next step shortly.",
      );
      lines.push(
        "- Do NOT fabricate a shipment/tracking/dispatch confirmation — no replacement order or shipment has been created yet, so do not say it has been sent or that a shipping confirmation will follow.",
      );
    }
    lines.push(
      "- Never promise shipping, tracking, delivery or dispatch confirmation unless a replacement order/shipment actually exists.",
    );
  }

  return lines.join("\n");
}

// --- Verifier-side deterministic guard -------------------------------------

const SHIPMENT_CONFIRMATION_RE =
  /\b(?:vi\s+sender\s+(?:dig\s+)?et\s+nyt|sender\s+et\s+nyt\s+headset|du\s+vil\s+modtage\s+en\s+bekræftelse\s*,?\s*når\s+det\s+er\s+afsendt|når\s+det\s+er\s+afsendt|we\s+will\s+send\s+you\s+a\s+new|we'?re\s+sending\s+(?:you\s+)?a\s+new|you\s+will\s+receive\s+a\s+(?:shipping|dispatch)\s+confirmation|once\s+it\s+(?:has\s+)?ship(?:ped|s))\b/i;

// Detect a draft that promises a replacement shipment/dispatch confirmation
// while the order is NOT identified. Used by the verifier as a deterministic
// block signal (parallel to detectUnsupportedStockClaims).
export function detectPrematureReplacementShipment(
  draftText: string,
  opts: { orderKnown: boolean },
): string[] {
  if (opts.orderKnown) return [];
  return SHIPMENT_CONFIRMATION_RE.test(String(draftText ?? ""))
    ? ["premature_replacement_no_order"]
    : [];
}
