import { describe, expect, it } from "vitest";
import {
  normalizeMerchantPolicyAttribution,
  validateStructuredResponse,
  renderResponseSegments,
} from "../response-contract";
import { GREENFIELD_TOOL_DEFINITIONS } from "../tool-contracts";
const source =
  "Willow Store ordinary returns require unused items in sellable condition. The return window is 30 days. Shipping costs 49 DKK and is free from 599 DKK. The warranty lasts 2 years. Cancellation is only possible before fulfillment.";
function context(message = "What are the return conditions?") {
  const record = {
    resultId: "policy",
    toolName: "search_policy",
    result: {
      status: "ok",
      data: {
        results: [
          {
            title: "Willow Store policy",
            knowledge_type: "policy",
            authority: "authoritative",
            provenance: { source_label: "Willow Store" },
            structured_data: {
              policy_coverage: [
                { domain: "returns", facets: ["condition", "window"] },
              ],
            },
            evidence_sections: [{ content: source }],
          },
        ],
      },
    },
  };
  return {
    getResult: (id) => (id === "policy" ? record : null),
    getResults: () => [record],
    customerMessage: message,
    manifest: {
      readTools: ["search_policy"],
      proposalOnlyTools: [],
      configured: { knowledge: true, commerce: false, tracking: false },
    },
    definitions: GREENFIELD_TOOL_DEFINITIONS,
  };
}
function render(text, message) {
  const ctx = context(message);
  const result = validateStructuredResponse(
    {
      segments: [
        {
          type: "knowledge_guidance",
          text,
          basis: {
            result_id: "policy",
            field_paths: ["results.0.evidence_sections.0.content"],
          },
        },
      ],
    },
    ctx,
  );
  return { result, text: renderResponseSegments(result.approvedSegments, ctx) };
}
describe("merchant policy ownership", () => {
  it.each([
    [
      "Sona's ordinary return condition requires items to be unused and in sellable condition.",
      "What are the return conditions?",
    ],
    [
      "Sona’s standard returns policy allows a 30-day window.",
      "What is the return window?",
    ],
    [
      "Sona's shipping policy charges 49 DKK, with free shipping from 599 DKK.",
      "What does shipping cost?",
    ],
    ["Sona's warranty lasts 2 years.", "What is the warranty?"],
    ["Sona's prices include shipping at 49 DKK.", "What does shipping cost?"],
    [
      "Sona's operational rules allow cancellation only before fulfillment.",
      "What is the cancellation policy?",
    ],
  ])(
    "neutralizes agent ownership while retaining the supported answer: %s",
    (text, message) => {
      const rendered = render(text, message);
      expect(rendered.result.approvedSegments).toHaveLength(1);
      expect(rendered.text).not.toMatch(/\bSona(?:['’]s)?\b/i);
      expect(rendered.text).not.toBe("");
    },
  );
  it("allows verified merchant-name attribution", () => {
    const value =
      "Under Willow Store's ordinary return conditions, items must be unused and in sellable condition.";
    const result = render(value);
    expect(result.result.approvedSegments).toHaveLength(1);
    expect(result.text).toContain("Willow Store's");
    expect(result.text).toContain("unused");
  });
  it.each([
    "The return conditions require items to be unused and sellable.",
    "The store's return policy requires unused items in sellable condition.",
  ])("allows neutral ownership: %s", (text) => {
    const result = render(text);
    expect(result.result.approvedSegments).toHaveLength(1);
    expect(result.text).toContain("unused");
  });
  it("retains the used-item restriction, condition and window together", () => {
    const result = render(
      "A used item is not eligible under Sona's ordinary return conditions. Items must be unused and in sellable condition, within the 30-day return window.",
      "I used the throw. Can I return it?",
    );
    expect(result.text).toContain("not eligible");
    expect(result.text).toContain("unused");
    expect(result.text).toContain("sellable");
    expect(result.text).toContain("30");
    expect(result.text).not.toContain("Sona");
  });
  it("does not bless an unsupported policy value", () => {
    expect(
      render("Sona's ordinary return window is 90 days.").result
        .approvedSegments,
    ).toEqual([]);
  });
});

describe("ownership boundary coverage", () => {
  it.each([
    [
      "Under Sona’s ordinary return conditions, a used item is not eligible.",
      "Under the store's ordinary return conditions, a used item is not eligible.",
    ],
    [
      "Sona's 30-day return policy requires unused items.",
      "The store's 30-day return policy requires unused items.",
    ],
    [
      "Sonas returpolitik kræver ubrugte varer.",
      "butikkens returpolitik kræver ubrugte varer.",
    ],
    ["Sonas Garantie gilt 2 Jahre.", "Garantie des Shops gilt 2 Jahre."],
    [
      "The shipping policy of Sona charges 49 DKK.",
      "The shipping policy of the store charges 49 DKK.",
    ],
    [
      "Sona sets shipping prices at 49 DKK.",
      "The store sets shipping prices at 49 DKK.",
    ],
  ])("corrects ownership only: %s", (input, expected) =>
    expect(normalizeMerchantPolicyAttribution(input)).toBe(expected),
  );
  it("preserves paragraphs and every material number", () => {
    const input =
      "Sona's ordinary return conditions require unused/sellable items.\n\nThe window is 30 days.\nSona's shipping price is 49 DKK; free from 599 DKK.";
    const result = normalizeMerchantPolicyAttribution(input);
    expect(result.match(/\d+/g)).toEqual(input.match(/\d+/g));
    expect(result.split("\n").length).toBe(input.split("\n").length);
    expect(result).toContain("unused/sellable");
  });
  it("keeps the agent role and unrelated merchant names intact", () => {
    const value =
      "Sona is your support agent. Willow Store's return policy requires unused items. Sona can explain it.";
    expect(normalizeMerchantPolicyAttribution(value)).toBe(value);
  });
  it("normalization is idempotent", () => {
    const value =
      "Sona’s ordinary return conditions and Sona's shipping policy apply.";
    expect(
      normalizeMerchantPolicyAttribution(
        normalizeMerchantPolicyAttribution(value),
      ),
    ).toBe(normalizeMerchantPolicyAttribution(value));
  });
});

it("final segment rendering also guards limitation text", () => {
  const ctx = context("What is the warranty?");
  const text = renderResponseSegments(
    [
      {
        type: "limitation",
        text: "Sona's warranty lasts 2 years.",
        basis: { result_id: "policy", field_paths: ["data.results"] },
      },
    ],
    ctx,
  );
  expect(text).toContain("2 years");
  expect(text).not.toContain("Sona");
});

it.each([
  "Sona's damaged-item return policy",
  "Sona’s updated international shipping terms",
])("handles policy qualifiers without an adjective list: %s", (text) => {
  expect(normalizeMerchantPolicyAttribution(text)).not.toContain("Sona");
});
it.each([
  "Sona's helpful assistant explains the return policy.",
  "Sona Furniture's shipping policy applies.",
])("does not reassign agent roles or longer merchant names: %s", (text) => {
  expect(normalizeMerchantPolicyAttribution(text)).toBe(text);
});
import {
  ScriptedModel,
  assistantMessage,
  modelResponse,
} from "@openai/agents/testing";
import { runGreenfieldAgentWithAgentsSdk } from "../agents-sdk";
import { createDemoDependencies } from "../demo-fixtures";
import { InMemoryKnowledgeStore } from "../knowledge";
it("SDK attribution correction matches the neutral answer and preserves agent identity", async () => {
  const dependencies = await createDemoDependencies();
  const knowledge = new InMemoryKnowledgeStore();
  await knowledge.ingest(dependencies.tenant.workspaceId, {
    sourceKind: "return_policy",
    sourceId: "verified-return-policy",
    title: "Return conditions",
    content:
      "Ordinary return conditions require items to be unused and in sellable condition. The return window is 30 days.",
    authority: "authoritative",
    structuredData: {
      policy_coverage: [{ domain: "returns", facets: ["condition", "window"] }],
    },
  });
  const text =
    "A used item is not eligible under Sona's ordinary return conditions. Ordinary return conditions require items to be unused and in sellable condition. The return window is 30 days.";
  const run = async (answer) => {
    const model = new ScriptedModel([
      modelResponse([
        assistantMessage(
          JSON.stringify({
            segments: [
              {
                type: "knowledge_guidance",
                text: answer,
                basis: { result_id: "tool_result_1", field_paths: ["results"] },
              },
            ],
          }),
        ),
      ]),
    ]);
    const result = await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      message: "Can a used item qualify under the ordinary return conditions?",
      capabilities: { ...dependencies, knowledge },
      turnInterpreter: async () => ({ actions: [] }),
      model,
      signature: "/ Sona",
      enableDevDiagnostics: true,
    });
    model.assertComplete();
    return result;
  };
  const result = await run(text);
  const neutral = await run(text.replace("Sona's", "the store's"));
  expect(result.response).toBe(neutral.response);
  expect(result.response).toContain("not eligible");
  expect(result.response).toContain("30");
  expect(result.response).not.toMatch(/Sona['’]s/);
  expect(result.response).toContain("/ Sona");
  expect(result.trace.diagnostics.fallback_reason).toBe(null);
  expect(result.proposedActions).toEqual([]);
  expect(result.actionExecutions).toEqual([]);
});
