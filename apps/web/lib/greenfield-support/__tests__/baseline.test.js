import { describe, expect, it } from "vitest";
import casesFile from "../../../../../supabase/eval/greenfield-support-cases.json";
import { createCapabilityRegistry } from "../capabilities";
import { createDemoDependencies } from "../demo-fixtures";

describe("greenfield representative contract baseline", () => {
  it("covers every fixed case through the general capability contracts", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({ ...dependencies, tenant: dependencies.tenant });
    const results = [];

    for (const testCase of casesFile.cases) {
      const expected = testCase.expected || {};
      const observedTools = [];
      for (const toolName of expected.knowledge_capabilities || []) {
        const query = expected.knowledge_query || testCase.customer_message;
        const result = await registry.execute(toolName, JSON.stringify({ query }));
        observedTools.push({ toolName, result });
      }
      for (const toolName of expected.live_capabilities || []) {
        let argumentsObject = { order_id: testCase.order_number };
        if (toolName === "get_tracking") {
          const order = await dependencies.commerce.getOrder(testCase.order_number);
          const trackingNumber = order?.fulfillments?.find((fulfillment) => fulfillment.trackingNumber)?.trackingNumber ?? "";
          argumentsObject = { tracking_number: trackingNumber };
        }
        const result = await registry.execute(toolName, JSON.stringify(argumentsObject));
        observedTools.push({ toolName, result });
      }
      if (expected.proposed_action) {
        const args = expected.proposed_action === "create_return"
          ? { order_id: testCase.order_number, item_ids: ["line-10234"], reason: "Customer request" }
          : expected.proposed_action === "update_address"
            ? { order_id: testCase.order_number, address: "New address supplied by customer", reason: "Customer request" }
            : expected.proposed_action === "send_replacement"
              ? { order_id: testCase.order_number, item_id: "line-10234", reason: "Defect" }
              : expected.proposed_action === "create_refund"
                ? { order_id: testCase.order_number, amount: "", reason: "Customer request" }
                : { order_id: testCase.order_number, reason: "Customer request" };
        const result = await registry.execute(expected.proposed_action, JSON.stringify(args));
        observedTools.push({ toolName: expected.proposed_action, result });
      }
      const errors = observedTools.filter(({ result }) => result.status === "error" || result.status === "invalid_arguments");
      const expectedTypes = expected.knowledge_types || [];
      const knowledgeMatched = expectedTypes.every((type) => observedTools.some(({ result }) => JSON.stringify(result).includes(`"knowledge_type":"${type}"`)));
      const proposalMatched = !expected.proposed_action || observedTools.some(({ result }) => result.status === "proposed" && result.proposedAction.action === expected.proposed_action);
      const responseOnlyMatched = !expected.response_only || observedTools.length === 0;
      results.push({ id: testCase.external_id, passed: errors.length === 0 && knowledgeMatched && proposalMatched && responseOnlyMatched });
    }

    expect(results).toHaveLength(casesFile.cases.length);
    expect(results.filter((result) => result.passed)).toHaveLength(casesFile.cases.length);
  });
});
