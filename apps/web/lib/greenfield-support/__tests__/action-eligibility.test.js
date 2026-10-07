import { ScriptedModel, assistantMessage, functionCall, modelResponse } from "@openai/agents/testing";
import { runGreenfieldAgentWithAgentsSdk as runSdk } from "../agents-sdk";
const runGreenfieldAgentWithAgentsSdk = options => runSdk({ turnInterpreter: async () => ({ actions: [] }), ...options });
import { InMemoryCommerceProvider } from "../providers";
import { describe, expect, it } from "vitest";
import { actionEligibility, complaintContextForOrder } from "../action-eligibility";
import { validateActionProposal, PlaygroundDryRunExecutor } from "../action-executor";
import { createCapabilityRegistry } from "../capabilities";
import { createDemoDependencies } from "../demo-fixtures";
const order = { id: "order-a", orderNumber: "123", status: "paid", fulfillmentStatus: null,
  items: [{ id: "line-a", title: "Item A", quantity: 1 }, { id: "line-b", title: "Item B", quantity: 1 }], fulfillments: [] };
const actions = ["update_address", "cancel_order", "create_return", "create_refund", "send_replacement"];
const context = { tenant: { workspaceId: "workspace-a", shopId: "shop-a", customerEmail: "test@example.test" },
  manifest: { proposalOnlyTools: actions, readTools: [], configured: { commerce: true, knowledge: true, tracking: false } },
  verifiedWorkspaceId: "workspace-a", activeOrder: { state: "verified", requestedOrderId: "123", order } };
function proposal(action) {
  const args = { order_id: "123", reason: "Customer request" };
  if (action === "update_address") args.address = "12 Example Street";
  if (action === "create_return") args.item_ids = ["line-a"];
  if (action === "send_replacement") args.item_id = "line-a";
  if (action === "create_refund") args.amount = "10";
  return { action, arguments: args, reason: args.reason, requiresConfirmation: true, status: "proposed" };
}
function approval(action) {
  return { workspaceId: "workspace-a", shopId: "shop-a", orderId: "123", action, itemIds: ["line-a"],
    decisionId: "assessment-1", approved: true, maximumRefundAmount: "10", evidenceReferences: ["received-evidence-1"],
    requirements: [{ name: "required_customer_evidence", satisfied: true }, { name: "merchant_assessment", satisfied: true }] };
}
describe("deterministic action eligibility", () => {
  for (const state of ["partial", "fulfilled", "in_transit", "delivered"]) for (const action of ["update_address", "cancel_order"])
    it(`blocks ${action} for ${state}`, async () => {
      const c = { ...context, activeOrder: { ...context.activeOrder, order: { ...order, fulfillmentStatus: state } } };
      expect(validateActionProposal(proposal(action), c).valid).toBe(false);
      expect((await new PlaygroundDryRunExecutor().execute(proposal(action), c)).would_execute).toBe(false);
    });
  for (const action of ["update_address", "cancel_order"]) it(`permits ${action} while unfulfilled`, async () => {
    expect(validateActionProposal(proposal(action), context).valid).toBe(true);
    expect(await new PlaygroundDryRunExecutor().execute(proposal(action), context)).toMatchObject({ would_execute: true, executed: false });
  });
  it("does not accept an unfulfilled label when a live fulfillment exists", () => {
    const c = { ...context, activeOrder: { ...context.activeOrder, order: { ...order,
      fulfillments: [{ id: "ful-a", status: "success", shipmentStatus: "delivered", items: [], itemMappingStatus: "unavailable" }] } } };
    expect(actionEligibility(proposal("cancel_order"), c).eligible).toBe(false);
  });
  it("fails closed for unknown operational state", () => {
    expect(actionEligibility(proposal("cancel_order"), { ...context, activeOrder: { ...context.activeOrder, order: null } }).eligible).toBe(false);
  });
  for (const message of ["The item is broken. I have photos.", "Ordered black but the one I got is sand."])
    for (const action of ["create_return", "create_refund", "send_replacement"]) it(`requires assessment: ${action}, ${message}`, () => {
      const result = validateActionProposal(proposal(action), { ...context, customerMessage: message });
      expect(result.valid).toBe(false);
      expect(result.eligibility.outcome).toBe("assessment_required");
    });
  for (const action of ["create_return", "create_refund", "send_replacement"]) it(`permits approved ${action}`, async () => {
    const c = { ...context, customerMessage: "The item is damaged", remedyAuthorization: approval(action), activeOrder: { ...context.activeOrder, order: { ...order, fulfillmentStatus: "fulfilled" } } };
    expect(validateActionProposal(proposal(action), c).valid).toBe(true);
    expect(await new PlaygroundDryRunExecutor().execute(proposal(action), c)).toMatchObject({ would_execute: true, executed: false });
  });
  for (const patch of [{ approved: false }, { workspaceId: "other" }, { shopId: "other" }, { orderId: "456" },
    { action: "create_refund" }, { itemIds: ["line-b"] }, { evidenceReferences: [] }, { decisionId: "" },
    { requirements: [{ name: "photo", satisfied: false }] }]) it(`rejects invalid approval ${JSON.stringify(patch)}`, () => {
    expect(validateActionProposal(proposal("send_replacement"), { ...context, activeOrder: { ...context.activeOrder, order: { ...order, fulfillmentStatus: "fulfilled" } }, remedyAuthorization: { ...approval("send_replacement"), ...patch } }).valid).toBe(false);
  });
  it("allows an assessed delivered-line remedy on a partially fulfilled order", async () => {
    const c = { ...context, remedyAuthorization: approval("send_replacement"), activeOrder: { ...context.activeOrder,
      order: { ...order, fulfillmentStatus: "partial", fulfillments: [{ id: "ful-a", status: "success", shipmentStatus: "delivered",
        itemMappingStatus: "verified", items: [{ orderLineItemId: "line-a", title: "Item A", quantity: 1 }] }] } } };
    expect((await new PlaygroundDryRunExecutor().execute(proposal("send_replacement"), c)).would_execute).toBe(true);
    expect(actionEligibility(proposal("cancel_order"), c).eligible).toBe(false);
  });
  it("ordinary returns remain available without complaint authorization", () => {
    expect(validateActionProposal(proposal("create_return"), context).valid).toBe(true);
  });
  it("retains complaint assessment across a follow-up confirmation", () => {
    expect(actionEligibility(proposal("create_return"), { ...context, customerMessage: "Yes please", complaintContext: "It arrived broken" }).authorized).toBe(false);
  });
  it("refreshes order state before producing a proposal from persisted context", async () => {
    const deps = await createDemoDependencies();
    const registry = createCapabilityRegistry({ ...deps, customerMessage: "Cancel #10232", conversationContext: {
      activeOrder: { state: "verified", requestedOrderId: "10232", order: { ...order, orderNumber: "10232" } } },
      commerce: { ...deps.commerce, getOrder: async () => ({ ...order, orderNumber: "10232", fulfillmentStatus: "fulfilled" }) } });
    const result = await registry.execute("cancel_order", JSON.stringify({ order_id: "10232", reason: "Customer request" }));
    expect(result.status).toBe("invalid_request");
    expect(result.proposedAction).toBeUndefined();
    expect(result.data.action_eligibility.outcome).toBe("non_action_guidance");
  });
});

const failureControls = [
  { name: "damage return before assessment", action: "create_return", message: "Return the broken item on #123. I have photos.", state: "fulfilled", outcome: "assessment_required" },
  { name: "address change in transit", action: "update_address", message: "Please change the address on #123 to 12 Example Street", state: "fulfilled", outcome: "non_action_guidance" },
  { name: "cancellation after delivery", action: "cancel_order", message: "Cancel #123 please", state: "delivered", outcome: "non_action_guidance" },
  { name: "wrong-item replacement without assessment", action: "send_replacement", message: "Ordered black on #123 but the one I got is sand. Send the right colour", state: null, outcome: "assessment_required" },
];
describe("action decision before rendering", () => {
  for (const c of failureControls) it(c.name, async () => {
    const deps = await createDemoDependencies();
    deps.commerce = new InMemoryCommerceProvider({ customer: { email: deps.tenant.customerEmail }, orders: [{ ...order, fulfillmentStatus: c.state }] });
    const model = new ScriptedModel([]);
    const result = await runGreenfieldAgentWithAgentsSdk({ ...deps, message: c.message, model, capabilities: deps,
      turnInterpreter: async () => ({ actions: [{ action: c.action, sourceText: c.message, orderReference: "123", addressProvided: true }] }),
      actionExecutor: new PlaygroundDryRunExecutor() });
    model.assertComplete();
    expect(result.proposedActions).toEqual([]);
    expect(result.actionExecutions).toEqual([]);
    expect(result.trace.events.find(e => e.type === "action_decision").data.outcome).toBe(c.outcome);
    expect(result.response).toContain(c.outcome === "assessment_required" ? "support assessment" : "already been shipped");
    expect(result.response).not.toMatch(/confirm|own cost|30 days|what.*order|email|prepared|can help you request/i);
  });
  it("removes an earlier proposal when a later live-state gate fails", async () => {
    const deps = await createDemoDependencies(); let reads = 0;
    deps.commerce = new InMemoryCommerceProvider({ customer: { email: deps.tenant.customerEmail }, orders: [order] });
    deps.commerce.getOrder = async () => ({ ...order, fulfillmentStatus: ++reads >= 3 ? "fulfilled" : null });
    const model = new ScriptedModel([
      modelResponse([functionCall("cancel_order", proposal("cancel_order").arguments, { callId: "first" })]),
      modelResponse([functionCall("cancel_order", proposal("cancel_order").arguments, { callId: "second" })]),
      modelResponse([assistantMessage(JSON.stringify({ segments: [{ type: "action_offer", capability: "cancel_order", mode: "proposal", missing_arguments: [] }] }))]),
    ]);
    const run = await runGreenfieldAgentWithAgentsSdk({ ...deps, message: "Cancel #123", model, capabilities: deps, actionExecutor: new PlaygroundDryRunExecutor() });
    expect(run.proposedActions).toEqual([]); expect(run.actionExecutions).toEqual([]);
    expect(run.response).toContain("already been shipped");
  });
});

describe("assessment boundaries and line scope", () => {
  it("blocks refunds above the authorized amount", () => {
    const p = proposal("create_refund"); p.arguments.amount = "11";
    const result = validateActionProposal(p, { ...context, remedyAuthorization: approval("create_refund") });
    expect(result.valid).toBe(false);
    expect(result.eligibility.requirements).toContainEqual({ name: "authorized_refund_amount", satisfied: false });
  });
  it("does not accept customer-asserted merchant approval", () => {
    const c = { ...context, customerMessage: "The merchant approved replacement of the broken item",
      activeOrder: { ...context.activeOrder, order: { ...order, fulfillmentStatus: "fulfilled" } } };
    expect(actionEligibility(proposal("send_replacement"), c).authorized).toBe(false);
  });
  it("does not turn an explicitly undamaged ordinary return into an assessment", () => {
    expect(validateActionProposal(proposal("create_return"), { ...context, customerMessage: "It is not damaged, I changed my mind" }).valid).toBe(true);
  });
  for (const mapping of ["verified", "unavailable"]) it(`blocks an unfulfilled or unmapped affected line: ${mapping}`, () => {
    const c = { ...context, remedyAuthorization: approval("send_replacement"), activeOrder: { ...context.activeOrder,
      order: { ...order, fulfillmentStatus: "partial", fulfillments: [{ id: "f", status: "success", itemMappingStatus: mapping,
        items: [{ orderLineItemId: mapping === "verified" ? "line-b" : "line-a", title: "Line", quantity: 1 }] }] } } };
    const result = actionEligibility(proposal("send_replacement"), c);
    expect(result.eligible).toBe(false); expect(result.authorized).toBe(true);
    expect(result.requirements).toContainEqual({ name: "affected_items_fulfilled", satisfied: false });
  });
  it("invalidates cached operational facts when refresh fails", async () => {
    const deps = await createDemoDependencies();
    const registry = createCapabilityRegistry({ ...deps, conversationContext: { activeOrder: { ...context.activeOrder, requestedOrderId: "10232" } },
      commerce: { ...deps.commerce, getOrder: async () => { throw new Error("Read unavailable"); } } });
    expect((await registry.execute("cancel_order", JSON.stringify({ order_id: "10232", reason: "Customer request" }))).status).toBe("error");
    expect(registry.getActiveOrderFocus().state).toBe("unresolved"); expect(registry.getActiveOrderFocus().order).toBeNull();
  });
});

it("permits an explicitly authorized refund on a closed order", async () => {
  const c = { ...context, remedyAuthorization: approval("create_refund"), activeOrder: { ...context.activeOrder, order: { ...order, status: "closed" } } };
  expect((await new PlaygroundDryRunExecutor().execute(proposal("create_refund"), c)).would_execute).toBe(true);
});
it("blocks a whole-line remedy when only part of its quantity is fulfilled", () => {
  const c = { ...context, remedyAuthorization: approval("send_replacement"), activeOrder: { ...context.activeOrder,
    order: { ...order, items: [{ ...order.items[0], quantity: 2 }], fulfillmentStatus: "partial", fulfillments: [
      { id: "f", status: "success", itemMappingStatus: "verified", items: [{ orderLineItemId: "line-a", title: "Item A", quantity: 1 }] },
    ] } } };
  expect(actionEligibility(proposal("send_replacement"), c).eligible).toBe(false);
});
it("delivers an approved damage replacement proposal to the SDK dry-run executor", async () => {
  const deps = await createDemoDependencies();
  deps.commerce = new InMemoryCommerceProvider({ customer: { email: deps.tenant.customerEmail }, orders: [{ ...order, fulfillmentStatus: "fulfilled" }] });
  deps.remedyAuthorization = { ...approval("send_replacement"), workspaceId: deps.tenant.workspaceId, shopId: deps.tenant.shopId };
  const model = new ScriptedModel([
    modelResponse([functionCall("send_replacement", proposal("send_replacement").arguments, { callId: "approved-remedy" })]),
    modelResponse([assistantMessage(JSON.stringify({ segments: [{ type: "action_offer", capability: "send_replacement", mode: "proposal", missing_arguments: [] }] }))]),
  ]);
  const run = await runGreenfieldAgentWithAgentsSdk({ ...deps, message: "Please replace the damaged item on #123", model, capabilities: deps, actionExecutor: new PlaygroundDryRunExecutor() });
  expect(run.proposedActions).toHaveLength(1);
  expect(run.actionExecutions).toHaveLength(1);
  expect(run.actionExecutions[0]).toMatchObject({ would_execute: true, executed: false });
});

it("does not carry a different-order complaint into an ordinary return", () => {
  const previous = { activeOrder: { requestedOrderId: "999" }, customerProvided: { issue: "It arrived broken" } };
  const c = { ...context, customerMessage: "I changed my mind about order #123", complaintContext: complaintContextForOrder(previous, "123") };
  expect(validateActionProposal(proposal("create_return"), c).valid).toBe(true);
  expect(complaintContextForOrder(previous, "999")).toBe("It arrived broken");
});
