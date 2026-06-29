import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildSafetyFromGenerateDraftV2Response,
  generateDraftV2,
} from "../apps/web/lib/server/eval-runner.js";

const rawSafetyResponse = {
  draft_text: "Hi, I need a human to review this before sending.",
  proposed_actions: [],
  routing_hint: "review",
  block_send_recommended: true,
  live_fact_action_claim_check: {
    checked: true,
    compliant: false,
    requires_review: true,
    violations: [{ type: "unsupported_refund_status", text: "I've refunded it." }],
  },
  unsupported_commitment_check: {
    checked: true,
    compliant: true,
    requires_review: false,
    violations: [],
  },
  unsupported_assumption_check: {
    checked: true,
    compliant: true,
    requires_review: false,
    violations: [],
  },
  unsupported_custom_check: {
    checked: true,
    compliant: false,
    requires_review: true,
    violations: [{ type: "custom" }],
  },
  provenance: {
    guardrails: [
      { id: "live_fact_action_claim_check", status: "review" },
    ],
    chunks: [{ id: "not-persisted-here" }],
  },
  generation_id: "gen-1",
  intent: "refund",
};

test("buildSafetyFromGenerateDraftV2Response preserves safety provenance", () => {
  const safety = buildSafetyFromGenerateDraftV2Response(rawSafetyResponse);

  assert.equal(safety.routing_hint, "review");
  assert.equal(safety.block_send_recommended, true);
  assert.equal(safety.live_fact_action_claim_check.compliant, false);
  assert.deepEqual(safety.live_fact_action_claim_check.violations, [
    { type: "unsupported_refund_status", text: "I've refunded it." },
  ]);
  assert.equal(safety.unsupported_commitment_check.compliant, true);
  assert.equal(safety.unsupported_assumption_check.compliant, true);
  assert.equal(safety.unsupported_custom_check.compliant, false);
  assert.deepEqual(safety.guardrails, [
    { id: "live_fact_action_claim_check", status: "review" },
  ]);
});

test("generateDraftV2 normalization preserves safety object and top-level fields", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify(rawSafetyResponse),
  });

  try {
    const gen = await generateDraftV2("shop-1", "subject", "body");

    assert.equal(gen.routingHint, "review");
    assert.equal(gen.routing_hint, "review");
    assert.equal(gen.blockSendRecommended, true);
    assert.equal(gen.block_send_recommended, true);
    assert.equal(gen.safety.routing_hint, "review");
    assert.equal(gen.safety.block_send_recommended, true);
    assert.equal(gen.safety.live_fact_action_claim_check.compliant, false);
    assert.deepEqual(gen.safety.live_fact_action_claim_check.violations, [
      { type: "unsupported_refund_status", text: "I've refunded it." },
    ]);
    assert.equal(gen.safety.unsupported_commitment_check.compliant, true);
    assert.equal(gen.safety.unsupported_assumption_check.compliant, true);
    assert.deepEqual(gen.safety.guardrails, [
      { id: "live_fact_action_claim_check", status: "review" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
