// Facets describe customer meaning. Values always come from activated source units.
export const POLICY_DOMAINS = [
  "shipping",
  "returns",
  "orders",
  "damaged_item",
  "warranty",
];
export const POLICY_FACETS = [
  "timing",
  "timing_scope",
  "price",
  "threshold",
  "destinations",
  "window",
  "condition",
  "exclusion",
  "responsibility",
  "boundary",
  "intake",
  "assessment",
  "exception",
];
export function compilePolicyRequirements(
  intents = [],
  verifiedDestination = null,
) {
  return intents
    .map((intent) => {
      const facets = new Set(
        intent.facets.filter((f) => POLICY_FACETS.includes(f)),
      );
      if (intent.domain === "shipping" && facets.has("timing"))
        facets.add("timing_scope");
      if (intent.domain === "shipping" && facets.has("price"))
        facets.add("threshold");
      if (
        intent.domain === "returns" &&
        (facets.has("window") || facets.has("condition"))
      ) {
        for (const facet of ["window", "condition", "exclusion", "exception"])
          facets.add(facet);
      }
      return {
        domain: intent.domain,
        facets: [...facets],
        destination:
          intent.destinationCountryCode || verifiedDestination || null,
      };
    })
    .filter((r) => POLICY_DOMAINS.includes(r.domain) && r.facets.length);
}
const regionNames = ["en", "da", "de"].map(
  (locale) => new Intl.DisplayNames(locale, { type: "region" }),
);
const countries = Object.fromEntries(
  Array.from({ length: 676 }, (_, index) =>
    String.fromCharCode(65 + Math.floor(index / 26), 65 + (index % 26)),
  )
    .filter((code) => regionNames[0].of(code) !== code)
    .map((code) => [
      code,
      new RegExp(
        "(?:^|[^\\p{L}])(?:" +
          regionNames
            .map((names) =>
              names.of(code).replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&"),
            )
            .join("|") +
          ")(?=$|[^\\p{L}])",
        "iu",
      ),
    ]),
);
function destinations(unit) {
  const declared = unit.payload.applicability.destination_country_codes;
  if (Array.isArray(declared)) return declared;
  return Object.entries(countries)
    .filter(([, pattern]) =>
      pattern.test(unit.payload.title + "\n" + unit.payload.text),
    )
    .map(([code]) => code);
}
function facets(unit) {
  const text = unit.payload.text;
  const context = unit.payload.title + "\n" + text;
  const found = [];
  const has = (facet, pattern, value = text) => {
    if (pattern.test(value)) found.push(facet);
  };
  if (["shipping", "delivery"].includes(unit.domain_key)) {
    if (/\d+.*(?:days|dage|tage|hours|timer|stunden)/i.test(text))
      has("timing", /delivery|levering|liefer|arrival|estimate/i);
    has(
      "timing_scope",
      /(?:not|ikke|kein).*(?:dispatch|afsend|versand)|(?:estimates?|estimater).*(?:not|ikke|kein)/i,
    );
    if (
      !/(?:free|gratis|kostenlos)/i.test(text) ||
      /(?:standard|fee|cost|shipping:\s*\d)/i.test(text)
    )
      has("price", /(?:shipping|fragt|versand).*(?:\d|cost|fee|pris)/i);
    has(
      "threshold",
      /(?:free|gratis|kostenlos).*(?:shipping|fragt|versand)|(?:shipping|fragt|versand).*free/i,
    );
    has("destinations", /(?:destinations|lande|countries|ship to)/i);
  }
  if (unit.domain_key === "returns") {
    has(
      "window",
      /(?:return|retur|rück).*(?:\d|days|dage|tage)|\d+\s*days.*(?:unused|return)/i,
    );
    has(
      "condition",
      /unused|sellable|unworn|unopened|ubrugt|salgbar|unbenutzt/i,
    );
    has(
      "exclusion",
      /(?:cannot|not|excluded|except|ikke|ausgeschlossen).*(?:return|retur|items|products)|non.returnable/i,
    );
    has(
      "responsibility",
      /(?:pays?|cost|betaler|zahlt).*(?:shipping|fragt|versand)|(?:shipping|fragt|versand).*(?:responsib|customer|merchant)/i,
    );
    has("assessment", /inspection|assessment|authorization|inspect|vurder/i);
  }
  if (unit.domain_key === "orders")
    has(
      "boundary",
      /before fulfillment|after fulfillment|after shipment|pre.fulfillment|før.*afsend|efter.*afsend/i,
      context,
    );
  if (["damaged_item", "warranty"].includes(unit.domain_key)) {
    has(
      "responsibility",
      /(?:pays?|cost|betaler|zahlt).*(?:shipping|fragt|versand)/i,
    );
    has(
      "intake",
      /photo|order identification|order number|description|foto|ordrenummer/i,
    );
    has("assessment", /assessment|authorization|capability|vurder/i);
    has("exception", /separate.*ordinary returns|ordinary returns.*separate/i);
  }
  return found;
}
function specificity(unit) {
  const p = unit.payload;
  return (
    (p.applicability.kind === "merchant" ? 0 : 4) +
    (destinations(unit).length ? 2 : 0) +
    (/^(?:FAQ|Frequently asked)/i.test(p.title) ? 0 : 1)
  );
}
/** All candidates have already passed tenant, active-release and platform validation. */
export function selectMaterialPolicyUnits(
  units,
  requirements,
  selectedProducts = [],
  limit = 5,
) {
  const selected = new Map();
  const coverage = [];
  const applicable = units.filter(
    (u) =>
      u.payload.applicability.kind === "merchant" ||
      (selectedProducts.length &&
        u.payload.applicability.product_ids.some((id) =>
          selectedProducts.includes(id),
        )),
  );
  for (const requirement of requirements) {
    const candidates = applicable.filter((u) => {
      const domain = u.domain_key === "delivery" ? "shipping" : u.domain_key;
      const matchesDomain =
        domain === requirement.domain ||
        (requirement.domain === "returns" &&
          ["damaged_item", "warranty"].includes(domain));
      const scope = destinations(u);
      return (
        matchesDomain &&
        (!scope.length ||
          (requirement.facets.includes("destinations") &&
            facets(u).includes("destinations")) ||
          Boolean(
            requirement.destination && scope.includes(requirement.destination),
          ))
      );
    });
    const required = new Set(requirement.facets);
    // Every applicable eligibility exception is material, even when split across source units.
    for (const u of candidates)
      if (facets(u).includes("exclusion")) required.add("exclusion");
    const available = [...required].filter((f) =>
      candidates.some((u) => facets(u).includes(f)),
    );
    const evidenceByFacet = {};
    for (const facet of available) {
      const matching = candidates
        .filter((u) => facets(u).includes(facet))
        .sort(
          (a, b) =>
            specificity(b) - specificity(a) ||
            a.payload.text.length - b.payload.text.length ||
            a.id.localeCompare(b.id),
        );
      const best = matching[0];
      // Preserve distinct conditions from the same most-specific authoritative section.
      const winners = matching.filter(
        (u) =>
          specificity(u) === specificity(best) &&
          (facet === "boundary"
            ? true
            : facet === "condition" ||
                facet === "exclusion" ||
                facet === "intake"
              ? u.payload.provenance?.[0]?.source_id &&
                best.payload.provenance?.[0]?.source_id
                ? u.payload.provenance[0].source_id ===
                  best.payload.provenance[0].source_id
                : u.payload.title === best.payload.title
              : u.id === best.id),
      );
      evidenceByFacet[facet] = [];
      for (const u of winners) {
        const key = u.payload.text.trim().toLowerCase();
        const duplicate = [...selected.values()].find(
          (other) => other.payload.text.trim().toLowerCase() === key,
        );
        if (!duplicate) selected.set(u.id, u);
        evidenceByFacet[facet].push(duplicate?.id ?? u.id);
      }
    }
    coverage.push({
      ...requirement,
      evidenceByFacet,
      available,
      missing: [...required].filter((f) => !available.includes(f)),
    });
  }
  const chosen = [];
  let evidenceChars = 0;
  for (const unit of selected.values()) {
    if (chosen.length >= Math.max(1, Math.min(limit, 20))) break;
    if (evidenceChars + unit.payload.text.length > 4000) continue;
    chosen.push(unit);
    evidenceChars += unit.payload.text.length;
  }
  // Report truncation as a coverage gap rather than claiming complete evidence.
  for (const c of coverage)
    c.omitted = c.available.filter((f) =>
      c.evidenceByFacet[f].some((id) => !chosen.some((u) => u.id === id)),
    );
  return { units: chosen, coverage };
}
