import { describe, expect, it } from "vitest";
import { ScriptedModel, assistantMessage, functionCall, modelResponse } from "@openai/agents/testing";
import { runGreenfieldAgentWithAgentsSdk } from "../agents-sdk";
import { PlaygroundDryRunExecutor } from "../action-executor";
import { createDemoDependencies } from "../demo-fixtures";
import { InMemoryCommerceProvider } from "../providers";

function structured(...segments) {
  return JSON.stringify({ segments });
}

describe("greenfield OpenAI Agents SDK runtime", () => {
  it("records a minimal direct-answer model-to-contract diagnostic", async () => {
    const dependencies = await createDemoDependencies();
    const model = new ScriptedModel([
      modelResponse([assistantMessage(structured({
        type: "knowledge_guidance",
        text: "Refunds are normally processed within 5 business days after approval.",
        basis: { result_id: "tool_result_1", field_paths: ["results"] },
      }))]),
    ]);

    const result = await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      message: "When will I get my refund?",
      model,
      enableDevDiagnostics: true,
      capabilities: dependencies,
    });

    model.assertComplete();
    expect(result.trace.diagnostics).toMatchObject({
      model_response_mode: "answered",
      completeness_check_entered: true,
      recovery_result: "skipped",
      final_composition_source: "model",
      model_output: {
        structured_parse_failed: false,
        knowledge_guidance_exists: true,
        knowledge_guidance_has_answer_text: true,
        knowledge_guidance_basis_refs: 1,
      },
    });
  });

  it("records when usable policy evidence recovers a model fallback", async () => {
    const dependencies = await createDemoDependencies();
    const model = new ScriptedModel([
      modelResponse([assistantMessage(structured({
        type: "knowledge_guidance",
        text: "I’m sorry, but I couldn’t safely complete that lookup right now.",
        basis: { result_id: "tool_result_1", field_paths: ["results"] },
      }))]),
    ]);

    const result = await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      message: "When will I get my refund?",
      model,
      enableDevDiagnostics: true,
      capabilities: dependencies,
    });

    model.assertComplete();
    expect(result.trace.diagnostics).toMatchObject({
      model_response_mode: "fallback",
      completeness_check_entered: true,
      recovery_attempted: true,
      recovery_result: "recovered",
      final_composition_source: "recovered_evidence",
      model_output: {
        fallback_like_content: true,
      },
    });
    expect(result.response).toContain("5 business days");
  });

  it("lets Greenfield validate contract-invalid JSON after SDK parsing", async () => {
    const dependencies = await createDemoDependencies();
    const model = new ScriptedModel([
      modelResponse([assistantMessage(JSON.stringify({ segments: [{ kind: "FACT" }] }))]),
    ]);

    const result = await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      message: "When will I get my refund?",
      model,
      enableDevDiagnostics: true,
      capabilities: dependencies,
    });

    model.assertComplete();
    expect(result.trace.events.some((event) => event.type === "error" && event.data.code === "agent_failed")).toBe(false);
    expect(result.trace.events.some((event) => event.type === "model_response")).toBe(true);
    expect(result.trace.diagnostics).toMatchObject({
      validation: {
        schema_valid: false,
        all_valid: false,
        approved_count: 1,
      },
      completeness_check_entered: true,
      recovery_result: "recovered",
      final_composition_source: "recovered_evidence",
    });
    expect(result.response).toContain("5 business days");
    expect(model.firstCall.request.outputType).toMatchObject({
      type: "json_schema",
      name: "greenfield_model_output",
      strict: false,
      schema: {
        type: "object",
        required: ["segments"],
        additionalProperties: false,
      },
    });
    const segmentSchemas = model.firstCall.request.outputType.schema.properties.segments.items.oneOf;
    expect(segmentSchemas.map((schema) => schema.properties.type.const)).toEqual([
      "fact",
      "question",
      "limitation",
      "action_offer",
      "knowledge_guidance",
      "procedure_guidance",
      "acknowledgement",
    ]);
    expect(model.firstCall.request.tools.filter((item) => item.type === "function").every((item) => item.strict === true)).toBe(true);
  });

  it("keeps invalid evidence references rejected inside the Greenfield contract", async () => {
    const dependencies = await createDemoDependencies();
    const model = new ScriptedModel([
      modelResponse([assistantMessage(structured({
        type: "knowledge_guidance",
        text: "Returns are accepted within 30 days of delivery.",
        basis: { result_id: "missing-result", field_paths: ["results"] },
      }))]),
    ]);

    const result = await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      message: "What is your return window?",
      model,
      enableDevDiagnostics: true,
      capabilities: dependencies,
    });

    model.assertComplete();
    expect(result.trace.events.some((event) => event.type === "error" && event.data.code === "agent_failed")).toBe(false);
    expect(result.trace.diagnostics.validation.rejected_segments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        issues: expect.arrayContaining([expect.objectContaining({ code: "unknown_result_id" })]),
      }),
    ]));
    expect(result.trace.diagnostics.completeness_check_entered).toBe(true);
  });

  it("keeps malformed or unrecoverable output on the safe fallback path", async () => {
    const dependencies = await createDemoDependencies();
    const model = new ScriptedModel([
      modelResponse([assistantMessage("not valid JSON")]),
    ]);

    const result = await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      message: "Can you help me?",
      model,
      enableDevDiagnostics: true,
      capabilities: dependencies,
    });

    model.assertComplete();
    expect(result.response).toBe("I’m sorry, but I couldn’t safely complete that lookup right now. Could you try again in a moment?");
    expect(result.trace.events).toContainEqual(expect.objectContaining({
      type: "error",
      data: expect.objectContaining({ code: "agent_failed" }),
    }));
    expect(result.trace.diagnostics).toMatchObject({
      validation: null,
      completeness_check_entered: false,
      fallback_reason: "agent_error",
    });
  });

  it("does not let an approved order clarification hide a resolvable general timing answer", async () => {
    const dependencies = await createDemoDependencies();
    const model = new ScriptedModel([
      modelResponse([assistantMessage(structured({
        type: "question",
        purpose: "enable_capability",
        text: null,
        capability: "get_order",
        missing_arguments: ["order_id"],
      }))]),
    ]);

    const result = await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      message: "When will I get my refund?",
      model,
      enableDevDiagnostics: true,
      capabilities: dependencies,
    });

    model.assertComplete();
    expect(result.response).toMatch(/refund/i);
    expect(result.response).not.toContain("order number");
    expect(result.trace.diagnostics).toMatchObject({
      intent_resolved_by_approved_segment: false,
      recovery_attempted: true,
      recovery_result: "recovered",
      final_composition_source: "recovered_evidence",
    });
  });

  it("does not emit the new diagnostics without explicit DEV Playground opt-in", async () => {
    const dependencies = await createDemoDependencies();
    const model = new ScriptedModel([
      modelResponse([assistantMessage(structured({ type: "acknowledgement", kind: "thanks" }))]),
    ]);

    const result = await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      message: "Thanks, that solved it.",
      model,
      capabilities: dependencies,
    });

    model.assertComplete();
    expect(result.trace).not.toHaveProperty("diagnostics");
    expect(result.trace.events.find((event) => event.type === "model_response")?.data).not.toHaveProperty("model_output");
    expect(result.trace.events.find((event) => event.type === "final_response")?.data.validation).not.toHaveProperty("completeness");
  });

  it("greets from the verified commerce profile when the message has no sign-off", async () => {
    const dependencies = await createDemoDependencies();
    const commerce = new InMemoryCommerceProvider({
      customer: { email: dependencies.tenant.customerEmail, name: "Jonas Hoppe" },
      orders: [],
    });
    const model = new ScriptedModel([
      modelResponse([assistantMessage(structured({
        type: "question",
        purpose: "pure_clarification",
        text: "How can I help?",
        capability: null,
        missing_arguments: [],
      }))]),
    ]);

    const result = await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      tenant: { ...dependencies.tenant, customerName: null },
      customerDisplayName: null,
      message: "I need help with my order.",
      model,
      capabilities: { ...dependencies, commerce },
    });

    model.assertComplete();
    expect(result.response).toMatch(/^Hi Jonas,\n\n/);
  });

  it("preloads trusted customer history before the model continuation", async () => {
    const dependencies = await createDemoDependencies();
    const commerce = new InMemoryCommerceProvider({
      customer: { email: dependencies.tenant.customerEmail },
      orders: [{
        id: "shopify-1054",
        orderNumber: "1054",
        status: "processing",
        fulfillmentStatus: null,
        items: [{ id: "line-1054", title: "Chaos Headset 4", quantity: 1 }],
        fulfillments: [],
      }],
    });
    const model = new ScriptedModel([
      modelResponse([assistantMessage(structured({
        type: "fact",
        fact_kind: "order_reference",
        evidence: [{ result_id: "tool_result_2", field_paths: ["data.orderNumber"] }],
      }))]),
    ]);

    const result = await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      commerce,
      message: "Where is my order?",
      model,
      capabilities: { ...dependencies, commerce },
    });

    model.assertComplete();
    expect(model.calls).toHaveLength(1);
    expect(result.response).toContain("#1054");
    expect(result.trace.events.filter((event) => event.type === "tool_call").map((event) => event.data.name)).toEqual([
      "get_order_history",
      "get_order",
    ]);
    expect(model.firstCall.request.input.at(-1).content).toContain("Server-preloaded read-only evidence data");
    expect(model.firstCall.request.input.at(-1).content).toContain('"order_resolution":"candidate"');
  });

  it.each([
    "I want to return order 10231",
    "How do I return order 10231?",
  ])("pre-resolves an explicit order before model wording or tool selection: %s", async (message) => {
    const dependencies = await createDemoDependencies();
    const model = new ScriptedModel([
      modelResponse([assistantMessage(structured({
        type: "fact",
        fact_kind: "order_reference",
        evidence: [{ result_id: "tool_result_1", field_paths: ["data.orderNumber"] }],
      }))]),
    ]);

    const result = await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      message,
      model,
      capabilities: dependencies,
      enableDevDiagnostics: true,
    });

    model.assertComplete();
    expect(model.calls).toHaveLength(1);
    expect(result.trace.events.filter((event) => event.type === "tool_call").map((event) => event.data.name)).toContain("get_order");
    expect(result.trace.events.find((event) => event.type === "tool_call" && event.data.name === "get_order").data.preloaded).toBe(true);
    expect(result.conversationContext.activeOrder).toMatchObject({ requestedOrderId: "10231", state: "verified" });
    expect(result.trace.diagnostics.validation.schema_valid).toBe(true);
  });

  it("does not expose or preload procedures for a multi-turn troubleshooting request", async () => {
    const dependencies = await createDemoDependencies();
    const model = new ScriptedModel([
      modelResponse([assistantMessage(structured({
        type: "question",
        purpose: "pure_clarification",
        text: "What exactly is happening with the headset?",
        capability: null,
        missing_arguments: [],
      }))]),
    ]);

    const result = await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      message: "I use the USB-C dongle on a PC.",
      history: [
        { role: "user", content: "My headset will not connect." },
        { role: "assistant", content: "What headset model are you using?" },
        { role: "user", content: "It is the Orion Wireless." },
        { role: "assistant", content: "Have you already reset it?" },
        { role: "user", content: "I already reset it." },
      ],
      conversationContext: {
        turn: 3,
        customerProvided: {
          product: "Orion Wireless",
          issue: "My headset will not connect",
          attemptedSteps: ["I already reset it"],
        },
      },
      model,
      capabilities: dependencies,
    });

    model.assertComplete();
    expect(result.trace.tools.map((tool) => tool.name)).not.toContain("search_procedures");
    expect(model.firstCall.request.tools.map((tool) => tool.name)).not.toContain("search_procedures");
    expect(result.trace.events.filter((event) => event.type === "tool_call").map((event) => event.data.name)).not.toContain("search_procedures");
    expect(model.firstCall.request.input.at(-1).content).not.toContain('"tool":"search_procedures"');
  });

  it("uses one model response for a pure acknowledgement", async () => {
    const dependencies = await createDemoDependencies();
    const model = new ScriptedModel([
      modelResponse([assistantMessage(structured({ type: "acknowledgement", kind: "thanks" }))]),
    ]);

    const result = await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      message: "Thanks, that solved it.",
      model,
      capabilities: dependencies,
    });

    model.assertComplete();
    expect(model.calls).toHaveLength(1);
    expect(result.response).toBe("You’re welcome.");
    expect(result.trace.events.filter((event) => event.type === "tool_call")).toHaveLength(0);
  });

  it("appends the server-resolved support-user signature once", async () => {
    const dependencies = await createDemoDependencies();
    const model = new ScriptedModel([
      modelResponse([assistantMessage(structured({ type: "acknowledgement", kind: "thanks" }))]),
    ]);

    const result = await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      message: "Thanks, that solved it.",
      signature: "Mvh\nJonas",
      model,
      capabilities: dependencies,
    });

    expect(result.response).toBe("You’re welcome.\n\nMvh\nJonas");
    expect(result.response.match(/Mvh/g)).toHaveLength(1);
    expect(result.trace.events.at(-1).data.response).toBe(result.response);
  });

  it("selects the English employee signature for an English reply", async () => {
    const dependencies = await createDemoDependencies();
    const model = new ScriptedModel([
      modelResponse([assistantMessage(structured({ type: "acknowledgement", kind: "thanks" }))]),
    ]);

    const result = await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      message: "Thanks, that solved it.",
      signature: {
        defaultClosingText: "Mvh\nJonas",
        languageSignatures: { en: "Best regards\nJonas" },
      },
      model,
      capabilities: dependencies,
    });

    expect(result.response).toBe("You’re welcome.\n\nBest regards\nJonas");
  });

  it("selects the Danish employee signature for a Danish reply", async () => {
    const dependencies = await createDemoDependencies();
    const model = new ScriptedModel([
      modelResponse([assistantMessage(structured({ type: "acknowledgement", kind: "thanks" }))]),
    ]);

    const result = await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      message: "Tak, det løste problemet.",
      signature: {
        defaultClosingText: "Best regards\nJonas",
        languageSignatures: { da: "Mvh\nJonas" },
      },
      model,
      capabilities: dependencies,
    });

    expect(result.response).toBe("Det var så lidt.\n\nMvh\nJonas");
  });

  it("selects a German employee signature without translating it", async () => {
    const dependencies = await createDemoDependencies();
    const model = new ScriptedModel([
      modelResponse([assistantMessage(structured({ type: "acknowledgement", kind: "thanks" }))]),
    ]);

    const result = await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      message: "Ich danke Ihnen, bitte helfen Sie mir.",
      signature: {
        defaultClosingText: "Best regards\nJonas",
        languageSignatures: { de: "Viele Grüße\nJonas" },
      },
      model,
      capabilities: dependencies,
    });

    expect(result.response).toBe("You’re welcome.\n\nViele Grüße\nJonas");
  });

  it("uses the default employee signature when a language override is absent", async () => {
    const dependencies = await createDemoDependencies();
    const model = new ScriptedModel([
      modelResponse([assistantMessage(structured({ type: "acknowledgement", kind: "thanks" }))]),
    ]);

    const result = await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      message: "Thanks, that solved it.",
      signature: {
        defaultClosingText: "Mvh\nJonas",
        languageSignatures: { da: "Mvh\nJonas" },
      },
      model,
      capabilities: dependencies,
    });

    expect(result.response).toBe("You’re welcome.\n\nMvh\nJonas");
  });

  it("does not append a signature when the employee has none", async () => {
    const dependencies = await createDemoDependencies();
    const model = new ScriptedModel([
      modelResponse([assistantMessage(structured({ type: "acknowledgement", kind: "thanks" }))]),
    ]);

    const result = await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      message: "Thanks, that solved it.",
      signature: { defaultClosingText: "", languageSignatures: {} },
      model,
      capabilities: dependencies,
    });

    expect(result.response).toBe("You’re welcome.");
  });

  it("applies the shared Luna medium default to the SDK agent", async () => {
    const dependencies = await createDemoDependencies();
    const model = new ScriptedModel([
      modelResponse([assistantMessage(structured({ type: "acknowledgement", kind: "thanks" }))]),
    ]);

    await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      message: "Thanks, that solved it.",
      model,
      capabilities: dependencies,
    });

    expect(model.firstCall.request.modelSettings.reasoning).toEqual({ effort: "medium" });
  });

  it("uses one SDK agent for the knowledge/tool continuation", async () => {
    const dependencies = await createDemoDependencies();
    const model = new ScriptedModel([
      modelResponse([functionCall("search_policy", { query: "return window" }, { callId: "sdk-policy" })]),
      modelResponse([assistantMessage(structured({
        type: "knowledge_guidance",
        text: "Returns are accepted within 30 days of delivery.",
        basis: { result_id: "tool_result_1", field_paths: ["results"] },
      }))]),
    ]);

    const result = await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      message: "What is your return window?",
      model,
      capabilities: dependencies,
    });

    model.assertComplete();
    expect(model.calls).toHaveLength(2);
    expect(model.firstCall.request.modelSettings.parallelToolCalls).toBe(false);
    expect(result.response).toContain("30 days");
    expect(result.proposedActions).toEqual([]);
    expect(result.trace.events.map((event) => event.type)).toContain("tool_result");
    expect(result.trace.events.at(-1).type).toBe("final_response");
  });

  it("preloads policy evidence without preloading procedures", async () => {
    const dependencies = await createDemoDependencies();
    const model = new ScriptedModel([
      modelResponse([assistantMessage(structured(
        {
          type: "knowledge_guidance",
          text: "A return can be requested within 30 days of delivery when the item is unused and in its original packaging.",
          basis: { result_id: "tool_result_1", field_paths: ["results"] },
        },
      ))]),
    ]);

    const result = await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      message: "My item is damaged and I also want to return it.",
      model,
      capabilities: dependencies,
    });

    model.assertComplete();
    expect(model.calls).toHaveLength(1);
    expect(result.trace.events.filter((event) => event.type === "tool_call").map((event) => event.data.name)).toEqual([
      "search_policy",
    ]);
    expect(result.response).toContain("30 days");
    expect(result.trace.tools.map((tool) => tool.name)).not.toContain("search_procedures");
    expect(model.firstCall.request.input.at(-1).content).not.toContain('"tool":"search_procedures"');
  });

  it("does not recover procedural evidence when the runtime has no procedure result", async () => {
    const dependencies = await createDemoDependencies();
    const model = new ScriptedModel([
      modelResponse([assistantMessage(structured({
        type: "knowledge_guidance",
        text: "I’m sorry, but I couldn’t safely complete that lookup right now.",
        basis: { result_id: "tool_result_1", field_paths: ["results"] },
      }))]),
    ]);

    const result = await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      message: "My headset will not connect and I need help.",
      model,
      capabilities: dependencies,
    });

    model.assertComplete();
    expect(result.response).toContain("couldn’t safely complete that lookup");
    expect(result.trace.events.filter((event) => event.type === "tool_call").map((event) => event.data.name)).not.toContain("search_procedures");
    expect(result.trace.events.at(-1).data.validation.all_valid).toBe(false);
  });

  it("keeps proposal-only actions unexecuted while the SDK continues", async () => {
    const dependencies = await createDemoDependencies();
    const model = new ScriptedModel([
      modelResponse([functionCall("get_order", { order_id: "10232" }, { callId: "sdk-order" })]),
      modelResponse([functionCall("cancel_order", { order_id: "10232", reason: "Customer request" }, { callId: "sdk-cancel" })]),
      modelResponse([assistantMessage(structured({
        type: "action_offer",
        capability: "cancel_order",
        mode: "proposal",
        missing_arguments: [],
      }))]),
    ]);

    const result = await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      message: "Please cancel order #10232.",
      model,
      capabilities: dependencies,
    });

    model.assertComplete();
    expect(result.proposedActions).toHaveLength(1);
    expect(result.proposedActions[0].action).toBe("cancel_order");
    expect(result.response).toContain("Nothing will be changed until you confirm");
    expect(result.trace.events.filter((event) => event.type === "tool_result")).toHaveLength(3);
  });

  it("runs one verified proposal through the Playground dry-run boundary", async () => {
    const dependencies = await createDemoDependencies();
    const model = new ScriptedModel([
      modelResponse([functionCall("get_order", { order_id: "10232" }, { callId: "order" })]),
      modelResponse([functionCall("cancel_order", { order_id: "10232", reason: "Customer changed their mind" }, { callId: "cancel" })]),
      modelResponse([assistantMessage(structured({
        type: "action_offer",
        capability: "cancel_order",
        mode: "proposal",
        missing_arguments: [],
      }))]),
    ]);

    const result = await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      message: "Cancel order #10232.",
      model,
      capabilities: dependencies,
      actionExecutor: new PlaygroundDryRunExecutor(),
    });

    expect(result.actionExecutions).toHaveLength(1);
    expect(result.actionExecutions[0]).toMatchObject({
      action: "cancel_order",
      mode: "dry_run",
      validation_status: "validated",
      execution_status: "dry_run_success",
      executed: false,
    });
    expect(result.trace.events.some((event) => event.type === "action_execution")).toBe(true);
    expect(result.response).toContain("Nothing will be changed until you confirm");
  });

  it("does not persist a simulated cancellation when the customer changes their mind", async () => {
    const dependencies = await createDemoDependencies();
    const firstModel = new ScriptedModel([
      modelResponse([functionCall("get_order", { order_id: "10232" }, { callId: "order" })]),
      modelResponse([functionCall("cancel_order", { order_id: "10232", reason: "Customer changed their mind" }, { callId: "cancel" })]),
      modelResponse([assistantMessage(structured({ type: "action_offer", capability: "cancel_order", mode: "proposal", missing_arguments: [] }))]),
    ]);
    const first = await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      message: "Cancel order #10232.",
      model: firstModel,
      capabilities: dependencies,
      actionExecutor: new PlaygroundDryRunExecutor(),
    });

    const secondModel = new ScriptedModel([
      modelResponse([assistantMessage(structured({ type: "acknowledgement", kind: "correction" }))]),
    ]);
    const second = await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      message: "Actually, don't cancel it.",
      history: [{ role: "user", content: "Cancel order #10232." }, { role: "assistant", content: first.response }],
      conversationContext: first.conversationContext,
      model: secondModel,
      capabilities: dependencies,
      actionExecutor: new PlaygroundDryRunExecutor(),
    });

    expect(first.actionExecutions[0].executed).toBe(false);
    expect(second.actionExecutions).toEqual([]);
    expect(second.response).toBe("Thanks for clarifying.");
  });

  it("uses the latest refund proposal amount without executing either proposal", async () => {
    const dependencies = await createDemoDependencies();
    const firstModel = new ScriptedModel([
      modelResponse([functionCall("get_order", { order_id: "10232" }, { callId: "order-1" })]),
      modelResponse([functionCall("create_refund", { order_id: "10232", amount: "500", reason: "Damaged item" }, { callId: "refund-1" })]),
      modelResponse([assistantMessage(structured({ type: "action_offer", capability: "create_refund", mode: "proposal", missing_arguments: [] }))]),
    ]);
    const first = await runGreenfieldAgentWithAgentsSdk({ ...dependencies, message: "Refund 500 for order #10232.", model: firstModel, capabilities: dependencies, actionExecutor: new PlaygroundDryRunExecutor() });

    const secondModel = new ScriptedModel([
      modelResponse([functionCall("get_order", { order_id: "10232" }, { callId: "order-2" })]),
      modelResponse([functionCall("create_refund", { order_id: "10232", amount: "300", reason: "Customer corrected the amount" }, { callId: "refund-2" })]),
      modelResponse([assistantMessage(structured({ type: "action_offer", capability: "create_refund", mode: "proposal", missing_arguments: [] }))]),
    ]);
    const second = await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      message: "Actually make it 300.",
      history: [{ role: "user", content: "Refund 500 for order #10232." }, { role: "assistant", content: first.response }],
      conversationContext: first.conversationContext,
      model: secondModel,
      capabilities: dependencies,
      actionExecutor: new PlaygroundDryRunExecutor(),
    });

    expect(first.actionExecutions[0].arguments.amount).toBe("500");
    expect(second.actionExecutions[0].arguments.amount).toBe("300");
    expect(first.actionExecutions[0].executed).toBe(false);
    expect(second.actionExecutions[0].executed).toBe(false);
  });
});
