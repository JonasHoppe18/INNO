// Deterministic authoring for the frozen Warranty / Complaints contracts.
// Unsupported policy prose is retained as source evidence and never becomes
// generic runtime Knowledge.

const MARKET_ALIASES = Object.freeze({
  eu: "eu", european_union: "eu", european: "eu",
  uk: "uk", united_kingdom: "uk", britain: "uk",
  australia: "australia", au: "australia",
  us: "us", usa: "us", "united_states": "us", america: "us",
  canada: "canada", ca: "canada",
  new_zealand: "new_zealand", nz: "new_zealand",
});

const EXCLUSIONS = Object.freeze([
  ["normal_wear", /(?:normal|ordinary|regular)\s+wear(?:\s+and\s+tear)?/i],
  ["abuse_or_misuse", /abuse|misuse|abusive/i],
  ["improper_use", /improper\s+(?:use|usage)|incorrect\s+use/i],
  ["water_damage", /water\s+damage|liquid\s+damage/i],
  ["external_cause", /cosmetic\s+damage|external\s+(?:cause|damage)|accidental\s+damage/i],
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

function marketFrom(text) {
  const normalized = text.toLowerCase().replace(/[–—]/g, "-");
  const values = [];
  const patterns = [
    ["eu", /\b(?:eu|european\s+union|european)\b/i],
    ["uk", /\b(?:uk|united\s+kingdom|britain)\b/i],
    ["australia", /\baustralia\b/i],
    ["us", /\b(?:us|u\.s\.?|usa|united\s+states|america)\b/i],
    ["canada", /\bcanada\b/i],
    ["new_zealand", /\b(?:new\s+zealand|nz)\b/i],
  ];
  for (const [key, pattern] of patterns) if (pattern.test(normalized)) values.push(key);
  return values;
}

function durationFrom(sentence) {
  const match = sentence.match(/(\d+)\s*[- ]?\s*(?:year|years|yr|yrs)/i);
  if (!match) return null;
  const markets = marketFrom(sentence);
  return markets.length ? { months: Number(match[1]) * 12, markets } : null;
}

export function parseWarrantyGuidance(content) {
  const original = String(content ?? "").replace(/\r\n?/g, "\n").trim();
  const proposals = [];
  const unsupported = [];
  const ambiguities = [];
  const durationByMarket = {};
  let coveredCondition = null;
  const excludedConditions = new Set();
  let proofRequired = null;
  let issueDescriptionRequired = null;
  let photosRequired = null;
  let humanReviewRequired = null;
  let noRemedyPromise = null;

  for (const sentence of sentences(original)) {
    let matched = false;
    const duration = durationFrom(sentence);
    if (duration && /warranty|guarantee|coverage|guarantee period/i.test(sentence)) {
      matched = true;
      for (const market of duration.markets) {
        if (durationByMarket[market] !== undefined && durationByMarket[market] !== duration.months) {
          ambiguities.push({ code: "multiple_warranty_durations", sentence, message: `This guidance gives more than one warranty duration for ${market}.` });
        } else durationByMarket[market] = duration.months;
      }
    }
    if (/(?:manufacturing|production|factory).*(?:defect|fault)|defect(?:s)?\s+or\s+malfunction|malfunction(?:s)?\s+(?:are|is)?\s+covered/i.test(sentence)) {
      matched = true;
      if (coveredCondition && coveredCondition !== "manufacturing_defect") ambiguities.push({ code: "multiple_covered_conditions", sentence, message: "This guidance gives conflicting covered-condition rules." });
      coveredCondition = "manufacturing_defect";
    }
    for (const [key, pattern] of EXCLUSIONS) {
      if (!pattern.test(sentence)) continue;
      matched = true;
      excludedConditions.add(key);
    }
    if (/(?:valid\s+)?proof\s+of\s+purchase|purchase\s+receipt|order\s+(?:number|confirmation).*(?:required|needed)|required.*(?:order|purchase).*(?:evidence|proof)/i.test(sentence)) {
      matched = true;
      proofRequired = true;
    }
    if (/(?:describe|description|details?).*(?:issue|problem|fault).*(?:required|needed)|issue.*description.*(?:required|needed)|(?:provide|include|send).*(?:description|details?).*(?:issue|problem|fault)/i.test(sentence)) {
      matched = true;
      issueDescriptionRequired = true;
    }
    if (/(?:photo|picture|image|video)s?.*(?:required|needed|send|provide)|(?:required|needed).*(?:photo|picture|image|video)|(?:provide|include|send).*(?:photo|picture|image|video)/i.test(sentence)) {
      matched = true;
      photosRequired = true;
    }
    if (/(?:human|manual|support team|agent).*(?:review|assess|assessment)|(?:review|assessment).*(?:human|manual|support team|agent)/i.test(sentence)) {
      matched = true;
      humanReviewRequired = true;
    }
    if (/(?:do not|don't|never|cannot).*(?:promise|guarantee).*(?:repair|replacement|replace|refund|remedy)|(?:repair|replacement|replace|refund|remedy).*(?:only|after).*(?:review|eligib|assessment)/i.test(sentence)) {
      matched = true;
      noRemedyPromise = true;
    }
    if (!matched && sentence.length > 3) unsupported.push({ code: "warranty_statement_unsupported", sentence, message: "This statement is not part of the supported Warranty vocabulary yet." });
  }

  if (Object.keys(durationByMarket).length) proposals.push({ key: "eligibility_duration", value: durationByMarket, sentence: original });
  if (coveredCondition || excludedConditions.size) proposals.push({ key: "eligibility_conditions", value: { covered_condition: coveredCondition, excluded_conditions: [...excludedConditions].sort() }, sentence: original });
  if (proofRequired !== null || issueDescriptionRequired !== null || photosRequired !== null) proposals.push({ key: "evidence_requirements", value: { proof_of_purchase_required: proofRequired === true, issue_description_required: issueDescriptionRequired === true, photos_required: photosRequired === true }, sentence: original });
  if (humanReviewRequired !== null || noRemedyPromise !== null) proposals.push({ key: "review_boundaries", value: { human_review_required: humanReviewRequired === true, outcome_requires_merchant_decision: true, no_unconditional_remedy: noRemedyPromise !== false }, sentence: original });
  if (!durationByMarket.eu && !durationByMarket.uk && !durationByMarket.australia && !durationByMarket.us && !durationByMarket.canada && !durationByMarket.new_zealand && Object.keys(durationByMarket).length) unsupported.push({ code: "warranty_market_unsupported", sentence: original, message: "Only EU, UK, Australia, US, Canada, and New Zealand warranty markets are supported." });

  return {
    original,
    proposals,
    unsupported,
    ambiguities,
    ok: proposals.length > 0 && ambiguities.length === 0,
  };
}

function provenance(sourceId) {
  return sourceId ? [{ source_id: sourceId, role: "supports" }] : [];
}

export function compileWarrantyGuidanceUnits({ parsed, sourceId = null, policyId = null, unitIds = {} }) {
  if (!parsed?.ok) return [];
  const byKey = new Map(parsed.proposals.map((proposal) => [proposal.key, proposal.value]));
  const eligibilityDuration = byKey.get("eligibility_duration") || {};
  const conditions = byKey.get("eligibility_conditions") || {};
  const evidence = byKey.get("evidence_requirements") || {};
  const boundaries = byKey.get("review_boundaries") || {};
  const units = [];
  if (Object.keys(eligibilityDuration).length || conditions.covered_condition || conditions.excluded_conditions?.length) {
    units.push({
      unit_id: unitIds.eligibility,
      kind: "value", domain_key: "complaints_warranty", family_key: "WELIG", slot_key: null, audience: "customer", scope: {},
      payload: {
        rule_key: "eligibility",
        warranty_months_by_market: eligibilityDuration,
        covered_condition: conditions.covered_condition || "manufacturing_defect",
        excluded_conditions: conditions.excluded_conditions || [],
        original_purchaser_required: true,
        third_party_policy_owner: "regional_distributor",
        provenance: provenance(sourceId),
      },
      origin_policy_id: policyId,
      evidence: parsed.proposals.filter((proposal) => ["eligibility_duration", "eligibility_conditions"].includes(proposal.key)).map((proposal) => proposal.sentence),
    });
  }
  if (Object.keys(evidence).length) {
    units.push({
      unit_id: unitIds.evidence,
      kind: "value", domain_key: "complaints_warranty", family_key: "WELIG", slot_key: null, audience: "customer", scope: {},
      payload: {
        rule_key: "evidence",
        proof_of_purchase_required: Boolean(evidence.proof_of_purchase_required),
        issue_description_required: Boolean(evidence.issue_description_required),
        photos_required: Boolean(evidence.photos_required),
        media_establishes_condition: false,
        customer_assertion_establishes_condition: false,
        provenance: provenance(sourceId),
      },
      origin_policy_id: policyId,
      evidence: [byKey.get("evidence_requirements")].filter(Boolean).map(() => parsed.proposals.find((proposal) => proposal.key === "evidence_requirements")?.sentence).filter(Boolean),
    });
  }
  if (Object.keys(boundaries).length) {
    units.push({
      unit_id: unitIds.remedy,
      kind: "value", domain_key: "complaints_warranty", family_key: "WREMEDY", slot_key: null, audience: "customer", scope: {},
      payload: {
        rule_key: "remedy_scope",
        approved_claim_scope: "assessment_only",
        outcome_requires_merchant_decision: true,
        human_review_required: Boolean(boundaries.human_review_required),
        no_unconditional_remedy: true,
        provenance: provenance(sourceId),
      },
      origin_policy_id: policyId,
      evidence: [parsed.proposals.find((proposal) => proposal.key === "review_boundaries")?.sentence].filter(Boolean),
    });
  }
  return units;
}

export { MARKET_ALIASES };
