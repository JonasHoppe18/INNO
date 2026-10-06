// Returns authoring: source text -> typed candidate drafts + review questions.
//
// The model only reads the source and reports what it says, with verbatim
// evidence. Every typed payload is built here, deterministically. Anything the
// source leaves ambiguous becomes a review question for the merchant; it never
// becomes a published value.

export const RETURNS_EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["windows", "accepted", "start_method", "required_to_start", "return_shipping_payer", "tracked_shipping", "return_address", "refund_timing", "exchanges", "restocking_fee", "item_conditions"],
  properties: {
    windows: {
      type: "array",
      description: "Every return/cancellation window the source states.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["days", "counted_from", "kind", "evidence"],
        properties: {
          days: { type: "integer" },
          counted_from: { type: "string", enum: ["delivery", "order_date", "notification", "unknown"] },
          kind: { type: "string", enum: ["statutory_cancellation", "merchant_return", "unknown"] },
          evidence: { type: "string" },
        },
      },
    },
    accepted: { type: "string", enum: ["yes", "no", "unknown"] },
    start_method: { type: "string", enum: ["contact_support", "self_service_portal", "rma_request", "provider_portal", "in_store", "unknown"] },
    required_to_start: {
      type: "array",
      items: { type: "string", enum: ["reason", "name", "order_number", "contact", "photos", "other", "none"] },
    },
    return_shipping_payer: { type: "string", enum: ["customer", "merchant", "unknown"] },
    tracked_shipping: { type: "string", enum: ["required", "recommended", "not_mentioned"] },
    return_address: {
      type: "object",
      additionalProperties: false,
      required: ["present", "name", "line1", "postal_code", "city", "country", "evidence"],
      properties: {
        present: { type: "boolean" },
        name: { type: "string" },
        line1: { type: "string" },
        postal_code: { type: "string" },
        city: { type: "string" },
        country: { type: "string" },
        evidence: { type: "string" },
      },
    },
    refund_timing: {
      type: "object",
      additionalProperties: false,
      required: ["after_received", "after_proof_of_return", "days", "evidence"],
      properties: {
        after_received: { type: "boolean" },
        after_proof_of_return: { type: "boolean" },
        days: { type: "integer", description: "-1 when the source states no number of days" },
        evidence: { type: "string" },
      },
    },
    exchanges: { type: "string", enum: ["offered", "not_offered", "not_mentioned"] },
    restocking_fee: { type: "string", enum: ["none", "charged", "not_mentioned"] },
    item_conditions: {
      type: "array",
      items: { type: "string", enum: ["unused", "original_packaging", "tags_attached", "resaleable", "none"] },
    },
  },
};

export const RETURNS_EXTRACTION_INSTRUCTIONS = [
  "You read one merchant policy document and report only what it states about returns.",
  "Never infer, never merge different rules, and never use knowledge from outside the document.",
  "List every distinct return or cancellation window separately, each with its own verbatim evidence sentence.",
  "Use the 'unknown'/'not_mentioned' values whenever the document does not state something clearly.",
  "Evidence strings must be copied verbatim from the document.",
].join(" ");

const REQUIREMENT_FACTS = {
  reason: "return_subject.reason",
  name: "customer.name",
  order_number: "order.ref_resolution",
  contact: "interaction.channel",
  photos: "return_subject.defect_evidence_provided",
};

const ANCHOR_FACTS = {
  delivery: "line_item.delivered_at",
  order_date: "order.placed_at",
};

// Builds typed drafts and review questions. Nothing ambiguous becomes a value.
export function draftsFromExtraction(extraction, { unitIds, sourceId, policyId }) {
  const drafts = [];
  const questions = [];
  const provenance = [{ source_id: sourceId, role: "supports" }];
  const draft = (key, fields, evidence) => {
    if (!unitIds[key]) throw new Error(`No unit id reserved for ${key}.`);
    drafts.push({
      key,
      unit_id: unitIds[key],
      domain_key: "returns",
      audience: "customer",
      scope: {},
      origin_policy_id: policyId,
      evidence: evidence ? [evidence] : [],
      ...fields,
      payload: { ...fields.payload, provenance },
    });
  };
  const ask = (code, question, options, evidence) => questions.push({ code, question, options, evidence: evidence ?? null });

  // Eligibility
  if (extraction.accepted === "yes") {
    draft("accepted", { kind: "slot_rule", family_key: "ELIG", slot_key: "returns.ELIG.accepted", payload: { state: "configured", value: { accepted: true } } });
  } else if (extraction.accepted === "no") {
    draft("accepted", { kind: "slot_rule", family_key: "ELIG", slot_key: "returns.ELIG.accepted", payload: { state: "configured", value: { accepted: false, reason_code: "other_typed" } } });
  } else {
    ask("accepted_unknown", "Does this policy accept returns at all?", ["yes", "no"]);
  }

  // Window: more than one stated window is a merchant decision, never a guess.
  const windows = extraction.windows ?? [];
  if (windows.length === 0) {
    ask("window_missing", "How many days does a customer have to return an item, and counted from what?", ["state days + anchor"]);
  } else if (windows.length > 1) {
    ask(
      "window_conflict",
      `The source states ${windows.length} different windows. Which one applies to an ordinary return request?`,
      windows.map((window) => `${window.days} days from ${window.counted_from} (${window.kind})`),
      windows.map((window) => window.evidence).join(" | "),
    );
  } else if (windows[0].counted_from === "unknown") {
    ask("window_anchor_unknown", `The source says ${windows[0].days} days but not from when. What is it counted from?`, ["delivery", "order date"], windows[0].evidence);
  } else {
    draft("window", {
      kind: "slot_rule", family_key: "ELIG", slot_key: "returns.ELIG.window",
      payload: { state: "configured", value: { duration: { amount: windows[0].days, unit: "calendar_day" }, anchor: { fact: ANCHOR_FACTS[windows[0].counted_from] } } },
    }, windows[0].evidence);
  }

  // Procedure
  if (extraction.start_method === "unknown") {
    ask("method_unknown", "How should a customer start a return?", ["contact support", "self-service portal", "RMA request", "provider portal", "in store"]);
  } else {
    const requirements = [];
    for (const requirement of extraction.required_to_start ?? []) {
      if (requirement === "none") continue;
      const fact = REQUIREMENT_FACTS[requirement];
      if (!fact) {
        ask("requirement_unmapped", `The source requires "${requirement}" to start a return, which has no typed fact yet. Should it block the return?`, ["yes", "no"]);
        continue;
      }
      requirements.push(fact === "interaction.channel"
        ? { stage: "to_initiate", fact, satisfied_when: { op: "in", value: ["email", "chat", "contact_form"] } }
        : fact === "order.ref_resolution"
          ? { stage: "to_initiate", fact, satisfied_when: { op: "eq", value: "resolved" } }
          : { stage: "to_initiate", fact });
    }
    draft("method", {
      kind: "slot_rule", family_key: "PROC", slot_key: "returns.PROC.method",
      payload: { state: "configured", value: { method: extraction.start_method }, requirements },
    });
  }

  // Logistics
  if (extraction.return_shipping_payer === "unknown") {
    ask("payer_unknown", "Who pays the return shipping?", ["customer", "merchant"]);
  } else {
    draft("payer", {
      kind: "slot_rule", family_key: "LOG", slot_key: "returns.LOG.payer",
      payload: {
        state: "configured",
        value: extraction.return_shipping_payer === "customer"
          ? { payer: "customer", mechanism: "customer_arranges" }
          : { payer: "merchant", mechanism: "prepaid_by_merchant" },
      },
    });
  }

  if (extraction.tracked_shipping === "required") {
    draft("shipping", {
      kind: "procedure", family_key: "LOG",
      payload: { applies_to: "returns.return_shipment", shipping: { tracked: "required" }, texts: [{ role: "steps", audience: "customer", locale: "en", text: "Send the return with a tracked shipping service." }] },
    });
  } else if (extraction.tracked_shipping === "recommended") {
    // A recommendation is not a decision: it stays non-decision guidance.
    draft("shipping", {
      kind: "guidance", family_key: "LOG",
      payload: { applies_to: "returns.return_shipment", texts: [{ role: "explanation", audience: "customer", locale: "en", text: "Using a tracked shipping service is recommended so the return can be followed." }] },
    });
  }

  if (extraction.return_address?.present) {
    const address = extraction.return_address;
    draft("address", {
      kind: "value", family_key: null,
      payload: { value_type: "postal_address", address: { name: address.name, line1: address.line1, postal_code: address.postal_code, city: address.city, country: address.country } },
    }, address.evidence);
    draft("destination", {
      kind: "slot_rule", family_key: "LOG", slot_key: "returns.LOG.destination",
      payload: { state: "configured", value: { disclosure: "disclosed", ref: unitIds.address } },
    });
  } else {
    ask("destination_unknown", "Where should customers send returns?", ["a postal address", "through the return method/label", "not applicable"]);
  }

  // Money
  const timing = extraction.refund_timing ?? {};
  const after = [];
  if (timing.after_received) after.push("return_shipment.received_at");
  if (timing.after_proof_of_return) after.push("return_shipment.inspection_completed_at");
  if (after.length) {
    draft("refund_expectation", {
      kind: "expectation", family_key: null,
      payload: { event: "refund_initiated", after, duration: timing.days > 0 ? { amount: timing.days, unit: "calendar_day" } : null },
    }, timing.evidence);
    draft("timing", {
      kind: "slot_rule", family_key: "MONEY", slot_key: "returns.MONEY.timing",
      payload: { state: "configured", value: { ref: unitIds.refund_expectation } },
    });
  } else {
    ask("refund_timing_unknown", "When is the refund issued?", ["after the return is received", "after proof of return", "a fixed number of days"]);
  }

  if (extraction.restocking_fee === "none") {
    draft("restocking_none", { kind: "slot_rule", family_key: "MONEY", slot_key: "returns.MONEY.restocking_fee", payload: { state: "explicitly_none" } });
  } else if (extraction.restocking_fee === "charged") {
    ask("restocking_amount", "What is the restocking fee (amount or percentage)?", ["amount", "percent"]);
  }

  if (extraction.exchanges === "offered") {
    draft("exchange", { kind: "slot_rule", family_key: "EXCH", slot_key: "returns.EXCH.offered", payload: { state: "configured", value: { offered: true } } });
  } else if (extraction.exchanges === "not_offered") {
    draft("exchange", { kind: "slot_rule", family_key: "EXCH", slot_key: "returns.EXCH.offered", payload: { state: "explicitly_none" } });
  } else {
    ask("exchanges_unknown", "Do you offer exchanges instead of returns?", ["yes", "no"]);
  }

  const conditions = (extraction.item_conditions ?? []).filter((condition) => condition !== "none");
  if (conditions.length) {
    draft("item_conditions", {
      kind: "slot_rule", family_key: "ELIG", slot_key: "returns.ELIG.item_conditions",
      payload: { state: "configured", value: { conditions: conditions.map((condition) => `return_subject.${condition}`) } },
    });
  }

  return { drafts, questions };
}
