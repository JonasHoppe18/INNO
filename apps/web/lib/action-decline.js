export const ACTION_DECLINE_REASONS = Object.freeze([
  {
    value: "wrong_action",
    label: "Wrong action",
    description: "Sona should answer the request without this action.",
    noteRequired: false,
  },
  {
    value: "missing_information",
    label: "Missing information",
    description: "The customer needs to provide something before we can act.",
    noteRequired: true,
  },
  {
    value: "policy_not_allowed",
    label: "Not allowed by policy",
    description: "A verified store rule prevents this action.",
    noteRequired: true,
  },
  {
    value: "order_state_blocked",
    label: "Order state prevents it",
    description: "The current order status makes the action impossible.",
    noteRequired: true,
  },
  {
    value: "other",
    label: "Another reason",
    description: "Give Sona the context it needs to draft the alternative.",
    noteRequired: true,
  },
]);

const ACTION_DECLINE_REASON_CODES = new Set(
  ACTION_DECLINE_REASONS.map((reason) => reason.value)
);

export function normalizeActionDeclineInput(input = {}) {
  const candidate = String(input?.decisionReasonCode || input?.reasonCode || "").trim();
  const decisionReasonCode = ACTION_DECLINE_REASON_CODES.has(candidate)
    ? candidate
    : "other";
  const decisionReason = String(input?.decisionReason || input?.reason || "")
    .trim()
    .slice(0, 800);
  return { decisionReasonCode, decisionReason };
}

export function actionDeclineReasonNeedsNote(reasonCode = "") {
  return ACTION_DECLINE_REASONS.find((reason) => reason.value === reasonCode)?.noteRequired !== false;
}
