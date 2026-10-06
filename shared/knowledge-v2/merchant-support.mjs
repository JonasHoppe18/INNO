// Merchant document semantics, independent of the legacy slot evaluator.
import { randomUUID, createHash } from "node:crypto";
import { UUID_PATTERN } from "./references.mjs";

export const SUPPORT_TYPES = Object.freeze({
  FACT: "value",
  POLICY: "notice",
  GUIDANCE: "guidance",
  PROCEDURE: "procedure",
});
export const SUPPORT_DOMAINS = Object.freeze([
  "general",
  "shipping",
  "delivery",
  "returns",
  "orders",
  "warranty",
  "damaged_item",
  "product",
  "compatibility",
  "care",
  "assembly",
  "troubleshooting",
]);
const ALIASES = {
  shipping_delivery: "shipping",
  returns_refunds: "returns",
  orders_order_changes: "orders",
  warranty_complaints: "warranty",
  damaged_or_wrong_item: "damaged_item",
  product_facts: "product",
  product_compatibility: "compatibility",
  product_care: "care",
  assembly_setup: "assembly",
  refunds: "returns",
  return: "returns",
  order_changes: "orders",
  cancellation: "orders",
  complaints: "warranty",
  complaints_warranty: "warranty",
  damaged_wrong_item: "damaged_item",
  product_support: "product",
  setup: "assembly",
};
const object = (v) => v && typeof v === "object" && !Array.isArray(v);
export function normalizeSupportDomain(value) {
  const key = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s/-]+/g, "_");
  return SUPPORT_DOMAINS.includes(key) ? key : ALIASES[key] || null;
}
export function validateSupportPayload(unit, platform) {
  const p = unit.payload,
    errors = [];
  const error = (code, message) =>
    errors.push({ code, location: "$.payload", message });
  if (!platform.merchant_support_contract) {
    error(
      "support.contract_unavailable",
      "This platform does not support merchant documents.",
    );
    return errors;
  }
  if (p.contract !== "merchant_support/v1")
    error("support.contract", "Unknown merchant document contract.");
  if (SUPPORT_TYPES[p.semantic_type] !== unit.kind)
    error(
      "support.semantic_type",
      "Semantic type and storage kind must agree.",
    );
  if (!SUPPORT_DOMAINS.includes(unit.domain_key))
    error("support.domain", "Use a canonical support domain.");
  if (typeof p.title !== "string" || !p.title.trim())
    error("support.title", "A unit needs a title.");
  if (typeof p.text !== "string" || !p.text.trim() || p.text.length > 20000)
    error("support.text", "A unit needs bounded source text.");
  if (
    !object(p.source_location) ||
    !Number.isInteger(p.source_location.start) ||
    !Number.isInteger(p.source_location.end) ||
    p.source_location.start < 0 ||
    p.source_location.end <= p.source_location.start ||
    p.source_location.end - p.source_location.start !== p.text?.length
  )
    error(
      "support.source_location",
      "Source offsets must bound the exact text.",
    );
  if (
    !Array.isArray(p.provenance) ||
    p.provenance.length !== 1 ||
    !UUID_PATTERN.test(p.provenance[0]?.source_id ?? "") ||
    p.provenance[0]?.role !== "supports"
  )
    error("support.provenance", "One verified source reference is required.");
  if (!/^sha256:[0-9a-f]{64}$/.test(p.source_hash ?? ""))
    error("support.source_hash", "A source content hash is required.");
  const a = p.applicability;
  if (
    !object(a) ||
    !["merchant", "products", "family"].includes(a.kind) ||
    !Array.isArray(a.product_ids)
  )
    error("support.applicability", "Applicability must be explicit.");
  else {
    if (a.kind === "merchant" && (a.product_ids.length || a.family_key))
      error(
        "support.applicability",
        "Merchant scope must not include product bindings.",
      );
    if (
      a.kind !== "merchant" &&
      (!a.product_ids.length ||
        a.product_ids.some(
          (id) => typeof id !== "string" || !/^\d+$/.test(id),
        ) ||
        new Set(a.product_ids).size !== a.product_ids.length)
    )
      error(
        "support.product_ids",
        "Product scope needs distinct verified external IDs.",
      );
    if (
      a.kind === "family" &&
      !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(a.family_key ?? "")
    )
      error(
        "support.family",
        "Family scope needs a stable family key and explicit member IDs.",
      );
    if (a.kind === "products" && a.family_key)
      error("support.family", "Product scope cannot silently become a family.");
    if (JSON.stringify(unit.scope ?? {}) !== JSON.stringify(a))
      error("support.scope", "Unit scope must match payload applicability.");
  }
  if (
    !Array.isArray(p.product_bindings) ||
    (a?.product_ids ?? []).some(
      (id) =>
        !p.product_bindings.some(
          (b) =>
            object(b) &&
            b.id === id &&
            typeof b.title === "string" &&
            b.title.trim(),
        ),
    ) ||
    p.product_bindings.some(
      (b) => !object(b) || !(a?.product_ids ?? []).includes(b.id),
    )
  )
    error(
      "support.product_binding",
      "Every scoped product needs a catalog identity.",
    );
  if (
    p.semantic_type === "POLICY" &&
    (!object(p.policy) ||
      p.policy.text !== p.text ||
      Object.keys(p.policy).some((k) => k !== "text"))
  )
    error(
      "support.policy",
      "Policy content must equal the reviewed source text.",
    );
  if (p.semantic_type !== "POLICY" && p.policy !== undefined)
    error("support.policy", "Only policy units may carry a policy.");
  if (p.semantic_type === "PROCEDURE") {
    const lines = String(p.text ?? "")
      .split("\n")
      .filter((l) => l.trim());
    if (
      !Array.isArray(p.steps) ||
      p.steps.length < 1 ||
      lines.length !== p.steps.length ||
      p.steps.some(
        (s, i) =>
          !object(s) ||
          s.order !== i + 1 ||
          typeof s.text !== "string" ||
          !s.text.trim() ||
          !/^\d+[.)]\s+/.test(lines[i] ?? "") ||
          (lines[i] ?? "").replace(/^\d+[.)]\s+/, "") !== s.text ||
          Number(lines[i]?.match(/^\d+/)?.[0]) !== i + 1,
      )
    )
      error(
        "support.procedure_steps",
        "Procedures require contiguous ordered actions from the source.",
      );
    if (
      Array.isArray(p.steps) &&
      p.steps.some(
        (s) =>
          !object(s) ||
          !/^\s*(?:obtain|submit|check|confirm|attach|connect|disconnect|press|hold|select|open|enable|disable|remove|install|update|reset|test|try|charge|pair|plug|wait|place|align|insert|tighten|secure|assemble|position|turn|wipe|wash|dry|clean)\b/i.test(
            s.text,
          ),
      )
    )
      error(
        "support.procedure_actions",
        "Every ordered step needs an explicit action.",
      );
  } else if (p.steps !== undefined)
    error(
      "support.procedure_steps",
      "Only a procedure may carry executable steps.",
    );
  return errors;
}
export function compileSupportUnit({
  type,
  domain,
  text,
  title,
  sourceId,
  sourceContent,
  sourceStart,
  sourceContext = "",
  applicability = { kind: "merchant", product_ids: [] },
  products = [],
  policyId,
  unitId = randomUUID(),
}) {
  const semantic = String(type ?? "").toUpperCase();
  const payload = {
    contract: "merchant_support/v1",
    semantic_type: semantic,
    title,
    text,
    source_context: sourceContext,
    applicability,
    product_bindings: products.map((p) => ({
      id: String(p.id),
      title: p.title,
    })),
    source_hash: `sha256:${createHash("sha256")
      .update(sourceContent ?? "")
      .digest("hex")}`,
    source_location: { start: sourceStart, end: sourceStart + text.length },
    provenance: [{ source_id: sourceId, role: "supports" }],
  };
  if (semantic === "POLICY") payload.policy = { text };
  if (semantic === "PROCEDURE")
    payload.steps = text
      .split("\n")
      .filter((l) => l.trim())
      .map((l, i) => ({ order: i + 1, text: l.replace(/^\d+[.)]\s+/, "") }));
  return {
    unit_id: unitId,
    kind: SUPPORT_TYPES[semantic] ?? "unsupported",
    domain_key: normalizeSupportDomain(domain) ?? domain,
    audience: "customer",
    scope: applicability,
    payload,
    origin_policy_id: policyId,
  };
}
function domainFor(text, productScoped) {
  if (
    /\b(?:wash|clean with|cleaning|care|cloth|abrasive|bleach|drying|dry cleaning|air dry|tumble dry)\b/i.test(
      text,
    )
  )
    return "care";
  if (/\b(?:compatible|compatibility)\b/i.test(text)) return "compatibility";
  if (/\b(?:assembly|installation|mounting|setup|fittings)\b/i.test(text))
    return "assembly";
  if (
    /\b(?:electrical repairs?|troubleshoot|reset|pairing|diagnosis|malfunction)\b/i.test(
      text,
    )
  )
    return "troubleshooting";
  if (productScoped) return "product";
  if (/\b(?:damaged|wrong item|incorrect item|packaging|photo)\b/i.test(text))
    return "damaged_item";
  if (/\b(?:warranty|complaint|defect)\b/i.test(text)) return "warranty";
  if (/\b(?:fulfillment|cancellation|address changes|shipment)\b/i.test(text))
    return "orders";
  if (/\b(?:returns?|refunds?|sellable)\b/i.test(text)) return "returns";
  if (/\b(?:shipping|delivery|business days|destinations)\b/i.test(text))
    return "shipping";
  return "general";
}
function typeFor(text, domain) {
  if (
    /\b(?:do not promise|do not invent|not established|not described|does not state|not approved|undocumented|no approved|unavailable|unresolved|ask for|requires assessment|assessment|guidance|responses should|contact .*support|wipe|clean with|cleaning|wash|avoid|reshape|air .*regularly|do not bleach|do not .*wash|no .*authorized)\b/i.test(
      text,
    )
  )
    return "GUIDANCE";
  if (
    ["shipping", "returns", "orders", "warranty"].includes(domain) ||
    /\b(?:pays|accepted|return window|sellable|may be possible)\b/i.test(text)
  )
    return "POLICY";
  return "FACT";
}
// Conservative extraction preserves source text verbatim. Ambiguous multi-product
// sections are returned for review, never generalized to the whole merchant.
export function extractSupportDocument({
  content,
  title,
  productIds = [],
  catalog = [],
  sourceId,
  policyId,
  defaultDomain = null,
  defaultType = null,
}) {
  if (defaultType !== null && !SUPPORT_TYPES[String(defaultType).toUpperCase()])
    return { units: [], unresolved: [{ code: "knowledge_type_unsupported" }] };
  const units = [],
    unresolved = [];
  const selected = catalog.filter((p) => productIds.includes(String(p.id)));
  if (productIds.length !== selected.length)
    return {
      units,
      unresolved: [
        {
          code: "catalog_binding_missing",
          message:
            "All requested products must be verified in this shop catalog.",
        },
      ],
    };
  if (defaultDomain !== null && !normalizeSupportDomain(defaultDomain))
    return { units, unresolved: [{ code: "domain_unknown" }] };
  let heading = title,
    bodyStart = 0;
  const sections = [];
  const matches = [...content.matchAll(/^#{1,6}\s+(.+)$/gm)];
  if (!matches.length)
    sections.push({ heading, start: 0, end: content.length });
  for (let i = 0; i < matches.length; i++)
    sections.push({
      heading: matches[i][1],
      start: matches[i].index + matches[i][0].length,
      end: matches[i + 1]?.index ?? content.length,
    });
  for (const s of sections) {
    const raw = content.slice(s.start, s.end),
      lead = raw.search(/\S/);
    if (lead < 0) continue;
    const sectionText = raw.trim(),
      start = s.start + lead;
    let bound = selected;
    if (selected.length > 1) {
      bound = selected.filter((p) =>
        s.heading.toLowerCase().includes(p.title.toLowerCase()),
      );
      if (bound.length !== 1) {
        unresolved.push({
          code: "ambiguous_product_section",
          heading: s.heading,
          text: sectionText,
        });
        continue;
      }
    }
    const scope = bound.length
      ? { kind: "products", product_ids: bound.map((p) => String(p.id)) }
      : { kind: "merchant", product_ids: [] };
    const ordered =
      /^1[.)]\s+/.test(sectionText) &&
      sectionText
        .split("\n")
        .filter((l) => l.trim())
        .every((l) => /^\d+[.)]\s+/.test(l));
    const parts = ordered
      ? [sectionText]
      : sectionText.split(/(?<=[.!?])\s+(?=[A-Z])/);
    let offset = 0;
    for (const part of parts) {
      const pos = sectionText.indexOf(part, offset);
      offset = pos + part.length;
      const domain = defaultDomain
        ? normalizeSupportDomain(defaultDomain)
        : domainFor(`${s.heading}\n${part}`, bound.length > 0);
      const type = defaultType
        ? String(defaultType).toUpperCase()
        : ordered
          ? "PROCEDURE"
          : typeFor(part, domain);
      units.push(
        compileSupportUnit({
          type,
          domain,
          text: part,
          title: `${title} / ${s.heading}`,
          sourceId,
          sourceContent: content,
          sourceStart: start + pos,
          sourceContext: s.heading,
          applicability: scope,
          products: bound,
          policyId,
        }),
      );
    }
  }
  return { units, unresolved };
}
// Same scoped statement with different numeric values is a review conflict.
// Different sections retain their context, including country or variant.
export function supportSourceConflicts(units) {
  const byKey = new Map(),
    conflicts = [];
  for (const u of units) {
    const p = u.payload;
    if (
      p?.contract !== "merchant_support/v1" ||
      !["FACT", "POLICY"].includes(p.semantic_type) ||
      !/\d/.test(p.text)
    )
      continue;
    const key = JSON.stringify([
      u.domain_key,
      p.semantic_type,
      p.applicability,
      p.source_context,
      p.text.replace(/\d+(?:[.,]\d+)?/g, "#").toLowerCase(),
    ]);
    const previous = byKey.get(key);
    if (previous && previous.payload.text !== p.text)
      conflicts.push({
        code: "conflict.source_values",
        unit_ids: [previous.unit_id, u.unit_id],
      });
    else byKey.set(key, u);
  }
  return conflicts;
}
