import {
  actionOutcomeRequiresReview,
  isExecutedActionResult,
  normalizeActionOutcome,
} from "./action-outcomes.ts";

Deno.test("action outcomes default legacy post-action results to executed", () => {
  if (normalizeActionOutcome(undefined) !== "executed") {
    throw new Error("Legacy action results must remain executed by default");
  }
  if (!isExecutedActionResult({ action_type: "cancel_order" })) {
    throw new Error("Legacy action result should be execution-confirmed");
  }
});

Deno.test("declined and simulated outcomes never count as executed", () => {
  for (const outcome of ["declined", "denied", "approved_test_mode", "simulated"]) {
    const result = { action_type: "refund_order", outcome };
    if (isExecutedActionResult(result)) {
      throw new Error(`${outcome} must not authorize a completed-action claim`);
    }
    if (!actionOutcomeRequiresReview(result)) {
      throw new Error(`${outcome} must be routed to review`);
    }
  }
});

Deno.test("prepared, blocked and failed outcomes are normalized and reviewed", () => {
  for (const outcome of ["prepared", "instructions_ready", "blocked", "failed", "error"]) {
    const normalized = normalizeActionOutcome(outcome);
    if (!new Set(["prepared", "blocked", "failed"]).has(normalized)) {
      throw new Error(`Unexpected normalized outcome: ${normalized}`);
    }
    if (!actionOutcomeRequiresReview({ action_type: "send_return_instructions", outcome })) {
      throw new Error(`${outcome} must be reviewed`);
    }
  }
});
