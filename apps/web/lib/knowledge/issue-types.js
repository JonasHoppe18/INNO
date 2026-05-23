// Canonical issue_type vocabulary used by both the knowledge UI (snippet
// tagging) and the AI pipeline (retriever metadata filter + scoring boost).
//
// IMPORTANT: keep this list in sync with `extractIssueTerms` and
// `INTENT_TO_ISSUE_TYPES` in supabase/functions/generate-draft-v2/stages/retriever.ts
// — if these drift, manual tags on snippets stop matching what the retriever
// searches for and the boost goes silently dead.

export const ISSUE_TYPES = [
  { value: "pairing", label: "Pairing", group: "Setup" },
  { value: "connectivity", label: "Connectivity", group: "Setup" },
  { value: "firmware", label: "Firmware", group: "Setup" },
  { value: "factory_reset", label: "Factory reset", group: "Setup" },
  { value: "app", label: "App", group: "Setup" },
  { value: "audio", label: "Audio", group: "Hardware" },
  { value: "microphone", label: "Microphone", group: "Hardware" },
  { value: "battery", label: "Battery", group: "Hardware" },
  { value: "ear_pads", label: "Ear pads", group: "Hardware" },
  { value: "physical_damage", label: "Physical damage", group: "Hardware" },
  { value: "product_specs", label: "Product specs", group: "Product" },
  { value: "tracking", label: "Tracking", group: "Order" },
  { value: "shipping", label: "Shipping", group: "Order" },
  { value: "return", label: "Return", group: "Order" },
  { value: "refund", label: "Refund", group: "Order" },
  { value: "general", label: "General", group: "Other" },
];

export const ISSUE_TYPE_VALUES = ISSUE_TYPES.map((t) => t.value);

export const ISSUE_TYPE_LABEL_MAP = Object.fromEntries(
  ISSUE_TYPES.map((t) => [t.value, t.label])
);

export const ISSUE_TYPE_GROUPS = ISSUE_TYPES.reduce((acc, t) => {
  if (!acc[t.group]) acc[t.group] = [];
  acc[t.group].push(t);
  return acc;
}, {});
