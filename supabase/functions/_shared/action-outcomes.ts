export const ACTION_OUTCOMES = [
  "executed",
  "prepared",
  "declined",
  "blocked",
  "failed",
  "simulated",
] as const;

export type ActionOutcome = (typeof ACTION_OUTCOMES)[number];

export function normalizeActionOutcome(value: unknown): ActionOutcome {
  const normalized = String(value || "").trim().toLowerCase();
  if (
    normalized === "prepared" ||
    normalized === "instructions_ready" ||
    normalized === "draft_ready"
  ) {
    return "prepared";
  }
  if (normalized === "declined" || normalized === "denied" || normalized === "rejected") {
    return "declined";
  }
  if (normalized === "blocked") return "blocked";
  if (normalized === "failed" || normalized === "error") return "failed";
  if (
    normalized === "simulated" ||
    normalized === "approved_test_mode" ||
    normalized === "test_mode"
  ) {
    return "simulated";
  }
  return "executed";
}

export function isExecutedActionResult(
  actionResult: Record<string, unknown> | null | undefined,
): actionResult is Record<string, unknown> {
  return Boolean(actionResult) &&
    normalizeActionOutcome(actionResult?.outcome) === "executed";
}

export function actionOutcomeRequiresReview(
  actionResult: Record<string, unknown> | null | undefined,
): boolean {
  return Boolean(actionResult) && !isExecutedActionResult(actionResult);
}
