import { describe, expect, it, vi } from "vitest";
import { ScriptedModel, assistantMessage, functionCall, modelResponse } from "@openai/agents/testing";
import { runGreenfieldAgentWithAgentsSdk } from "../agents-sdk";
import { createDemoDependencies } from "../demo-fixtures";
import { createCapabilityRegistry } from "../capabilities";
import { InMemoryCommerceProvider } from "../providers";
import { PlaygroundDryRunExecutor } from "../action-executor";
import { normalizeTurnIR } from "../turn-ir";
import { isExplicitAddressChangeRequest } from "../tool-contracts";

const emptyOutput = () => modelResponse([assistantMessage(JSON.stringify({ segments: [] }))]);
async function run({ message, action, state = "fulfilled", addressProvided = false, model = new ScriptedModel([]) }) {
  const dependencies = await createDemoDependencies();
  const order = { id: "order-123", orderNumber: "123", status: "paid", fulfillmentStatus: state,
    items: [{ id: "line-a", title: "Item A", quantity: 1 }], fulfillments: [] };
  const tenant = { ...dependencies.tenant, customerEmail: "customer@example.test" };
  const turnIR = { actions: action ? [{ action, sourceText: message, orderReference: "123", addressProvided }] : [] };
  const result = await runGreenfieldAgentWithAgentsSdk({ tenant, message, model,
    capabilities: { ...dependencies, tenant, commerce: new InMemoryCommerceProvider({ orders: [order] }) },
    turnInterpreter: async () => turnIR, enableDevDiagnostics: true, interactionChannel: "playground",
    actionExecutor: new PlaygroundDryRunExecutor() });
  if (result.trace.events.some(e => e.type === "model_response")) model.assertComplete();
  return result;
}

describe("action intent boundary before model tool choice", () => {
  for (const [action, message] of [
    ["update_address", "Kan I ændre leveringsadressen på min ordre #123?"],
    ["update_address", "Can you change the shipping address on order #123?"],
    ["cancel_order", "Jeg vil gerne annullere min ordre #123."],
    ["cancel_order", "Please cancel order #123."],
    ["update_address", "Pouvez-vous changer l'adresse de livraison de ma commande #123 ?"],
    ["cancel_order", "Bitte stornieren Sie meine Bestellung #123."],
  ]) for (const state of ["fulfilled", "partial", "delivered"]) {
    it(`blocks ${action} ${state} with no model tool: ${message}`, async () => {
      const result = await run({ message, action, state });
      expect(result.trace.events.find(e => e.type === "action_intent").data.eligibility.outcome).toBe("non_action_guidance");
      expect(result.trace.events.find(e => e.type === "action_decision").data.action).toBe(action);
      expect(result.trace.events.filter(e => e.type === "tool_call").every(e => e.data.name === "get_order")).toBe(true);
      expect(result.trace.diagnostics.fallback_reason).toBe(null);
      expect(result.proposedActions).toEqual([]);
      expect(result.actionExecutions).toEqual([]);
      expect(result.response).not.toContain("couldn’t safely complete");
      expect(result.trace.diagnostics.validation.approved_count).toBe(1);
      expect(result.trace.events.some(e => e.type === "model_response")).toBe(false);
      expect(result.trace.diagnostics.final_composition_source).toBe("action_boundary");
    });
  }
  for (const message of ["Change address on #123.", "Kan I ændre leveringsadressen på #123?"]) {
    it(`asks only for missing address on unfulfilled order: ${message}`, async () => {
      const result = await run({ message, action: "update_address", state: null });
      expect(result.trace.diagnostics.fallback_reason).toBe(null);
      const final = result.trace.events.find(e => e.type === "final_response").data;
      expect(final.structured_response.segments).toHaveLength(1);
      expect(final.structured_response.segments[0]).toMatchObject({ type: "question", missing_arguments: ["address"] });
      expect(result.proposedActions).toEqual([]);
      expect(result.actionExecutions).toEqual([]);
    });
  }
  for (const action of ["cancel_order", "update_address"]) {
    it(`preserves eligible ${action} proposal`, async () => {
      const args = { order_id: "123", reason: "Customer request", ...(action === "update_address" ? { address: "12 Test Street, 8000 Aarhus, Denmark" } : {}) };
      const model = new ScriptedModel([
        modelResponse([functionCall(action, JSON.stringify(args), { callId: "action-call" })]),
        modelResponse([assistantMessage(JSON.stringify({ segments: [{ type: "action_offer", capability: action, mode: "proposal", missing_arguments: [] }] }))]),
      ]);
      const message = action === "cancel_order" ? "Cancel #123" : "Change the address on #123 to 12 Test Street, 8000 Aarhus, Denmark";
      const result = await run({ message, action, state: null, addressProvided: true, model });
      expect(result.trace.events.find(e => e.type === "action_intent").data.eligibility.outcome).toBe("proposal_allowed");
      expect(result.proposedActions).toHaveLength(1);
      expect(result.actionExecutions[0]).toMatchObject({ executed: false, would_execute: true });
      expect(result.trace.diagnostics.fallback_reason).toBe(null);
    });
  }
  it("never enters the proposal loop when the customer has not supplied an address", async () => {
    const result = await run({ message: "Change the address on #123", action: "update_address", state: null });
    expect(result.proposedActions).toEqual([]);
    expect(result.actionExecutions).toEqual([]);
    expect(result.trace.diagnostics.fallback_reason).toBe(null);
    const dependencies = await createDemoDependencies();
    const message = "Change the address on #123";
    const registry = createCapabilityRegistry({ ...dependencies, customerMessage: message,
      turnIR: { actions: [{ action: "update_address", sourceText: message, orderReference: "123", addressProvided: false }] } });
    const attempted = await registry.execute("update_address", JSON.stringify({ order_id: "123", address: "Invented address", reason: "Customer request" }));
    expect(attempted).toMatchObject({ status: "invalid_request", error: { code: "customer_address_required" } });
    expect(attempted.proposedAction).toBeUndefined();
  });
  it("does not consult a model configured to emit a no-tool response", async () => {
    const model = new ScriptedModel([emptyOutput()]);
    const getResponse = vi.spyOn(model, "getResponse");
    const result = await run({ message: "Jeg vil gerne annullere #123.", action: "cancel_order", state: "delivered", model });
    expect(getResponse).not.toHaveBeenCalled();
    expect(result.trace.diagnostics.fallback_reason).toBe(null);
    expect(result.trace.events.find(e => e.type === "action_decision").data.outcome).toBe("non_action_guidance");
  });
  it("semantic meaning overrides legacy English address regex", () => {
    const message = "Kan I ændre leveringsadressen på #123?";
    expect(isExplicitAddressChangeRequest(message, normalizeTurnIR({ actions: [{ action: "update_address", sourceText: message, orderReference: "123", addressProvided: false }] }, message))).toBe(true);
    expect(isExplicitAddressChangeRequest("Change the address", { actions: [] })).toBe(false);
  });
  it("rejects invented semantic evidence", () => {
    expect(() => normalizeTurnIR({ actions: [{ action: "cancel_order", sourceText: "cancel", orderReference: null, addressProvided: false }] }, "Where is my order?")).toThrow();
  });
});
