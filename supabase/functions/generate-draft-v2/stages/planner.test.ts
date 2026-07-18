import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  applyDeterministicIntentPrecedence,
  explicitIntentFromMessage,
  type Plan,
  runPlanner,
} from "./planner.ts";
import type { CaseState } from "./case-state-updater.ts";

// runPlanner calls a live LLM (gpt-4o-mini) to classify resolution_stage, so
// its actual classification accuracy on real messages cannot be asserted
// deterministically offline. These tests instead verify (a) the plumbing
// around resolution_stage is safe (fallback never guesses "clarify_symptom",
// language override still works, stubbed plans round-trip correctly) and
// (b) the prompt text driving the real decision still contains the
// clarify_symptom rule and its thread-context check, so the rule can't be
// silently deleted without a test failing.

function caseState(overrides: Partial<CaseState> = {}): CaseState {
  return {
    intents: [],
    entities: { order_numbers: [], customer_email: "", products_mentioned: [] },
    decisions_made: [],
    open_questions: [],
    pending_asks: [],
    language: "da",
    last_updated_msg_id: "",
    ...overrides,
  };
}

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    primary_intent: "complaint",
    resolution_stage: "troubleshoot_first",
    sub_queries: ["product issue"],
    required_facts: ["order_state"],
    skills_to_consider: ["get_order"],
    confidence: 0.6,
    language: "en",
    ...overrides,
  };
}

Deno.test("explicit refund and exchange asks outrank complaint wording", () => {
  assertEquals(
    explicitIntentFromMessage(
      "The battery only lasts 8 hours. I want a refund or my money back.",
    ),
    "refund",
  );
  assertEquals(
    explicitIntentFromMessage(
      "The plastic cracked while fitting it. I would like a replacement headset.",
    ),
    "exchange",
  );
});

Deno.test("accessory purchase and compatibility questions stay informational", () => {
  assertEquals(
    explicitIntentFromMessage("I lost my USB dongle. Can I buy a new one?"),
    "product_question",
  );
  assertEquals(
    explicitIntentFromMessage(
      "Are the replacement ear pads on your site compatible with my headset?",
    ),
    "product_question",
  );
  assertEquals(
    explicitIntentFromMessage(
      "Jeg har mistet min dongle. Er der mulighed for at købe en ny?",
    ),
    "product_question",
  );
});

Deno.test("product-question override removes order actions and uses info-only stage", () => {
  const result = applyDeterministicIntentPrecedence(
    plan(),
    "Are these ear pads compatible with my headset?",
  );
  assertEquals(result.primary_intent, "product_question");
  assertEquals(result.resolution_stage, "info_only");
  assertEquals(result.required_facts, ["product_specs"]);
  assertEquals(result.skills_to_consider, []);
});

Deno.test("invoice wording is never turned into refund", () => {
  assertEquals(
    explicitIntentFromMessage(
      "Can you resend my invoice and order confirmation?",
    ),
    null,
  );
});

Deno.test("negated outcomes are left to the model instead of forcing an action", () => {
  assertEquals(
    explicitIntentFromMessage(
      "I do not want a refund; I only need help pairing it.",
    ),
    null,
  );
  assertEquals(
    explicitIntentFromMessage("Please don't cancel my order — where is it?"),
    null,
  );
  assertEquals(
    explicitIntentFromMessage(
      "I don't want to return it; can you help me fix it?",
    ),
    null,
  );
});

Deno.test("historical cancellation complaints are not mistaken for a new cancel request", () => {
  assertEquals(
    explicitIntentFromMessage(
      "I reached out to cancel, but support could not cancel it. Why wasn't I able to cancel? Now I have to pay to send it back.",
    ),
    null,
  );
});

Deno.test("a reimbursement question conditional on return stays a return request", () => {
  assertEquals(
    explicitIntentFromMessage(
      "If I return the opened headset, are you able to reimburse the payment?",
    ),
    "return",
  );
});

Deno.test("delivered-but-missing parcels stay tracking cases", () => {
  assertEquals(
    explicitIntentFromMessage(
      "My package is claimed to be delivered, but it isn't here. The photo shows the wrong location. Where is it?",
    ),
    "tracking",
  );
  assertEquals(
    explicitIntentFromMessage(
      "Min pakke står som leveret, men jeg har ikke modtaget den. Hvor er den?",
    ),
    "tracking",
  );
});

Deno.test("unavailable checkout countries use the generic commerce intent", () => {
  assertEquals(
    explicitIntentFromMessage(
      "Australia is not an option under Country/Region at checkout.",
    ),
    "other",
  );
  const result = applyDeterministicIntentPrecedence(
    plan({ primary_intent: "product_question" }),
    "I cannot select Denmark as delivery country at checkout.",
  );
  assertEquals(result.primary_intent, "other");
  assertEquals(result.resolution_stage, "info_only");
  assertEquals(result.skills_to_consider, []);
});

Deno.test("runPlanner falls back to info_only (never clarify_symptom) when the LLM call fails", async () => {
  const plan = await runPlanner(
    {
      caseState: caseState(),
      latestMessage: { clean_body_text: "Det virker ikke" },
      shop: { name: "Test Shop" },
    },
    { callJson: () => Promise.reject(new Error("network unavailable")) },
  );

  assertEquals(plan.resolution_stage, "info_only");
  assertEquals(plan.sub_queries, []);
});

Deno.test("runPlanner passes a stubbed clarify_symptom plan through unchanged", async () => {
  const plan = await runPlanner(
    {
      caseState: caseState(),
      latestMessage: { clean_body_text: "Det virker ikke" },
      shop: { name: "Test Shop" },
    },
    {
      callJson: ((_args: unknown) =>
        Promise.resolve({
          primary_intent: "complaint",
          resolution_stage: "clarify_symptom",
          sub_queries: [],
          required_facts: [],
          skills_to_consider: [],
          confidence: 0.6,
          language: "da",
        })) as never,
    },
  );

  assertEquals(plan.primary_intent, "complaint");
  assertEquals(plan.resolution_stage, "clarify_symptom");
  assertEquals(plan.sub_queries, []);
  assertEquals(plan.required_facts, []);
  assertEquals(plan.skills_to_consider, []);
});

Deno.test("runPlanner still applies deterministic language override on top of a stubbed clarify_symptom plan", async () => {
  const plan = await runPlanner(
    {
      caseState: caseState({ language: "en" }),
      latestMessage: { clean_body_text: "It doesn't work" },
      shop: { name: "Test Shop" },
    },
    {
      callJson: ((_args: unknown) =>
        Promise.resolve({
          primary_intent: "complaint",
          resolution_stage: "clarify_symptom",
          sub_queries: [],
          required_facts: [],
          skills_to_consider: [],
          confidence: 0.6,
          language: "da",
        })) as never,
    },
  );

  assertEquals(plan.resolution_stage, "clarify_symptom");
  assertEquals(plan.language, "en");
});

// Multi-turn regression: the planner cannot be forced to actually choose the
// right stage offline (that judgment is made by the live LLM), but we can
// prove the thread context it needs for that judgment reaches the prompt —
// a vague follow-up ("still doesn't work") in a thread whose issue is already
// known must have that context available to the model, not just the bare
// vague message.
Deno.test("runPlanner forwards known thread context (open_questions/products/order) into the prompt for vague follow-ups", async () => {
  let capturedUserPrompt = "";
  await runPlanner(
    {
      caseState: caseState({
        entities: {
          order_numbers: ["#1234"],
          customer_email: "kunde@example.com",
          products_mentioned: ["A-Spire Wireless"],
        },
        open_questions: ["mikrofonen lyder robotagtig på Discord"],
        pending_asks: [
          "bad om et par skærmbilleder af Discord-indstillingerne",
        ],
      }),
      latestMessage: { clean_body_text: "Det virker stadig ikke" },
      shop: { name: "Test Shop" },
    },
    {
      callJson: ((args: { userPrompt: string }) => {
        capturedUserPrompt = args.userPrompt;
        return Promise.resolve({
          primary_intent: "complaint",
          resolution_stage: "troubleshoot_first",
          sub_queries: ["A-Spire Wireless mikrofon robotagtig Discord"],
          required_facts: ["order_state"],
          skills_to_consider: [],
          confidence: 0.7,
          language: "da",
        });
      }) as never,
    },
  );

  assert(
    capturedUserPrompt.includes("A-Spire Wireless"),
    "prompt did not forward the product already established in the thread",
  );
  assert(
    capturedUserPrompt.includes("mikrofonen lyder robotagtig på Discord"),
    "prompt did not forward the unresolved issue already established in the thread",
  );
});

// Prompt-text regression: guards the actual decision rule (the real
// classification logic lives in the LLM prompt, not in testable code).
Deno.test("planner.ts prompt still defines the clarify_symptom stage and its thread-context check", async () => {
  const source = await Deno.readTextFile(
    new URL("./planner.ts", import.meta.url),
  );

  assert(
    source.includes('"clarify_symptom"'),
    "clarify_symptom missing from source",
  );
  assert(
    source.includes("clarify_symptom|troubleshoot_first"),
    "clarify_symptom missing from schema description order",
  );
  assert(
    source.includes("det virker ikke") && source.includes("it doesn't work"),
    "clarify_symptom rule lost its trigger examples",
  );
  assert(
    source.includes("problem med min ordre"),
    "clarify_symptom rule lost the vague order-problem example",
  );
  assert(
    source.toLowerCase().includes("thread context") &&
      source.includes("does NOT already establish"),
    "clarify_symptom rule lost its thread-context-first check",
  );
  assert(
    source.includes("NEVER give troubleshooting steps") ||
      source.includes("NEVER give troubleshooting"),
    "clarify_symptom rule lost the no-troubleshooting constraint",
  );
  assert(
    source.includes(
      'When resolution_stage = "clarify_symptom": sub_queries MUST be empty',
    ),
    "clarify_symptom lost its empty-sub_queries safeguard (would let unrelated knowledge leak into the writer)",
  );
});
