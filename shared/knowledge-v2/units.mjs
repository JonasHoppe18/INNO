import { validateSupportPayload } from "./merchant-support.mjs";
// Validates a unit version against the pinned platform file.
// Structural rules only; references are validated by references.mjs.

const OBJECT = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function enumValues(platform, name) {
  const values = platform?.enums?.[name];
  return Array.isArray(values) ? values : null;
}

// Minimal schema subset used by platform value schemas: type, required,
// properties, enum (by enum name).
export function validateValue(platform, schema, value, location, errors) {
  if (!schema) return;
  if (schema.enum) {
    const values = enumValues(platform, schema.enum);
    if (!values) {
      errors.push({ code: "platform.unknown_enum", location, message: `Unknown enum ${schema.enum}.` });
    } else if (!values.includes(value)) {
      errors.push({ code: "value.not_in_enum", location, message: `${location} must be one of ${schema.enum}.` });
    }
    return;
  }
  switch (schema.type) {
    case "object": {
      if (!OBJECT(value)) {
        errors.push({ code: "value.type", location, message: `${location} must be an object.` });
        return;
      }
      for (const key of schema.required ?? []) {
        if (!(key in value)) errors.push({ code: "value.required", location, message: `${location}.${key} is required.` });
      }
      for (const [key, child] of Object.entries(schema.properties ?? {})) {
        if (key in value) validateValue(platform, child, value[key], `${location}.${key}`, errors);
      }
      return;
    }
    case "array":
      if (!Array.isArray(value)) errors.push({ code: "value.type", location, message: `${location} must be an array.` });
      return;
    case "boolean":
      if (typeof value !== "boolean") errors.push({ code: "value.type", location, message: `${location} must be a boolean.` });
      return;
    case "integer":
      if (!Number.isInteger(value)) errors.push({ code: "value.type", location, message: `${location} must be an integer.` });
      return;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        errors.push({ code: "value.type", location, message: `${location} must be a number.` });
      }
      return;
    case "string":
      if (typeof value !== "string") errors.push({ code: "value.type", location, message: `${location} must be a string.` });
      return;
    default:
      return;
  }
}

function validateOutcome(platform, slotSchema, outcome, location, errors) {
  if (!OBJECT(outcome)) {
    errors.push({ code: "outcome.type", location, message: `${location} must be an object.` });
    return;
  }
  const kinds = enumValues(platform, "outcome_kind") ?? [];
  if (!kinds.includes(outcome.kind)) {
    errors.push({ code: "outcome.kind", location, message: `${location}.kind is not a platform outcome kind.` });
    return;
  }
  if (outcome.kind === "value") {
    validateValue(platform, slotSchema, outcome.value, `${location}.value`, errors);
  }
  if (outcome.kind === "human_decision") {
    if (!(enumValues(platform, "human_decision_kind") ?? []).includes(outcome.decision_kind)) {
      errors.push({ code: "outcome.human_decision_kind", location, message: `${location}.decision_kind is invalid.` });
    }
    if (outcome.decision_kind === "schema_gap" && !(enumValues(platform, "schema_gap_subkind") ?? []).includes(outcome.subkind)) {
      errors.push({ code: "outcome.schema_gap_subkind", location, message: `${location}.subkind is invalid.` });
    }
    if (!Array.isArray(outcome.required_context)) {
      errors.push({ code: "outcome.required_context", location, message: `${location}.required_context must be an array.` });
    }
  }
  if (outcome.kind === "exit") {
    const declared = (platform?.exits?.graph ?? []).some(([, to]) => to === outcome.domain);
    if (!declared) errors.push({ code: "outcome.exit_undeclared", location, message: `${location} exits to an undeclared domain.` });
  }
}

// unit: { kind, domain_key, family_key, slot_key, audience, period_start, period_end, period_basis, scope, payload }
export function validateUnit(platform, unit) {
  const errors = [];
  const kinds = platform?.unit_kinds ?? {};
  const kindSpec = kinds[unit.kind];
  if (!kindSpec) {
    errors.push({ code: "unit.unknown_kind", location: "$", message: `Unknown unit kind ${unit.kind}.` });
    return errors;
  }
  if (!(enumValues(platform, "audience") ?? []).includes(unit.audience)) {
    errors.push({ code: "unit.audience", location: "$", message: "Unknown audience." });
  }
  if (Array.isArray(kindSpec.audience) && !kindSpec.audience.includes(unit.audience)) {
    errors.push({ code: "unit.audience_not_allowed", location: "$", message: `${unit.kind} may not use audience ${unit.audience}.` });
  }
  if (!platform?.domains?.[unit.domain_key]) {
    errors.push({ code: "unit.unknown_domain", location: "$", message: `Unknown domain ${unit.domain_key}.` });
  }
  if ((unit.period_start || unit.period_end) && !(enumValues(platform, "period_basis") ?? []).includes(unit.period_basis)) {
    errors.push({ code: "unit.period_basis", location: "$", message: "A bounded period needs a platform period basis." });
  }
  if (!OBJECT(unit.scope ?? {})) errors.push({ code: "unit.scope", location: "$.scope", message: "Scope must be an object." });
  if (!OBJECT(unit.payload)) {
    errors.push({ code: "unit.payload", location: "$", message: "Payload must be an object." });
    return errors;
  }

  if (unit.payload.contract !== undefined || unit.payload.semantic_type !== undefined) {
    errors.push(...validateSupportPayload(unit, platform));
    return errors;
  }

  if (kindSpec.requires_slot) {
    const slot = platform?.slots?.[unit.slot_key];
    if (!slot) {
      errors.push({ code: "unit.unknown_slot", location: "$", message: `Unknown slot ${unit.slot_key}.` });
      return errors;
    }
    if (unit.family_key !== slot.family) {
      errors.push({ code: "unit.family_mismatch", location: "$", message: `Slot ${unit.slot_key} belongs to ${slot.family}.` });
    }
    if (!unit.slot_key.startsWith(`${unit.domain_key}.`)) {
      errors.push({ code: "unit.domain_mismatch", location: "$", message: `Slot ${unit.slot_key} is outside ${unit.domain_key}.` });
    }
    const payload = unit.payload;
    if (unit.kind === "coverage_state") {
      if (!(enumValues(platform, "coverage_state") ?? []).includes(payload.state)) {
        errors.push({ code: "coverage.state", location: "$.state", message: "Coverage state must be a platform coverage state." });
      }
      if (!(enumValues(platform, "coverage_reason") ?? []).includes(payload.reason)) {
        errors.push({ code: "coverage.reason", location: "$.reason", message: "Coverage reason is invalid." });
      }
      if (typeof payload.review_item_id !== "string") {
        errors.push({ code: "coverage.review_item", location: "$.review_item_id", message: "Blocked coverage must reference its review item." });
      }
      return errors;
    }
    if (!(enumValues(platform, "slot_state") ?? []).includes(payload.state)) {
      errors.push({ code: "slot.state", location: "$.state", message: "Slot state is invalid." });
      return errors;
    }
    if (payload.state === "configured") {
      const hasValue = "value" in payload;
      const hasBranches = Array.isArray(payload.branches);
      const hasOutcome = "outcome" in payload;
      if ([hasValue, hasBranches, hasOutcome].filter(Boolean).length !== 1) {
        errors.push({ code: "slot.configured_shape", location: "$", message: "Configured slot needs exactly one of value, branches or outcome." });
      }
      if (hasValue) validateValue(platform, slot.value_schema, payload.value, "$.value", errors);
      if (hasOutcome) validateOutcome(platform, slot.value_schema, payload.outcome, "$.outcome", errors);
      if (hasBranches) {
        payload.branches.forEach((branch, index) => {
          if (!OBJECT(branch?.when)) {
            errors.push({ code: "branch.when", location: `$.branches[${index}]`, message: "Branch needs a typed condition." });
          }
          validateOutcome(platform, slot.value_schema, branch?.outcome, `$.branches[${index}].outcome`, errors);
        });
      }
      (payload.exceptions ?? []).forEach((exception, index) => {
        validateOutcome(platform, slot.value_schema, exception?.outcome, `$.exceptions[${index}].outcome`, errors);
      });
    }
  }
  return errors;
}
