// Narrow, deterministic manual-authoring contract for Knowledge V2.
//
// v0.1 intentionally supports one existing typed Returns slot only: exchange
// availability. The merchant's prose is retained as source/provenance for
// review, while the runtime unit is compiled from the typed value. This keeps
// arbitrary free text out of evaluator decisions and the brief-driven writer.

import { randomUUID } from "node:crypto";
import {
  extractReferences,
  UUID_PATTERN,
} from "../../../../../shared/knowledge-v2/references.mjs";
import { validateUnit } from "../../../../../shared/knowledge-v2/units.mjs";
import { parseReturnsGuidance } from "../../../../../shared/knowledge-v2/authoring/manual-returns.mjs";

export const MANUAL_KNOWLEDGE_TYPES = Object.freeze({
  returns_exchange: Object.freeze({
    label: "Exchange availability",
    domain: "returns",
    domainLabel: "Returns",
    kind: "slot_rule",
    family: "EXCH",
    slot: "returns.EXCH.offered",
  }),
});

export { parseReturnsGuidance };

export const MANUAL_APPLICABILITY = "All supported products";

const DOMAIN_LABELS = Object.freeze({
  returns: "Returns",
  product_support: "Product Support",
  complaints_warranty: "Warranty / Complaints",
  order_status: "Order Status",
});

function clean(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function error(code, message, field = null) {
  return { code, message, field };
}

export function normalizeManualDraft(input = {}) {
  const domain = clean(input.domain)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const knowledgeType = clean(input.knowledgeType || input.knowledge_type);
  return {
    title: clean(input.title),
    domain,
    customerContent: clean(input.customerContent || input.customer_content),
    appliesTo: clean(input.appliesTo || input.applies_to),
    condition: clean(input.condition || input.context),
    knowledgeType,
    policyId: clean(input.policyId || input.policy_id) || null,
    sourceUnitId: clean(input.sourceUnitId || input.source_unit_id) || null,
  };
}

export function compileManualUnit({
  draft,
  sourceId,
  policyId,
  unitId = randomUUID(),
}) {
  const type = MANUAL_KNOWLEDGE_TYPES[draft.knowledgeType];
  if (!type) throw new Error("Unsupported manual Knowledge type.");
  return {
    unit_id: unitId,
    kind: type.kind,
    domain_key: type.domain,
    family_key: type.family,
    slot_key: type.slot,
    audience: "customer",
    scope: {},
    payload: {
      state: "configured",
      value: { offered: true },
      provenance: [{ source_id: sourceId, role: "supports" }],
    },
    origin_policy_id: policyId,
  };
}

const RETURNS_UNIT_TITLES = Object.freeze({
  accepted: "Return eligibility",
  window: "Return window",
  method: "Starting a return",
  payer: "Return shipping",
  shipping: "Tracked return shipping",
  destination: "Return destination",
  address: "Return address",
  refund_expectation: "Refund processing",
  timing: "Refund processing",
  exchange: "Exchanges",
  item_conditions: "Return condition",
});

function returnsProvenance(sourceId) {
  return sourceId ? [{ source_id: sourceId, role: "supports" }] : [];
}

/**
 * Compile every recognized Returns statement into the existing frozen unit
 * shapes. The caller decides which unit ids replace the active release; no
 * browser-provided unit id is trusted here.
 */
export function compileReturnsGuidanceUnits({
  proposals = [],
  sourceId,
  policyId,
  unitIds = {},
  scope = {},
}) {
  const compiled = [];
  const resolvedIds = { ...unitIds };
  for (const proposal of proposals) {
    if (proposal?.key && !resolvedIds[proposal.key])
      resolvedIds[proposal.key] = randomUUID();
  }
  const idFor = (key) => resolvedIds[key] || (resolvedIds[key] = randomUUID());
  const common = (key, kind, family = null, slot = null, payload = {}) => ({
    unit_id: idFor(key),
    kind,
    domain_key: "returns",
    family_key: family,
    slot_key: slot,
    audience: "customer",
    scope,
    payload: { ...payload, provenance: returnsProvenance(sourceId) },
    origin_policy_id: policyId,
  });

  for (const proposal of proposals) {
    const value = proposal.value || {};
    if (proposal.key === "accepted") {
      compiled.push({
        ...common("accepted", "slot_rule", "ELIG", "returns.ELIG.accepted", {
          state: "configured",
          value: { accepted: Boolean(value.accepted) },
        }),
        evidence: proposal.sentence ? [proposal.sentence] : [],
      });
    } else if (proposal.key === "window") {
      compiled.push({
        ...common("window", "slot_rule", "ELIG", "returns.ELIG.window", {
          state: "configured",
          value: value,
        }),
        evidence: proposal.sentence ? [proposal.sentence] : [],
      });
    } else if (proposal.key === "method") {
      const requirements = (Array.isArray(value.requirements) ? value.requirements : [])
        .filter((item) => ["reason", "name", "order_number", "contact"].includes(item))
        .map((item) => item === "reason"
          ? { stage: "to_initiate", fact: "return_subject.reason" }
          : item === "name"
            ? { stage: "to_initiate", fact: "customer.name" }
            : item === "order_number"
              ? { stage: "to_initiate", fact: "order.ref_resolution", satisfied_when: { op: "eq", value: "resolved" } }
              : { stage: "to_initiate", fact: "interaction.channel", satisfied_when: { op: "in", value: ["email", "chat", "contact_form"] } });
      compiled.push({
        ...common("method", "slot_rule", "PROC", "returns.PROC.method", {
          state: "configured",
          value: { method: value.method },
          ...(requirements.length ? { requirements } : {}),
        }),
        evidence: proposal.sentence ? [proposal.sentence] : [],
      });
    } else if (proposal.key === "payer") {
      compiled.push({
        ...common("payer", "slot_rule", "LOG", "returns.LOG.payer", {
          state: "configured",
          value: { payer: value.payer, mechanism: value.mechanism },
        }),
        evidence: proposal.sentence ? [proposal.sentence] : [],
      });
    } else if (proposal.key === "shipping") {
      const tracked = value.tracked === "recommended" ? "recommended" : "required";
      compiled.push({
        ...common("shipping", tracked === "recommended" ? "guidance" : "procedure", "LOG", null, {
          applies_to: "returns.return_shipment",
          ...(tracked === "required" ? { shipping: { tracked } } : {}),
          texts: [
            {
              role: tracked === "required" ? "steps" : "explanation",
              audience: "customer",
              locale: "en",
              text: proposal.sentence,
            },
          ],
        }),
        evidence: proposal.sentence ? [proposal.sentence] : [],
      });
    } else if (proposal.key === "destination") {
      compiled.push({
        ...common(
          "destination",
          "slot_rule",
          "LOG",
          "returns.LOG.destination",
          {
            state: "configured",
            value: {
              disclosure: value.disclosure || "provided_via_method",
              ...(value.disclosure === "disclosed" && resolvedIds.address
                ? { ref: resolvedIds.address }
                : {}),
            },
          },
        ),
        evidence: proposal.sentence ? [proposal.sentence] : [],
      });
    } else if (proposal.key === "address") {
      compiled.push({
        ...common("address", "value", null, null, {
          value_type: "postal_address",
          address: {
            name: value.name,
            line1: value.line1,
            postal_code: value.postal_code,
            city: value.city,
            country: value.country,
          },
        }),
        evidence: proposal.sentence ? [proposal.sentence] : [],
      });
    } else if (proposal.key === "refund_expectation") {
      compiled.push({
        ...common("refund_expectation", "expectation", null, null, {
          event: value.event,
          after: value.after,
          duration: value.duration ?? null,
        }),
        evidence: proposal.sentence ? [proposal.sentence] : [],
      });
    } else if (proposal.key === "timing") {
      compiled.push({
        ...common("timing", "slot_rule", "MONEY", "returns.MONEY.timing", {
          state: "configured",
          value: { ref: idFor(value.refKey || "refund_expectation") },
        }),
        evidence: proposal.sentence ? [proposal.sentence] : [],
      });
    } else if (proposal.key === "exchange") {
      compiled.push({
        ...common("exchange", "slot_rule", "EXCH", "returns.EXCH.offered", {
          state: value.offered ? "configured" : "explicitly_none",
          ...(value.offered ? { value: { offered: true } } : {}),
        }),
        evidence: proposal.sentence ? [proposal.sentence] : [],
      });
    } else if (proposal.key === "item_conditions") {
      compiled.push({
        ...common(
          "item_conditions",
          "slot_rule",
          "ELIG",
          "returns.ELIG.item_conditions",
          {
            state: "configured",
            value: { conditions: value.conditions },
          },
        ),
        evidence: proposal.sentence ? [proposal.sentence] : [],
      });
    }
  }
  return compiled;
}

export function validateReturnsGuidanceUnits({ units, platform }) {
  const errors = [];
  for (const unit of units || []) {
    errors.push(
      ...validateUnit(platform, unit).map((item) => ({
        ...item,
        unit_id: unit.unit_id,
      })),
    );
    errors.push(
      ...extractReferences(platform, unit.kind, unit.payload).errors.map(
        (item) => ({
          ...item,
          unit_id: unit.unit_id,
        }),
      ),
    );
  }
  return errors;
}

export function validateManualDraft({
  draft: rawDraft,
  platform,
  sourceId,
  policyId,
  unitId,
}) {
  const draft = normalizeManualDraft(rawDraft);
  const errors = [];
  const type = MANUAL_KNOWLEDGE_TYPES[draft.knowledgeType];

  if (!draft.title || draft.title.length < 3)
    errors.push(
      error(
        "title_required",
        "Add a short title so your team can recognize this guidance.",
        "title",
      ),
    );
  if (draft.title.length > 120)
    errors.push(
      error("title_too_long", "Keep the title under 120 characters.", "title"),
    );
  if (!draft.customerContent)
    errors.push(
      error(
        "content_required",
        "Add the customer-facing wording you want to keep with this guidance.",
        "customerContent",
      ),
    );
  if (draft.customerContent.length > 4000)
    errors.push(
      error(
        "content_too_long",
        "Keep customer-facing content under 4,000 characters.",
        "customerContent",
      ),
    );
  if (!draft.domain || !DOMAIN_LABELS[draft.domain])
    errors.push(
      error("domain_unknown", "Choose a supported Knowledge area.", "domain"),
    );
  if (!type)
    errors.push(
      error(
        "knowledge_type_unsupported",
        "This Knowledge type is not available in the first manual authoring slice.",
        "knowledgeType",
      ),
    );
  if (type && draft.domain !== type.domain)
    errors.push(
      error(
        "domain_type_mismatch",
        `${type.label} belongs to ${type.domainLabel}.`,
        "domain",
      ),
    );
  if (draft.appliesTo !== MANUAL_APPLICABILITY)
    errors.push(
      error(
        "applicability_required",
        "For this first slice, choose “All supported products” so Sona has an explicit, deterministic scope.",
        "appliesTo",
      ),
    );
  if (draft.condition)
    errors.push(
      error(
        "condition_unsupported",
        "This typed rule does not support an additional condition yet. Leave the condition/context empty rather than asking Sona to guess.",
        "condition",
      ),
    );
  if (!sourceId)
    errors.push(
      error(
        "provenance_required",
        "A manual source must be created before this draft can be reviewed.",
        "sourceId",
      ),
    );
  if (sourceId && !UUID_PATTERN.test(sourceId))
    errors.push(
      error(
        "provenance_invalid",
        "The manual source could not be resolved.",
        "sourceId",
      ),
    );
  if (policyId && !UUID_PATTERN.test(policyId))
    errors.push(
      error(
        "policy_invalid",
        "The draft reference could not be resolved.",
        "policyId",
      ),
    );
  if (unitId && !UUID_PATTERN.test(unitId))
    errors.push(
      error(
        "unit_invalid",
        "The typed Knowledge reference could not be resolved.",
        "unitId",
      ),
    );
  const containsUuid = (value) =>
    value
      .split(/\s+/)
      .some((part) =>
        UUID_PATTERN.test(part.replace(/^[([{<]|[\])},.;:!?]+$/g, "")),
      );
  if (containsUuid(draft.title) || containsUuid(draft.customerContent)) {
    errors.push(
      error(
        "forbidden_reference",
        "UUID-like references are not allowed in merchant text.",
        "customerContent",
      ),
    );
  }

  let unit = null;
  if (!errors.length) {
    unit = compileManualUnit({ draft, sourceId, policyId, unitId });
    errors.push(
      ...validateUnit(platform, unit).map((item) =>
        error(item.code, item.message, item.location),
      ),
    );
    const references = extractReferences(platform, unit.kind, unit.payload);
    errors.push(
      ...references.errors.map((item) =>
        error(item.code, item.message, item.location),
      ),
    );
  }
  return { ok: errors.length === 0, errors, draft, unit };
}

export function manualStatus(reviewState) {
  if (reviewState === "published") return "Published";
  if (reviewState === "approved" || reviewState === "ready_for_review")
    return "Needs review";
  return "Draft";
}
