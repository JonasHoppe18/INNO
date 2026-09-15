import { assert, assertStringIncludes } from "jsr:@std/assert@1";
import { buildActionCapabilityBlock } from "./writer.ts";
import type { ActionProposal } from "./action-decision.ts";

// Observed live across two runs (2026-07-29): drafts promised work that never
// happened — "jeg igangsætter en ombytning", "jeg starter en
// ombytningsanmodning", "jeg går i gang med at annullere" — each time with no
// action created. Adding phrase patterns to the post-writer commitment check
// was defeated twice by paraphrase.
//
// The cause is upstream: with no proposals, the writer's action block was the
// empty string. Silence reads as permission, so the model invented a plausible
// process. These tests pin the negative capability statement that replaces it.

function proposal(type: string, requires_approval = true): ActionProposal {
  return {
    type,
    reason: "kunden bad om det",
    requires_approval,
  } as ActionProposal;
}

Deno.test("no proposals produces an explicit statement, never silence", () => {
  const block = buildActionCapabilityBlock([]);
  assert(block.trim().length > 0, "empty proposals must not yield an empty block");
});

Deno.test("no proposals forbids claiming work has been started", () => {
  const block = buildActionCapabilityBlock([]).toLowerCase();
  // The exact verbs the model reached for, run after run.
  for (const verb of ["igangsæt", "start", "opret", "går i gang"]) {
    assertStringIncludes(block, verb);
  }
});

Deno.test("undefined proposals behave like none", () => {
  assert(buildActionCapabilityBlock(undefined).trim().length > 0);
});

Deno.test("proposals are still listed with their reason", () => {
  const block = buildActionCapabilityBlock([proposal("cancel_order")]);
  assertStringIncludes(block, "cancel_order");
  assertStringIncludes(block, "kunden bad om det");
});

Deno.test("an approval-pending action must not be described as done", () => {
  const block = buildActionCapabilityBlock([proposal("cancel_order", true)]);
  assertStringIncludes(block, "godkendelse");
});

Deno.test("having one action does not license promising another", () => {
  // A cancel proposal must not become cover for promising an exchange — the
  // A5/B4 pair showed the model treating any action context as general licence.
  const block = buildActionCapabilityBlock([proposal("cancel_order")])
    .toLowerCase();
  assert(
    /kun de handlinger|ingen andre|ikke andre/.test(block),
    `block must confine the writer to the listed actions, got: ${block}`,
  );
});
