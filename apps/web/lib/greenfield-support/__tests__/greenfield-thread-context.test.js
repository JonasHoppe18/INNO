import { describe, expect, it } from "vitest";
import { ScriptedModel, assistantMessage, functionCall, modelResponse } from "@openai/agents/testing";
import { createCapabilityRegistry, extractOrderReferences } from "../capabilities";
import { createDemoDependencies } from "../demo-fixtures";
import { runGreenfieldAgentWithAgentsSdk } from "../agents-sdk";
import {
  createGreenfieldConversationContextStore,
  loadGreenfieldThreadState,
  normalizeStoredConversationContext,
  toStoredConversationContext,
} from "../../server/greenfield-thread-context";

function structured(...segments) {
  return JSON.stringify({ segments });
}

function createThreadRows() {
  return new Map([
    ["workspace-a:thread-a", {
      id: "thread-a",
      workspace_id: "workspace-a",
      greenfield_conversation_context_json: null,
    }],
    ["workspace-a:thread-b", {
      id: "thread-b",
      workspace_id: "workspace-a",
      greenfield_conversation_context_json: null,
    }],
    ["workspace-b:thread-a", {
      id: "thread-a",
      workspace_id: "workspace-b",
      greenfield_conversation_context_json: null,
    }],
  ]);
}

function createFakeSupabase(rows) {
  return {
    from(table) {
      const state = { table, filters: [], update: null };
      const builder = {
        select() {
          return builder;
        },
        update(values) {
          state.update = values;
          return builder;
        },
        eq(column, value) {
          state.filters.push([column, value]);
          return builder;
        },
        async maybeSingle() {
          const id = state.filters.find(([column]) => column === "id")?.[1];
          const workspaceId = state.filters.find(([column]) => column === "workspace_id")?.[1];
          const row = rows.get(`${workspaceId}:${id}`);
          if (state.update) {
            if (!row) return { data: null, error: null };
            Object.assign(row, state.update);
            return { data: { id: row.id }, error: null };
          }
          return {
            data: row ? { greenfield_conversation_context_json: row.greenfield_conversation_context_json } : null,
            error: null,
          };
        },
      };
      return builder;
    },
  };
}

function createFakeThreadReadSupabase({ thread, messages }) {
  return {
    from(table) {
      const state = { filters: [] };
      const builder = {
        select() {
          return builder;
        },
        eq(column, value) {
          state.filters.push([column, value]);
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        async maybeSingle() {
          const id = state.filters.find(([column]) => column === "id")?.[1];
          const workspaceId = state.filters.find(([column]) => column === "workspace_id")?.[1];
          return { data: id === thread.id && workspaceId === thread.workspace_id ? thread : null, error: null };
        },
        then(resolve, reject) {
          const workspaceId = state.filters.find(([column]) => column === "workspace_id")?.[1];
          if (table !== "mail_messages" || workspaceId !== thread.workspace_id) {
            return Promise.resolve({ data: [], error: null }).then(resolve, reject);
          }
          const rows = messages
            .filter((row) => row.is_draft === false && row.thread_id === thread.id)
            .reverse();
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

async function runIndependentRequest({ store, dependencies, threadId, message, model, workspaceId, history = [] }) {
  // This function deliberately reconstructs request-local state on every call.
  // Only the server-side store survives between calls.
  const conversationContext = await store.load({ workspaceId, threadId });
  const run = await runGreenfieldAgentWithAgentsSdk({
    ...dependencies,
    message,
    history,
    model,
    conversationContext,
    capabilities: { ...dependencies, conversationContext },
  });
  await store.save({ workspaceId, threadId, context: run.conversationContext });
  return run;
}

function scriptedResponses(caseId, turnIndex) {
  const plans = {
    order_reference_provided_later: ["clarify", "order"],
    delivered_missing_then_found: ["order", "order", "order", "ack"],
    product_clarified_later: ["clarify", "product", "procedure", "procedure"],
    customer_correction: ["product", "product", "product", "ack"],
    troubleshooting_progression: ["procedure", "procedure", "procedure", "procedure"],
  };
  const plan = plans[caseId]?.[turnIndex];
  if (plan === "order") {
    return [
      modelResponse([functionCall("get_order", { order_id: "10231" }, { callId: `${caseId}-${turnIndex}-order` })]),
      modelResponse([assistantMessage(structured({
        type: "fact",
        fact_kind: "order_fulfillment_status",
        evidence: [{ result_id: "tool_result_1", field_paths: ["fulfillmentStatus"] }],
      }))]),
    ];
  }
  if (plan === "product") {
    return [
      modelResponse([functionCall("search_product_knowledge", { query: "headset compatibility" }, { callId: `${caseId}-${turnIndex}-product` })]),
      modelResponse([assistantMessage(structured({
        type: "knowledge_guidance",
        text: "The product reference provides the relevant compatibility details.",
        basis: { result_id: "tool_result_1", field_paths: ["results"] },
      }))]),
    ];
  }
  if (plan === "procedure") {
    return [
      modelResponse([functionCall("search_procedures", { query: "headset troubleshooting next steps" }, { callId: `${caseId}-${turnIndex}-procedure` })]),
      modelResponse([assistantMessage(structured({
        type: "knowledge_guidance",
        text: "The procedure provides the next safe troubleshooting steps.",
        basis: { result_id: "tool_result_1", field_paths: ["results"] },
      }))]),
    ];
  }
  if (plan === "ack") {
    return [modelResponse([assistantMessage(structured({ type: "acknowledgement", kind: "thanks" }))])];
  }
  return [modelResponse([assistantMessage(structured({
    type: "question",
    purpose: "pure_clarification",
    text: "Which order or product should I check?",
  }))])];
}

async function runInMemoryConversation({ dependencies, caseId, turns }) {
  let conversationContext;
  const history = [];
  const results = [];
  for (let turnIndex = 0; turnIndex < turns.length; turnIndex += 1) {
    const run = await runGreenfieldAgentWithAgentsSdk({
      ...dependencies,
      message: turns[turnIndex],
      history,
      conversationContext,
      model: new ScriptedModel(scriptedResponses(caseId, turnIndex)),
      capabilities: { ...dependencies, conversationContext },
    });
    results.push(run);
    history.push({ role: "user", content: turns[turnIndex] }, { role: "assistant", content: run.response });
    conversationContext = run.conversationContext;
  }
  return results;
}

async function runPersistedConversation({ dependencies, caseId, turns }) {
  const rows = createThreadRows();
  const store = createGreenfieldConversationContextStore(createFakeSupabase(rows));
  const historyRows = new Map();
  const results = [];
  for (let turnIndex = 0; turnIndex < turns.length; turnIndex += 1) {
    const key = "workspace-a:thread-a";
    const history = historyRows.get(key) ?? [];
    const run = await runIndependentRequest({
      store,
      dependencies,
      workspaceId: "workspace-a",
      threadId: "thread-a",
      message: turns[turnIndex],
      history,
      model: new ScriptedModel(scriptedResponses(caseId, turnIndex)),
    });
    results.push(run);
    historyRows.set(key, [...history, { role: "user", content: turns[turnIndex] }, { role: "assistant", content: run.response }]);
  }
  return results;
}

describe("greenfield persisted thread context", () => {
  it("does not allow context from thread A to reach thread B", async () => {
    const rows = createThreadRows();
    const store = createGreenfieldConversationContextStore(createFakeSupabase(rows));
    const context = {
      turn: 1,
      activeOrder: { requestedOrderId: "10231", state: "verified", order: null },
      customerSignal: null,
    };

    await store.save({ workspaceId: "workspace-a", threadId: "thread-a", context });

    expect(await store.load({ workspaceId: "workspace-a", threadId: "thread-a" })).toEqual(context);
    expect(await store.load({ workspaceId: "workspace-a", threadId: "thread-b" })).toBeUndefined();
  });

  it("does not allow context from workspace A to reach workspace B", async () => {
    const rows = createThreadRows();
    const store = createGreenfieldConversationContextStore(createFakeSupabase(rows));
    await store.save({
      workspaceId: "workspace-a",
      threadId: "thread-a",
      context: { turn: 1, activeOrder: { requestedOrderId: "10231", state: "verified", order: null }, customerSignal: null },
    });

    expect(await store.load({ workspaceId: "workspace-b", threadId: "thread-a" })).toBeUndefined();
  });

  it("persists only the bounded customer-provided continuity fields", async () => {
    const rows = createThreadRows();
    const store = createGreenfieldConversationContextStore(createFakeSupabase(rows));
    await store.save({
      workspaceId: "workspace-a",
      threadId: "thread-a",
      context: {
        turn: 2,
        activeOrder: null,
        customerSignal: null,
        customerProvided: {
          product: "A-Spire Wireless",
          platform: "PC",
          attemptedSteps: ["I already reset it."],
        },
      },
    });

    expect(await store.load({ workspaceId: "workspace-a", threadId: "thread-a" })).toEqual({
      turn: 2,
      activeOrder: null,
      customerSignal: null,
      customerProvided: {
        product: "A-Spire Wireless",
        platform: "PC",
        attemptedSteps: ["I already reset it."],
      },
    });
    expect(JSON.stringify(rows.get("workspace-a:thread-a"))).not.toContain("trackingNumber");
  });

  it("survives a second independent request for the same thread and refreshes live order facts", async () => {
    const dependencies = await createDemoDependencies();
    const rows = createThreadRows();
    const store = createGreenfieldConversationContextStore(createFakeSupabase(rows));

    const first = await runIndependentRequest({
      store,
      dependencies,
      workspaceId: "workspace-a",
      threadId: "thread-a",
      message: "Where is order #10231?",
      model: new ScriptedModel([
        modelResponse([functionCall("get_order", { order_id: "10231" }, { callId: "first-order" })]),
        modelResponse([assistantMessage(structured({
          type: "fact",
          fact_kind: "order_fulfillment_status",
          evidence: [{ result_id: "tool_result_1", field_paths: ["fulfillmentStatus"] }],
        }))]),
      ]),
    });
    expect(first.conversationContext.activeOrder.state).toBe("verified");

    const persisted = await store.load({ workspaceId: "workspace-a", threadId: "thread-a" });
    expect(persisted.activeOrder).toEqual({ requestedOrderId: "10231", state: "verified", order: null });

    const second = await runIndependentRequest({
      store,
      dependencies,
      workspaceId: "workspace-a",
      threadId: "thread-a",
      message: "What is the current status of that order?",
      model: new ScriptedModel([
        modelResponse([functionCall("get_order", { order_id: "10231" }, { callId: "second-order" })]),
        modelResponse([assistantMessage(structured({
          type: "fact",
          fact_kind: "order_fulfillment_status",
          evidence: [{ result_id: "tool_result_1", field_paths: ["fulfillmentStatus"] }],
        }))]),
      ]),
    });

    expect(second.trace.events.filter((event) => event.type === "tool_call").map((event) => event.data.name)).toEqual(["get_order"]);
    expect(second.response).toContain("shipped");
  });

  it("treats missing or malformed context as a fresh conversation", async () => {
    expect(normalizeStoredConversationContext(null)).toBeUndefined();
    expect(normalizeStoredConversationContext({ turn: "not-a-number" })).toBeUndefined();

    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({ ...dependencies, tenant: dependencies.tenant });
    expect(registry.getActiveOrderFocus()).toBeNull();
  });

  it("loads prior non-draft thread messages server-side and keeps stored context compact", async () => {
    const state = await loadGreenfieldThreadState(
      createFakeThreadReadSupabase({
        thread: {
          id: "thread-a",
          workspace_id: "workspace-a",
          customer_email: null,
          customer_name: null,
          greenfield_conversation_context_json: {
            turn: 2,
            activeOrder: {
              requestedOrderId: "10231",
              state: "verified",
              order: { orderNumber: "10231", status: "delivered" },
            },
            customerSignal: null,
          },
        },
        messages: [
          { thread_id: "thread-a", is_draft: false, from_me: false, body_text: "Where is my order?", from_email: "customer@example.test" },
          { thread_id: "thread-a", is_draft: false, from_me: true, body_text: "I am checking it now." },
          { thread_id: "thread-a", is_draft: true, from_me: true, body_text: "Draft must not enter agent history." },
        ],
      }),
      { workspaceId: "workspace-a" },
      "thread-a",
    );

    expect(state.history).toEqual([
      { role: "user", content: "Where is my order?" },
      { role: "assistant", content: "I am checking it now." },
    ]);
    expect(state.customer).toEqual({ email: "customer@example.test", name: null });
    expect(state.conversationContext.activeOrder).toEqual({ requestedOrderId: "10231", state: "verified", order: null });
  });

  it("lets a later explicit order correction replace the previous focus", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({
      ...dependencies,
      tenant: dependencies.tenant,
      orderReferences: extractOrderReferences("Correction: I meant order #10232."),
      conversationContext: {
        turn: 1,
        activeOrder: { requestedOrderId: "10231", state: "verified", order: null },
        customerSignal: null,
      },
    });

    expect(registry.getActiveOrderFocus()).toEqual({ requestedOrderId: "10232", state: "unresolved", order: null });
  });

  it("never persists a client-injected live order snapshot as trusted context", () => {
    const stored = toStoredConversationContext({
      turn: 2,
      activeOrder: {
        requestedOrderId: "10231",
        state: "verified",
        order: {
          id: "shopify-10231",
          orderNumber: "10231",
          status: "fulfilled",
          fulfillments: [{ id: "fulfillment-10231", trackingNumber: "PC10231" }],
        },
      },
      customerSignal: null,
    });

    expect(stored.activeOrder).toEqual({ requestedOrderId: "10231", state: "verified", order: null });
    expect(JSON.stringify(stored)).not.toContain("PC10231");
  });

  it("requires a verified current order and refreshed order details before tracking", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({
      ...dependencies,
      tenant: dependencies.tenant,
      conversationContext: {
        turn: 1,
        activeOrder: { requestedOrderId: "10231", state: "verified", order: null },
        customerSignal: null,
      },
    });

    const result = await registry.execute("get_tracking", JSON.stringify({ tracking_number: "PC10231" }));
    expect(result.status).toBe("invalid_request");
    expect(result.error.code).toBe("tracking_order_details_required");
  });

  it("keeps representative frozen multi-turn behavior materially equivalent across request boundaries", async () => {
    const cases = [
      {
        id: "order_reference_provided_later",
        turns: ["Where is my order?", "It is order #10231."],
      },
      {
        id: "delivered_missing_then_found",
        turns: [
          "Where is my order #1063?",
          "It says delivered, but I cannot find the package. What should I do?",
          "If it is missing, can you refund me?",
          "Never mind, I found it at the pickup point. Thanks.",
        ],
      },
      {
        id: "product_clarified_later",
        turns: [
          "My headset will not connect. Can you help?",
          "It is the A-Blaze.",
          "I already reset it. I need the next pairing steps.",
          "I use the USB-C dongle on a PC.",
        ],
      },
      {
        id: "customer_correction",
        turns: [
          "Does my headset work with PlayStation 5?",
          "Correction: it is the A-Rise, not the A-Blaze.",
          "Can I use Bluetooth for competitive gaming?",
          "That answers it, thanks.",
        ],
      },
      {
        id: "troubleshooting_progression",
        turns: [
          "My A-Spire Wireless headset will not pair with the dongle.",
          "I already unplugged and reconnected the dongle and put both devices in pairing mode.",
          "The dongle LED turns white. What should I try next?",
          "I also tried that and the headset still will not connect.",
        ],
      },
    ];

    for (const testCase of cases) {
      const inMemory = await runInMemoryConversation({
        dependencies: await createDemoDependencies(),
        caseId: testCase.id,
        turns: testCase.turns,
      });
      const persisted = await runPersistedConversation({
        dependencies: await createDemoDependencies(),
        caseId: testCase.id,
        turns: testCase.turns,
      });

      expect(persisted.map((run) => run.response)).toEqual(inMemory.map((run) => run.response));
      expect(persisted.map((run) => run.trace.events.filter((event) => event.type === "tool_call").map((event) => event.data.name)))
        .toEqual(inMemory.map((run) => run.trace.events.filter((event) => event.type === "tool_call").map((event) => event.data.name)));
      expect(persisted.map((run) => run.conversationContext.turn)).toEqual(testCase.turns.map((_, index) => index + 1));
    }
  });
});
