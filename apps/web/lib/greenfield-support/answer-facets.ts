/** Semantic answer facets share the existing TurnIR/ResponseSegment contract.
 * They select verified source fields; they never authorize an action. */
export const ANSWER_FACETS = ["material_composition", "load_capacity", "weight_limit", "electrical_safety", "repair_boundary", "certification", "placement", "cleaning_method", "prohibited_method", "cleaning_alternative", "dimension_width", "dimension_depth", "dimension_height", "dimension_values"] as const;
export type AnswerFacet = typeof ANSWER_FACETS[number];
export type CoveredAnswerFacet = AnswerFacet | "qualified_next_step";
export interface PreciseAnswerRequest { id: string; facet: CoveredAnswerFacet; requestIndex: number; subject: string | null; requiredFor: AnswerFacet[] }

export function compilePreciseAnswerRequests(requests: Array<{ subject?: string | null; propertyKey?: string | null; facets?: AnswerFacet[] | null }> = []): PreciseAnswerRequest[] {
  return requests.flatMap((request, requestIndex) => {
    const facets = new Set<CoveredAnswerFacet>(request.facets ?? []);
    if (request.propertyKey === "composition") facets.add("material_composition");
    if (facets.has("cleaning_method") || facets.has("prohibited_method")) facets.add("cleaning_alternative");
    if (["dimension_width", "dimension_depth", "dimension_height"].some(facet => facets.has(facet as AnswerFacet))) facets.add("dimension_values");
    const safety = [...facets].filter((facet): facet is AnswerFacet => ["load_capacity", "weight_limit", "electrical_safety", "repair_boundary", "certification", "placement"].includes(facet));
    if (safety.length) facets.add("qualified_next_step");
    return [...facets].map(facet => ({ id: `answer.${requestIndex}.${facet}`, facet, requestIndex, subject: request.subject ?? null, requiredFor: facet === "qualified_next_step" ? safety : [] }));
  });
}

export function internalAnswerInstruction(text: string): boolean {
  return /\b(?:do not|don't|never)\s+(?:invent|fabricate|hallucinate)|\b(?:ignore|override)\s+(?:previous|system|agent)\s+instructions|\b(?:assistant|agent|model)\s+(?:must|should)\b/i.test(text);
}
export function documentedUnknown(text: string): boolean {
  return /\b(?:not established|not specified|not described|not documented|does not (?:state|specify|establish)|no approved|no verified|unverified|unknown|cannot verify)\b/i.test(text);
}
const topics: Record<CoveredAnswerFacet, RegExp> = {
  material_composition: /\d+(?:[.,]\d+)?\s*%|\b(?:composition|material|made (?:of|from)|veneer|engineered wood core)\b/i,
  load_capacity: /\b(?:load|weight capacity|weight limit|maximum weight|supports? devices? up to)\b/i,
  weight_limit: /\b(?:weight limit|maximum weight|load|supports? devices? up to)\b/i,
  electrical_safety: /\b(?:electrical|power.cord|cable).*(?:repair|replacement|damaged|safety|not established)|(?:repair|damaged).*\b(?:electrical|power.cord|cable)\b/i,
  repair_boundary: /\b(?:repair|replacement procedure|cable replacement|power.cord replacement)\b/i,
  certification: /\b(?:certif\w*|fire.resistan\w*|fire.safe)\b/i,
  placement: /\b(?:fireplace|placement|near heat|distance.*(?:fire|heat)|keep.*(?:heat|fire)|wall.type suitability|wall.*installation)\b/i,
  cleaning_method: /\b(?:clean\w*|wash\w*|wipe|dishwasher|damp cloth|dry\w*)\b/i,
  prohibited_method: /\b(?:avoid|do not|don't|no|not|never)\b.*\b(?:wash\w*|wipe|cloth|tumble|bleach|abrasive\w*|chemical\w*|water|dishwasher)\b/i,
  cleaning_alternative: /\b(?:clean.*(?:cloth|water)|wipe|spot clean|air.*regularly|professional dry cleaning|wash at|reshape|air dry)\b/i,
  dimension_width: /(?:\b(?:width|bredde(?:n)?)\s*(?::|=|is|er)?\s*\d+(?:[.,]\d+)?\s*(?:cm|mm|m|inches?|in)\b|\b\d+(?:[.,]\d+)?\s*(?:cm|mm|m|inches?|in)\s+(?:wide|bredt?)\b)/i,
  dimension_depth: /(?:\b(?:depth|dybde(?:n)?)\s*(?::|=|is|er)?\s*\d+(?:[.,]\d+)?\s*(?:cm|mm|m|inches?|in)\b|\b\d+(?:[.,]\d+)?\s*(?:cm|mm|m|inches?|in)\s+(?:deep|dybt?)\b)/i,
  dimension_height: /(?:\b(?:height|højde(?:n)?)\s*(?::|=|is|er)?\s*\d+(?:[.,]\d+)?\s*(?:cm|mm|m|inches?|in)\b|\b\d+(?:[.,]\d+)?\s*(?:cm|mm|m|inches?|in)\s+(?:high|tall|højt?)\b)/i,
  dimension_values: /\b(?:dimensions|width|depth|height|bredde|dybde|højde)\b|\d\s*[×x]\s*\d/i,
  qualified_next_step: /\b(?:contact|consult|seek|check|ask)\b.*\b(?:support|merchant|store|before installation|manufacturer|professional|documentation|safety label)\b/i,
};
export function sourceSupportsFacet(text: string, facet: CoveredAnswerFacet): boolean {
  if (internalAnswerInstruction(text)) return false;
  // Unknown dishwasher status is not an approved alternative or cleaning method.
  if (facet === "cleaning_alternative") return text.split(/[.;\n]/).some(clause => topics.cleaning_alternative.test(clause)
    && !documentedUnknown(clause) && !/\b(?:not recommended|not approved|not allowed|not permitted|prohibited|forbidden)\b/i.test(clause) && !/\b(?:do not|don't|never|avoid)\s+(?:clean\w*|wipe|wash\w*|spot clean|air)\b/i.test(clause));
  if (facet === "cleaning_method" && documentedUnknown(text) && /dishwasher/i.test(text)) return true;
  if (facet === "dimension_values") return topics.dimension_values.test(text) || [topics.dimension_width, topics.dimension_depth, topics.dimension_height].some(pattern => pattern.test(text));
  if (["dimension_width", "dimension_depth", "dimension_height"].includes(facet)) return text.split(/[;\n]|[.!?]\s+/).some(clause => !documentedUnknown(clause) && topics[facet].test(clause));
  return topics[facet].test(text);
}
export function facetReadQuery(facet: CoveredAnswerFacet): string {
  const queries: Record<CoveredAnswerFacet, string> = {
    material_composition: "documented product material composition",
    load_capacity: "approved maximum load weight capacity rating", weight_limit: "supported device maximum weight limit",
    electrical_safety: "electrical repairs cable replacement contact support damaged electrical parts",
    repair_boundary: "power cord replacement procedure electrical repairs support",
    certification: "fire resistance certification verified safety documentation", placement: "fireplace placement distance safety warnings",
    cleaning_method: "documented cleaning washing dishwasher safety", prohibited_method: "prohibited cleaning bleach abrasive chemicals washing drying",
    cleaning_alternative: "approved cleaning soft damp cloth avoid abrasive cleaners", dimension_width: "documented width labeled dimensions",
    dimension_depth: "documented depth labeled dimensions", dimension_height: "documented height labeled dimensions", dimension_values: "documented dimensions",
    qualified_next_step: "contact support before installation load electrical repairs safety verification",
  };
  return queries[facet];
}

export function sourceDomainSupportsFacet(domain: string, facet: CoveredAnswerFacet): boolean {
  if (["care", "product"].includes(domain)) return true;
  if (domain === "troubleshooting") return ["electrical_safety", "repair_boundary", "qualified_next_step"].includes(facet);
  if (domain === "assembly") return ["load_capacity", "weight_limit", "placement", "qualified_next_step"].includes(facet);
  return false;
}
