/** Semantic answer facets share the existing TurnIR/ResponseSegment contract.
 * They select verified source fields; they never authorize an action. */
export const ANSWER_FACETS = ["material_composition", "load_capacity", "weight_limit", "electrical_safety", "repair_boundary", "certification", "placement", "cleaning_method", "prohibited_method", "cleaning_alternative", "dimension_width", "dimension_depth", "dimension_height", "dimension_values"] as const;
export type AnswerFacet = typeof ANSWER_FACETS[number];
export type CoveredAnswerFacet = AnswerFacet | "qualified_next_step";
export interface PreciseAnswerRequest { id: string; facet: CoveredAnswerFacet; requestIndex: number; subject: string | null; requiredFor: AnswerFacet[]; qualifiers: string[] }

export function compilePreciseAnswerRequests(requests: Array<{ subject?: string | null; propertyKey?: string | null; facets?: AnswerFacet[] | null; sourceText?: string; qualifiers?: Array<{ facet: AnswerFacet; value: string }> | null }> = []): PreciseAnswerRequest[] {
  return requests.flatMap((request, requestIndex) => {
    const facets = new Set<CoveredAnswerFacet>(request.facets ?? []);
    if (request.propertyKey === "composition") facets.add("material_composition");
    if (facets.has("cleaning_method") || facets.has("prohibited_method")) facets.add("cleaning_alternative");
    if (["dimension_width", "dimension_depth", "dimension_height"].some(facet => facets.has(facet as AnswerFacet))) facets.add("dimension_values");
    const safety = [...facets].filter((facet): facet is AnswerFacet => ["load_capacity", "weight_limit", "electrical_safety", "repair_boundary", "certification", "placement"].includes(facet));
    if (safety.length) facets.add("qualified_next_step");
    return [...facets].map(facet => ({ id: `answer.${requestIndex}.${facet}`, facet, requestIndex, subject: request.subject ?? null, requiredFor: facet === "qualified_next_step" ? safety : [], qualifiers: [...new Set([...(request.qualifiers ?? []).filter(q => q.facet === facet && !redundantFacetQualifier(q.facet, q.value)).map(q => q.value), ...requestedQualifiers(request.sourceText ?? "", facet).filter(value => !(request.qualifiers ?? []).some(q => q.facet === facet && qualifierLabel(q.value, facet) === qualifierLabel(value, facet)))])] }));
  });
}

export function internalAnswerInstruction(text: string): boolean {
  return /\b(?:do not|don't|never)\s+(?:invent|fabricate|hallucinate)|\b(?:ignore|override)\s+(?:previous|system|agent)\s+instructions|\b(?:assistant|agent|model)\s+(?:must|should)\b|(?:opfind|fabriker) ikke|ignorer (?:tidligere|systemets) instruktioner/i.test(text);
}
export function documentedUnknown(text: string): boolean {
  return /\b(?:not established|not specified|not described|not documented|does not (?:state|specify|establish)|no approved|no verified|unverified|unknown|cannot verify|not certified|not approved|not verified|not known|not rated|unavailable)\b|(?:ikke (?:fastlagt|oplyst|angivet|beskrevet|dokumenteret|bekræftet|kendt|godkendt|certificeret)|ingen (?:godkendt|bekræftet|dokumenteret|oplysninger)|ikke verificeret|ikke tilgængelig|ukendt)/i.test(text);
}
const topics: Record<CoveredAnswerFacet, RegExp> = {
  material_composition: /\d+(?:[.,]\d+)?\s*%|\b(?:composition|material|made (?:of|from)|veneer|engineered wood core|materiale|sammensætning|finer)\b/i,
  load_capacity: /\b(?:load|weight capacity|weight limit|maximum weight|supports? devices? up to|belastning|bæreevne|vægtgrænse|maksimal vægt)\b/i,
  weight_limit: /\b(?:weight limit|maximum weight|load|supports? devices? up to|belastning|bæreevne|vægtgrænse|maksimal vægt)\b/i,
  electrical_safety: /(?:elektrisk\w*|strømledning|kabel|ledning).*(?:reparation|udskiftning|beskadig|sikker|ikke dokumenteret)|(?:reparation|udskiftning|beskadig).*(?:elektrisk|strømledning|kabel)|\b(?:electrical|power.cord|cable).*(?:repair|replacement|damaged|safety|not established)|(?:repair|damaged).*\b(?:electrical|power.cord|cable)\b/i,
  repair_boundary: /\b(?:repair|replacement procedure|cable replacement|power.cord replacement|reparation|reparationsprocedure|udskiftning af (?:ledning|kabel))\b/i,
  certification: /\b(?:certif\w*|fire.resistan\w*|fire.safe|brandmodstand|brandsikker\w*|brandhæmmende|brandcertificering)\b/i,
  placement: /\b(?:fireplace|placement|near heat|distance.*(?:fire|heat)|keep.*(?:heat|fire)|wall.type suitability|wall.*installation|pejs|placering|nær varme|afstand.*(?:varme|ild)|vægtype|montering på væg)\b/i,
  cleaning_method: /\b(?:clean\w*|wash\w*|wipe|dishwasher|damp cloth|dry\w*|rengør\w*|vask\w*|aftør\w*|opvaskemaskine|fugtig klud|tør af)\b/i,
  prohibited_method: /\b(?:avoid|do not|don't|no|not|never|undgå|ikke|aldrig)(?![\p{L}\p{N}_]).*\b(?:wash\w*|wipe|cloth|tumble|bleach|abrasive\w*|chemical\w*|water|dishwasher|klud|vask\w*|tørretumbl\w*|blegemiddel|skuremid\w*|kemikal\w*|vand|opvaskemaskine)\b/iu,
  cleaning_alternative: /\b(?:clean.*(?:cloth|water)|wipe|spot clean|air.*regularly|professional dry cleaning|wash at|reshape|air dry|rengør.*(?:klud|vand)|tør af|aftør|pletrens|luft.*regelmæssigt|professionel rens|vask ved|håndvask)\b/i,
  dimension_width: /(?:\b(?:width|bredde(?:n)?)\s*(?::|=|is|er)?\s*\d+(?:[.,]\d+)?\s*(?:cm|mm|m|inches?|in)\b|\b\d+(?:[.,]\d+)?\s*(?:cm|mm|m|inches?|in)\s+(?:wide|bredt?)\b)/i,
  dimension_depth: /(?:\b(?:depth|dybde(?:n)?)\s*(?::|=|is|er)?\s*\d+(?:[.,]\d+)?\s*(?:cm|mm|m|inches?|in)\b|\b\d+(?:[.,]\d+)?\s*(?:cm|mm|m|inches?|in)\s+(?:deep|dybt?)\b)/i,
  dimension_height: /(?:\b(?:height|højde(?:n)?)\s*(?::|=|is|er)?\s*\d+(?:[.,]\d+)?\s*(?:cm|mm|m|inches?|in)\b|\b\d+(?:[.,]\d+)?\s*(?:cm|mm|m|inches?|in)\s+(?:high|tall|højt?)\b)/i,
  dimension_values: /\b(?:dimensions|width|depth|height|bredde|dybde|højde)\b|\d\s*[×x]\s*\d/i,
  qualified_next_step: /\b(?:contact|consult|seek|check|ask)\b.*\b(?:support|merchant|store|before installation|manufacturer|professional|documentation|safety label)\b|(?:kontakt|spørg|bed|rådfør).*(?:butik|forhandler|producent|fagperson|installatør|før montering|dokumentation)/i,
};
export function sourceSupportsFacet(text: string, facet: CoveredAnswerFacet): boolean {
  if (internalAnswerInstruction(text)) return false;
  if (facet === "material_composition") {
    return text.split(/[;\n]|[.!?]\s+/).some(clause => {
      const relation = clause.match(/\b(?:material(?:s)?(?: composition)?|composition|materiale|sammensætning)\s*(?::|=|is|er)\s*(.+)|\b(?:made (?:of|from)|fremstillet af|lavet af|består af)\s+(.+)/iu);
      const value = (relation?.[1] ?? relation?.[2] ?? "").trim();
      if (value && /(?<![\p{L}\p{N}_])(?:oak|wood|wool|cotton|linen|steel|alumini?um|glass|ceramic|porcelain|plastic|polyester|polypropylene|felt|leather|bamboo|silk|nylon|viscose|acrylic|concrete|stone|rattan|terrazzo|cork|mdf|hdf|eg|egetræ|træ|uld|bomuld|hør|stål|glas|keramik|porcelæn|plast|filt|læder|beton|sten)(?![\p{L}\p{N}_])/iu.test(value) && !/\b(?:care|wipe|wash|clean|instructions|tolerance|dimension|rengør|aftør|pleje|vejledning|various materials|natural materials|different materials|mixed materials)\b/iu.test(value)) return true;
      if (documentedUnknown(clause) && /\b(?:material composition|composition|sammensætning|materiale)\b|\bmaterial\s+(?:is|not|unknown)/iu.test(clause) && !/\b(?:care|cleaning|pleje)\b/i.test(clause)) return true;
      return !/\b(?:tolerance|shrinkage|dimensions|toleranc|krymp)\w*/iu.test(clause) && /\d+(?:[.,]\d+)?\s*%\s*(?:wool|cotton|linen|polyester|nylon|silk|viscose|acrylic|uld|bomuld|hør|silke)\b|\b(?:oak veneer|veneer over|engineered wood core|egetræsfiner|massivt træ)\b/iu.test(clause);
    });
  }
  if (facet === "cleaning_method" && topics.prohibited_method.test(text)) return true;
  // Unknown dishwasher status is not an approved alternative or cleaning method.
  if (["load_capacity", "weight_limit"].includes(facet)) {
    if (!topics[facet].test(text)) return false;
    if (documentedUnknown(text)) return true;
    // A product's mass is not a rated load. Positive support needs a rating and units.
    return /(?:maximum load|max(?:imum)? (?:load|weight)|load capacity|weight (?:capacity|limit)|rated load|supports? devices? up to|maksimal(?:e|t)? belastning|maks(?:imal)?\.? (?:belastning|vægt)|bæreevne|vægtgrænse|tilladt belastning)\s*(?:rating\s*)?(?::|=|is|of|up to|er|på|højst)?\s*\d+(?:[.,]\d+)?\s*(?:kg|g|lbs?|pounds?|tonnes?|ton)\b/i.test(text);
  }
  if (facet === "cleaning_alternative") return text.split(/[.;\n]/).some(clause => topics.cleaning_alternative.test(clause)
    && !documentedUnknown(clause) && !/\b(?:not recommended|not approved|not allowed|not permitted|prohibited|forbidden|ikke anbefalet|ikke godkendt|ikke tilladt|forbudt)\b/i.test(clause) && !/\b(?:rengør\w*|vask\w*|aftør\w*|pletrens|tør|luft)\s+ikke\b/i.test(clause) && !/\b(?:do not|don't|never|avoid|må ikke|undgå|aldrig|ikke)\s+(?:rengør\w*|vask\w*|aftør\w*|tør af|pletrens|clean\w*|wipe|wash\w*|spot clean|air)\b/i.test(clause));
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


// Qualifiers come from the existing semantic request, not from retrieved availability.
const methodQualifiers: Array<[string, RegExp]> = [
  ["dishwasher", /dishwasher|opvaskemaskin\w*/i],
  ["machine wash", /machine wash\w*|washing machine|maskinvask\w*|\bvaskemaskin\w*/i],
  ["hand wash", /hand wash\w*|håndvask\w*/i],
  ["dry clean", /dry clean\w*|professionel rens|renseri/i],
  ["bleach", /bleach|blegemiddel/i],
  ["abrasive cleaners", /abrasive (?:cleaners?|chemicals?)|skuremid\w*/i],
  ["strong household chemicals", /strong (?:bathroom|household) (?:cleaner\w*|chemical\w*)|stærke (?:husholdningskemikalier|kemikalier|badeværelsesrens)/i],
];
function requestedQualifiers(text: string, facet: CoveredAnswerFacet): string[] {
  if (facet === "certification") {
    const codes = text.match(/\b(?:UL|FSC|CE|GS|OEKO[- ]TEX|ISO)(?:\s+\d+(?:[-:]\d+)*)?\b/gi) ?? [];
    return [...codes, ...(/fire.resistan|brandmodstand|brandhæmmende/i.test(text) ? ["fire resistance"] : []), ...(/fire.safe|brandsikker/i.test(text) ? ["fire safety"] : [])];
  }
  if (["cleaning_method", "prohibited_method"].includes(facet)) return methodQualifiers.filter(([, pattern]) => pattern.test(text)).map(([key]) => key);
  return [];
}
function qualifierSupported(text: string, qualifier: string, facet: CoveredAnswerFacet): boolean {
  // Material and proposed load predicates are answered by the actual typed source
  // value, including a contradicting value. Projection never copies the model's value.
  if (facet === "material_composition") return sourceSupportsFacet(text, facet);
  if (["load_capacity", "weight_limit"].includes(facet) && /^\d+(?:[.,]\d+)?\s*(?:kg|g|lbs?|pounds?)(?:\s+of\s+[\p{L} ]+)?$/iu.test(qualifier.trim())) return sourceSupportsFacet(text, facet);
  if (["electrical_safety", "repair_boundary"].includes(facet) && /power.?cord|mains.?cord|cable|strømledning|ledning|kabel/i.test(qualifier)) {
    return /power.?cord|mains.?cord|cable|strømledning|ledning|kabel/i.test(text)
      || documentedUnknown(text) && /electrical|elektrisk/i.test(text);
  }
  const method = methodQualifiers.find(([key, pattern]) => key === qualifier || pattern.test(qualifier));
  if (method && ["cleaning_method", "prohibited_method"].includes(facet)) {
    if (!method[1].test(text)) return false;
    // A named method does not entail a requested temperature or concentration.
    const numbers = qualifier.match(/\d+(?:[.,]\d+)?/g) ?? [];
    if (numbers.some(number => !((text.match(/\d+(?:[.,]\d+)?/g) ?? []) as string[]).includes(number))) return false;
    const measurement = /\d+(?:[.,]\d+)?\s*(?:°\s*[CF]|degrees?\s*(?:Celsius|Fahrenheit|[CF])?|grader\s*[CF]?|%)/gi;
    const normalizedMeasure = (value: string) => value.toLowerCase().replace(",", ".").replace(/degrees?|grader/g, "°").replace(/celsius/g, "c").replace(/fahrenheit/g, "f").replace(/\s+/g, "");
    const actual = (text.match(measurement) ?? []).map(normalizedMeasure);
    if ((qualifier.match(measurement) ?? []).some(value => !actual.includes(normalizedMeasure(value)))) return false;
    if (method[0] === "dishwasher") return /dishwasher[- ](?:safe|safety)|safe (?:for|in) (?:a |the )?dishwasher|(?:wash\w*|clean\w*|put)\s+(?:it\s+)?(?:in|using)\s+(?:a |the )?dishwasher|use\s+(?:a |the )?dishwasher|(?:suitable|approved)\s+(?:for|in)\s+(?:a |the )?dishwasher|dishwasher(?: use| washing)?\s*(?::|is|washing is)?\s*(?:not )?(?:safe|allow\w*|approv\w*|established|specified)|(?:tåler|vask\w* i|rengør\w* i|brug af)\s+(?:ikke\s+)?(?:en\s+)?opvaskemaskin\w*|opvaskemaskin\w*[- ](?:sikker|egnet|tilladt)|opvaskemaskin\w*\s*(?::|er)?\s*(?:ikke )?(?:tilladt|egnet|dokumenteret|oplyst)/i.test(text);
    if (method[0] === "strong household chemicals") return sourceSupportsFacet(text, "prohibited_method") && method[1].test(text);
    return sourceSupportsFacet(text, facet);
  }
  if (facet === "certification") {
    if (/fire.resistan|brandmodstand|brandhæmmende/i.test(qualifier)) return /fire.resistan|brandmodstand|brandhæmmende/i.test(text);
    if (/fire.safe|brandsikker/i.test(qualifier)) return /fire.safe|brandsikker/i.test(text);
    const codes = qualifier.match(/\b(?:UL|FSC|CE|GS|OEKO[- ]TEX|ISO)(?:\s+\d+(?:[-:]\d+)*)?\b/gi);
    if (codes?.length) {
      const tokens = (value: string) => value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
      const tokenMatches = [...text.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)];
      const source = tokenMatches.map(match => match[0]);
      return codes.every(code => {
        const requested = tokens(code);
        const connective = /^(?:to|under|for|according|standard|the|a|an|is|er|efter|med|til|i|henhold|ikke|not|no|verified|verificeret|bekræftet|safety|fire|resistance|and|og|ul|fsc|ce|gs|iso)$/;
        const linked = (words: string[]) => words.every(word => connective.test(word)) && (!words.some(word => /^(?:ul|fsc|ce|gs|iso)$/.test(word)) || words.some(word => /^(?:and|og)$/.test(word)));
        const certification = /^(?:certif\w*|standard|godkend\w*)$/;
        return source.some((_, index) => requested.every((token, offset) => source[index + offset] === token)
          && source.some((token, propertyIndex) => certification.test(token)
            && (propertyIndex < index && index - propertyIndex <= 4 && linked(source.slice(propertyIndex + 1, index))
              && (source.slice(propertyIndex + 1, index).some(word => /^(?:to|under|for|efter|med|til)$/.test(word)) || text.slice(tokenMatches[propertyIndex].index! + token.length, tokenMatches[index].index).includes(":"))
              || propertyIndex >= index + requested.length && propertyIndex - index - requested.length <= 3 && linked(source.slice(index + requested.length, propertyIndex)))));
      });
    }
  }
  const normalized = (value: string) => value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
  return normalized(text).includes(normalized(qualifier));
}
export function sourceSupportsRequest(text: string, request: PreciseAnswerRequest): boolean {
  if (!sourceSupportsFacet(text, request.facet)) return false;
  const qualifiers = request.qualifiers ?? [];
  if (!qualifiers.length) return true;
  const clauses = text.split(/[;\n]|[.!?]\s+/);
  return clauses.some(clause => sourceSupportsFacet(clause, request.facet) && qualifiers.every(qualifier => qualifierSupported(clause, qualifier, request.facet)));
}


/** Redundant facet labels add no qualifier; named methods/standards remain exact. */
export function redundantFacetQualifier(facet: AnswerFacet, value: string): boolean {
  const labels: Partial<Record<AnswerFacet, string[]>> = {
    material_composition: ["material", "materials", "material composition", "composition", "materiale", "materialesammensætning"],
    load_capacity: ["weight", "vægt", "load capacity", "maximum load", "maximum weight", "weight capacity", "maksimal belastning", "bæreevne"],
    weight_limit: ["weight", "vægt", "weight limit", "maximum weight", "vægtgrænse"],
    dimension_width: ["width", "wide", "bredde", "bredden", "bred"],
    dimension_depth: ["depth", "deep", "dybde", "dybden", "dyb"],
    dimension_height: ["height", "high", "tall", "højde", "højden", "høj"],
    certification: ["certification", "safety certification", "certificering", "sikkerhedscertificering"],
    cleaning_method: ["cleaning method", "washing instructions", "cleaning instructions", "rengøringsmetode"],
  };
  return labels[facet]?.includes(value.toLowerCase().trim().replace(/^(?:how much|what is the|what is|hvor meget|hvad er den|hvad er|how|hvor)\s+/, "")) ?? false;
}

export function qualifierLabel(value: string, facet: CoveredAnswerFacet): string {
  if (["cleaning_method", "prohibited_method"].includes(facet)) return methodQualifiers.find(([, pattern]) => pattern.test(value))?.[0] ?? value;
  if (facet === "certification") {
    if (/fire.resistan|brandmodstand|brandhæmmende/i.test(value)) return "fire resistance";
    if (/fire.safe|brandsikker/i.test(value)) return "fire safety";
    const codes = value.match(/\b(?:UL|FSC|CE|GS|OEKO[- ]TEX|ISO)(?:\s+\d+(?:[-:]\d+)*)?\b/gi);
    if (codes?.length) return codes.map(code => code.toUpperCase()).join(", ");
  }
  return value;
}
