// Deterministic parser for merchant-written Returns guidance.
//
// This parser is intentionally narrow. It recognizes statements that already
// have typed Returns contracts in the frozen platform and leaves everything
// else as a sentence-level finding. It never creates a generic prose unit.

const ANCHORS = Object.freeze({
  delivery: "line_item.delivered_at",
  delivered: "line_item.delivered_at",
  receiving: "line_item.delivered_at",
  receipt: "line_item.delivered_at",
  order: "order.placed_at",
  purchase: "order.placed_at",
});

const CONDITIONS = Object.freeze([
  ["original packaging", "return_subject.original_packaging"],
  ["unused", "return_subject.unused"],
  ["not used", "return_subject.unused"],
  ["tags attached", "return_subject.tags_attached"],
  ["resalable", "return_subject.resaleable"],
  ["resaleable", "return_subject.resaleable"],
]);

function sentenceList(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function proposal(key, title, sentence, value, extra = {}) {
  return { key, title, sentence, value, ...extra };
}

function uniqueByKey(values) {
  const map = new Map();
  for (const value of values) {
    const previous = map.get(value.key);
    if (!previous) map.set(value.key, value);
    else if (JSON.stringify(previous.value) !== JSON.stringify(value.value)) {
      map.set(value.key, {
        ...previous,
        conflict: true,
        conflicts: [previous, value],
      });
    }
  }
  return [...map.values()];
}

function findAnchor(sentence) {
  const match = sentence.match(
    /\b(?:of|from)\s+(?:the\s+)?(delivery|delivered|receiving|receipt|order|purchase)\b/i,
  );
  return match ? ANCHORS[match[1].toLowerCase()] : null;
}

function parseReturnAddress(sentence) {
  const match = sentence.match(
    /\b(AceZone[^,.;]*),\s*(.+?\s+\d+[^,;]*),\s*(\d{4})\s+([^,.;]+?)(?:,\s*(Denmark))?\.?$/i,
  );
  if (!match) return null;
  return {
    name: match[1].trim(),
    line1: match[2].trim(),
    postal_code: match[3].trim(),
    city: match[4].trim(),
    country: (match[5] || "Denmark").trim(),
  };
}

function startRequirements(sentence) {
  const requirements = [];
  if (/\breason\b|why\s+you(?:'|’)re\s+returning/i.test(sentence)) requirements.push("reason");
  if (/\b(?:full\s+)?name\b/i.test(sentence)) requirements.push("name");
  if (/\border\s*(?:number|no\.?|#)\b|\border\b/i.test(sentence)) requirements.push("order_number");
  if (/\b(?:email|phone|contact)\b/i.test(sentence)) requirements.push("contact");
  return [...new Set(requirements)];
}

function parseWindow(sentence) {
  const match = sentence.match(
    /\bwithin\s+(\d{1,3})\s+(?:calendar\s+)?days?\b/i,
  );
  if (!match) return null;
  const days = Number(match[1]);
  const anchor = findAnchor(sentence);
  if (!anchor) {
    return {
      ambiguity: {
        key: "window",
        sentence,
        message:
          "This sentence gives a return period but does not say whether it starts at delivery or the order date.",
      },
    };
  }
  return proposal(
    "window",
    "Return window",
    sentence,
    {
      duration: { amount: days, unit: "calendar_day" },
      anchor: { fact: anchor },
    },
    { slot: "returns.ELIG.window", family: "ELIG", kind: "slot_rule" },
  );
}

function parseSentence(sentence) {
  const lower = sentence.toLowerCase();
  const proposals = [];
  const ambiguities = [];

  const negativeEligibility =
    /\b(?:cannot|can't|do not|don't|not)\b[^.?!]{0,80}\breturns?\b|\bno returns?\b/i.test(
      sentence,
    );
  const positiveEligibility =
    /\b(?:customers?|you|items?|products?)\b[^.?!]{0,40}\b(?:can|may)\s+(?:still\s+)?return\b/i.test(
      sentence,
    ) ||
    /\b(?:customers?|you|items?|products?)\b[^.?!]{0,60}\b(?:are eligible to|are allowed to)\s+return\b/i.test(
      sentence,
    ) ||
    /\breturns?\b[^.?!]{0,60}\b(?:are|is)\s+(?:accepted|allowed|eligible)\b/i.test(
      sentence,
    );
  if (negativeEligibility) {
    proposals.push(
      proposal(
        "accepted",
        "Return eligibility",
        sentence,
        { accepted: false },
        { slot: "returns.ELIG.accepted", family: "ELIG", kind: "slot_rule" },
      ),
    );
  } else if (positiveEligibility) {
    proposals.push(
      proposal(
        "accepted",
        "Return eligibility",
        sentence,
        { accepted: true },
        { slot: "returns.ELIG.accepted", family: "ELIG", kind: "slot_rule" },
      ),
    );
  }

  const window = parseWindow(sentence);
  if (window?.ambiguity) ambiguities.push(window.ambiguity);
  else if (window) proposals.push(window);

  if (
    /\b(?:start|initiate|begin|request)\b[^.?!]{0,80}\breturn\b[^.?!]{0,100}\b(?:contact(?:ing)? support|email(?:ing)? us|support team)\b/i.test(
      sentence,
    ) ||
    /\bcontact(?:ing)? support\b[^.?!]{0,60}\breturn\b/i.test(sentence)
  ) {
    const requirements = startRequirements(sentence);
    proposals.push(
      proposal(
        "method",
        "Starting a return",
        sentence,
        { method: "contact_support", requirements },
        { slot: "returns.PROC.method", family: "PROC", kind: "slot_rule" },
      ),
    );
  } else if (
    /\b(?:start|initiate|begin|request)\b[^.?!]{0,80}\breturn\b[^.?!]{0,80}\b(?:portal|self-service)\b/i.test(
      sentence,
    )
  ) {
    const requirements = startRequirements(sentence);
    proposals.push(
      proposal(
        "method",
        "Starting a return",
        sentence,
        { method: "self_service_portal", requirements },
        { slot: "returns.PROC.method", family: "PROC", kind: "slot_rule" },
      ),
    );
  } else if (/\bRMA\b[^.?!]{0,80}\b(?:request|return)\b/i.test(sentence)) {
    proposals.push(
      proposal(
        "method",
        "Starting a return",
        sentence,
        { method: "rma_request" },
        { slot: "returns.PROC.method", family: "PROC", kind: "slot_rule" },
      ),
    );
  }

  if (
    /\b(?:customers?|you|they|the customer)\b[^.?!]{0,60}\b(?:pay|cover|are responsible for)\b[^.?!]{0,50}\breturn\s+(?:shipping|postage|cost)\b/i.test(
      sentence,
    ) ||
    /\breturn\s+(?:shipping|postage|cost)\b[^.?!]{0,50}\b(?:paid|covered)\s+by\s+(?:the\s+)?customer/i.test(
      sentence,
    )
  ) {
    proposals.push(
      proposal(
        "payer",
        "Return shipping",
        sentence,
        { payer: "customer", mechanism: "customer_arranges" },
        { slot: "returns.LOG.payer", family: "LOG", kind: "slot_rule" },
      ),
    );
  } else if (
    /\b(?:we|our company|the merchant)\b[^.?!]{0,60}\b(?:pay|cover|provide)\b[^.?!]{0,50}\breturn\s+(?:shipping|postage|cost)\b/i.test(
      sentence,
    ) ||
    /\breturn\s+(?:shipping|postage)\b[^.?!]{0,50}\b(?:prepaid|covered by us)\b/i.test(
      sentence,
    )
  ) {
    proposals.push(
      proposal(
        "payer",
        "Return shipping",
        sentence,
        { payer: "merchant", mechanism: "prepaid_by_merchant" },
        { slot: "returns.LOG.payer", family: "LOG", kind: "slot_rule" },
      ),
    );
  }

  if (
    /\b(?:must|required|requires?)\b[^.?!]{0,80}\btrack(?:ed|ing)?\b/i.test(
      sentence,
    ) ||
    /\btrack(?:ed|ing)?\s+shipping\b[^.?!]{0,40}\b(?:required|mandatory)\b/i.test(
      sentence,
    ) ||
    /\bsend\b[^.?!]{0,50}\bwith tracking\b/i.test(sentence)
  ) {
    proposals.push(
      proposal(
        "shipping",
        "Tracked return shipping",
        sentence,
        { tracked: "required" },
        { family: "LOG", kind: "procedure" },
      ),
    );
  } else if (
    /\b(?:recommend|recommended|should|suggest)\b[^.?!]{0,80}\btrack(?:ed|ing)?\b/i.test(sentence) ||
    /\btrack(?:ed|ing)?\s+(?:shipping\s+)?(?:is\s+)?recommended\b/i.test(sentence)
  ) {
    proposals.push(
      proposal(
        "shipping",
        "Tracked return shipping",
        sentence,
        { tracked: "recommended" },
        { family: "LOG", kind: "guidance" },
      ),
    );
  }

  const address = parseReturnAddress(sentence);
  if (address) {
    proposals.push(
      proposal(
        "address",
        "Return address",
        sentence,
        address,
        { family: null, kind: "value" },
      ),
    );
    proposals.push(
      proposal(
        "destination",
        "Return destination",
        sentence,
        { disclosure: "disclosed" },
        { slot: "returns.LOG.destination", family: "LOG", kind: "slot_rule" },
      ),
    );
  }

  if (!address && (
    /\breturn\s+address\b[^.?!]{0,80}\b(?:provided|given|sent|receive)\b/i.test(
      sentence,
    ) ||
    /\b(?:provided|given|sent)\b[^.?!]{0,80}\breturn\s+address\b/i.test(
      sentence,
    )
  )) {
    proposals.push(
      proposal(
        "destination",
        "Return destination",
        sentence,
        { disclosure: "provided_via_method" },
        { slot: "returns.LOG.destination", family: "LOG", kind: "slot_rule" },
      ),
    );
  }

  const afterEvents = [];
  if (
    /\b(?:return|item|parcel|package)\b[^.?!]{0,80}\b(?:received|arrives|arrived)\b/i.test(
      sentence,
    )
  )
    afterEvents.push("return_shipment.received_at");
  if (
    /\b(?:return|item|parcel|package)\b[^.?!]{0,100}\b(?:processed|inspection|inspected)\b/i.test(
      sentence,
    )
  )
    afterEvents.push("return_shipment.inspection_completed_at");
  if (/\brefunds?\b/i.test(sentence) && afterEvents.length) {
    proposals.push(
      proposal(
        "refund_expectation",
        "Refund processing",
        sentence,
        {
          event: "refund_initiated",
          after: [...new Set(afterEvents)],
          duration: null,
        },
        { kind: "expectation" },
      ),
    );
    proposals.push(
      proposal(
        "timing",
        "Refund processing",
        sentence,
        { refKey: "refund_expectation" },
        { slot: "returns.MONEY.timing", family: "MONEY", kind: "slot_rule" },
      ),
    );
  } else if (
    /\brefunds?\b/i.test(sentence) &&
    /\b(?:after|once|when)\b/i.test(sentence)
  ) {
    ambiguities.push({
      key: "refund_timing",
      sentence,
      message:
        "This sentence mentions refund timing, but the triggering event is not one Sona can route safely yet.",
    });
  }

  const exchangeOffered =
    /\b(?:exchanges?|swaps?)\b[^.?!]{0,60}\b(?:are|is)\s+(?:available|offered|possible)\b/i.test(
      sentence,
    ) ||
    /\b(?:we|our company)\b[^.?!]{0,30}\b(?:offer|provide)\b[^.?!]{0,30}\bexchanges?\b/i.test(
      sentence,
    );
  const exchangeNotOffered =
    /\b(?:exchanges?|swaps?)\b[^.?!]{0,60}\b(?:not available|not offered|unavailable|do not offer)\b/i.test(
      sentence,
    );
  if (exchangeOffered)
    proposals.push(
      proposal(
        "exchange",
        "Exchanges",
        sentence,
        { offered: true },
        { slot: "returns.EXCH.offered", family: "EXCH", kind: "slot_rule" },
      ),
    );
  else if (exchangeNotOffered)
    proposals.push(
      proposal(
        "exchange",
        "Exchanges",
        sentence,
        { offered: false },
        { slot: "returns.EXCH.offered", family: "EXCH", kind: "slot_rule" },
      ),
    );

  const conditions = CONDITIONS.filter(([phrase]) =>
    lower.includes(phrase),
  ).map(([, fact]) => fact);
  if (conditions.length) {
    proposals.push(
      proposal(
        "item_conditions",
        "Return condition",
        sentence,
        { conditions: [...new Set(conditions)] },
        {
          slot: "returns.ELIG.item_conditions",
          family: "ELIG",
          kind: "slot_rule",
        },
      ),
    );
  }

  // These policy details are retained as source evidence until the frozen
  // Returns contracts grow an explicit typed slot. Do not silently treat them
  // as part of the refund timing decision above.
  if (/\boriginal\s+payment\s+method\b/i.test(sentence)) {
    ambiguities.push({
      key: "refund_payment_method",
      sentence,
      message: "The source specifies the original payment method, but the current Returns platform has no typed refund-destination slot yet.",
    });
  }
  if (/\b(?:diminished\s+value|reduced\s+refund|deduct(?:ion|ed)|depreciat)/i.test(sentence)) {
    ambiguities.push({
      key: "diminished_value",
      sentence,
      message: "The source describes a value-based refund adjustment, but the current Returns platform cannot safely encode a variable deduction.",
    });
  }

  return { proposals, ambiguities };
}

export function parseReturnsGuidance(content) {
  const sentences = sentenceList(content);
  const proposals = [];
  const ambiguities = [];
  const unsupported = [];
  for (const sentence of sentences) {
    const parsed = parseSentence(sentence);
    proposals.push(...parsed.proposals);
    ambiguities.push(...parsed.ambiguities);
    if (!parsed.proposals.length && !parsed.ambiguities.length) {
      unsupported.push({
        sentence,
        message:
          "Sona cannot map this sentence to a supported Returns rule yet.",
      });
    }
  }

  const deduped = uniqueByKey(proposals);
  const conflicts = deduped.filter((item) => item.conflict);
  for (const conflict of conflicts) {
    ambiguities.push({
      key: conflict.key,
      sentence: conflict.conflicts.map((item) => item.sentence).join(" "),
      message: `This guidance gives two different values for ${conflict.title.toLowerCase()}. Keep one clear rule.`,
    });
  }
  const conflictKeys = new Set(conflicts.map((item) => item.key));
  const validProposals = deduped.filter((item) => !conflictKeys.has(item.key));
  return {
    content: String(content || "").trim(),
    statements: sentences,
    proposals: validProposals,
    ambiguities,
    unsupported,
    ok: validProposals.length > 0,
  };
}
