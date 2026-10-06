// Deterministic authoring for the existing Order Status / WISMO WGUIDE unit.
//
// This parser intentionally accepts only a small, typed vocabulary. The
// merchant's original sentences remain source evidence; only statements that
// can be represented without inventing live shipment facts become WGUIDE.

const STATES = Object.freeze([
  "order_not_fulfilled",
  "partial_fulfillment",
  "fulfilled_tracking_unconfirmed",
  "in_transit",
  "delivery_exception",
  "delivered",
  "requires_human_review",
]);

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function sentences(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((item) => clean(item.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")))
    .filter(Boolean);
}

function stateFor(sentence) {
  const text = sentence.toLowerCase();
  if (/(?:partial|partially|some items|remaining item).*(?:fulfil|fulfill|ship)|(?:fulfil|fulfill).*(?:partial|some items|remaining item)/i.test(text)) return "partial_fulfillment";
  if (/(?:fulfilled|fulfil(?:led|ment)|shipped).*(?:tracking|carrier).*(?:not|no|inactive|hasn't|has not)|(?:tracking|carrier).*(?:not|no|inactive).*(?:fulfilled|shipped)/i.test(text)) return "fulfilled_tracking_unconfirmed";
  if (/(?:in transit|on the way|under transport|på vej|undervejs)/i.test(text)) return "in_transit";
  if (/(?:carrier|delivery|shipping).*(?:exception|failed|attempt)|(?:exception|failed delivery|delivery attempt)/i.test(text)) return "delivery_exception";
  if (/(?:delivered|marked delivered).*(?:not received|can't find|cannot find|missing|not there)|(?:not received|can't find|cannot find).*(?:delivered|parcel|package)/i.test(text)) return "delivered";
  if (/(?:not|hasn't|has not|still).*(?:fulfilled|fulfil(?:led|ment)|dispatched|shipped)|(?:fulfil(?:led|ment)|dispatch|ship).*(?:delay|wait|not yet)/i.test(text)) return "order_not_fulfilled";
  if (/(?:human|manual|support team|agent).*(?:review|check)|(?:review|check).*(?:human|support team|agent)/i.test(text)) return "requires_human_review";
  return null;
}

function upsertProposal(proposals, key, value, sentence) {
  const existing = proposals.find((item) => item.key === key);
  if (existing) return { duplicate: true, conflict: JSON.stringify(existing.value) !== JSON.stringify(value) };
  proposals.push({ key, value, sentence });
  return { duplicate: false, conflict: false };
}

function parseFulfillmentWindow(text) {
  const match = text.match(/(?:normally|usually|typically|within|in)\s*(\d+)\s*(?:-|to|–|—)\s*(\d+)\s*(business|working|calendar)?\s*days?/i)
    || text.match(/(\d+)\s*(?:-|to|–|—)\s*(\d+)\s*(business|working|calendar)?\s*days?/i);
  if (!match) return null;
  const unit = /business|working/i.test(match[3] || "") ? "business_day" : "calendar_day";
  return { min: Number(match[1]), max: Number(match[2]), unit, anchor: "order.placed_at" };
}

export function parseOrderStatusGuidance(content) {
  const original = String(content ?? "").replace(/\r\n?/g, "\n").trim();
  const proposals = [];
  const unsupported = [];
  const ambiguities = [];
  for (const sentence of sentences(original)) {
    let matched = false;
    const window = parseFulfillmentWindow(sentence);
    if (window && /fulfil|fulfill|dispatch|ship|order/i.test(sentence)) {
      matched = true;
      const result = upsertProposal(proposals, "fulfillment_window", window, sentence);
      if (result.conflict) ambiguities.push({ code: "multiple_fulfillment_windows", sentence, message: "This guidance gives more than one normal fulfilment window." });
    }
    if (/(?:tracking|track).*(?:after|once|when).*(?:ship|fulfil|fulfill|dispatch)|(?:ship|fulfil|fulfill|dispatch).*(?:tracking|track).*(?:sent|available)/i.test(sentence)) {
      matched = true;
      upsertProposal(proposals, "tracking_after_shipment", { enabled: true }, sentence);
    }
    if (/(?:no|not accept|cannot deliver to|don't deliver to).*(?:p\.?\s*o\.?\s* boxes?|post office boxes?)/i.test(sentence)) {
      matched = true;
      upsertProposal(proposals, "po_boxes", { accepted: false }, sentence);
    }
    if (/(?:address|shipping address).*(?:cannot|can't|not able to|unable to).*(?:change|edit|update).*(?:after|once).*(?:order|placed)|(?:after|once).*(?:order|placed).*(?:address|shipping address).*(?:cannot|can't|not able to|unable to).*(?:change|edit|update)/i.test(sentence)) {
      matched = true;
      upsertProposal(proposals, "address_change", { allowed: false, after: "order.placed_at" }, sentence);
    }
    if (/(?:delivery|arrival|shipping).*(?:estimate|estimated).*(?:not|isn't|is not).*(?:guarantee|guaranteed)|(?:not|never).*(?:guarantee|guaranteed).*(?:delivery|arrival|estimate)/i.test(sentence)) {
      matched = true;
      upsertProposal(proposals, "delivery_estimate", { guaranteed: false }, sentence);
    }
    if (/(?:import|customs).*(?:dut(?:y|ies)|tax(?:es)?).*(?:outside|non[- ]?eu|non[- ]european)|(?:outside|non[- ]?eu|non[- ]european).*(?:dut(?:y|ies)|tax(?:es)?)/i.test(sentence)) {
      matched = true;
      upsertProposal(proposals, "import_charges", { outside_eu: "may_apply" }, sentence);
    }
    const state = stateFor(sentence);
    if (state) {
      matched = true;
      const humanReviewRequired = state === "requires_human_review" || /(?:human|manual|support team|agent).*(?:review|check)|(?:review|check).*(?:human|support team|agent)/i.test(sentence);
      const result = upsertProposal(proposals, `state_guidance:${state}`, { state, text: sentence, human_review_required: humanReviewRequired }, sentence);
      if (result.conflict) ambiguities.push({ code: `multiple_${state}_guidance`, sentence, message: `This guidance gives more than one instruction for ${state.replaceAll("_", " ")}.` });
    }
    if (!matched && sentence.length > 3) unsupported.push({ code: "order_status_statement_unsupported", sentence, message: "Unsupported Order Status guidance statement." });
  }
  return { original, proposals, unsupported, ambiguities, ok: proposals.length > 0 && ambiguities.length === 0 };
}

export function compileOrderStatusGuidanceUnit({ parsed, sourceId = null, policyId = null, unitId }) {
  if (!parsed?.ok) return null;
  const stateGuidance = {};
  const publishedGuidance = [];
  for (const proposal of parsed.proposals) {
    if (!proposal.key.startsWith("state_guidance:")) continue;
    stateGuidance[proposal.value.state] = {
      text: proposal.value.text,
      human_review_required: Boolean(proposal.value.human_review_required),
    };
    publishedGuidance.push(proposal.value.state);
  }
  const byKey = new Map(parsed.proposals.map((proposal) => [proposal.key, proposal.value]));
  return {
    unit_id: unitId,
    kind: "value",
    domain_key: "order_status",
    family_key: "WGUIDE",
    slot_key: null,
    audience: "customer",
    scope: {},
    payload: {
      rule_key: "merchant_guidance",
      published_guidance: [...new Set(publishedGuidance)].sort(),
      state_guidance: stateGuidance,
      fulfillment_window: byKey.get("fulfillment_window") ?? null,
      tracking_after_shipment: byKey.get("tracking_after_shipment") ?? null,
      po_boxes: byKey.get("po_boxes") ?? null,
      address_change: byKey.get("address_change") ?? null,
      delivery_estimate: byKey.get("delivery_estimate") ?? null,
      import_charges: byKey.get("import_charges") ?? null,
      knowledge_gaps: STATES.filter((state) => !publishedGuidance.includes(state)).map((state) => `${state}_guidance`),
      provenance: sourceId ? [{ source_id: sourceId, role: "supports" }] : [],
    },
    origin_policy_id: policyId,
    evidence: parsed.proposals.map((proposal) => proposal.sentence),
  };
}

export { STATES as ORDER_STATUS_GUIDANCE_STATES };
