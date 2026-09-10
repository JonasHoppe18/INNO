import { describe, expect, it, vi } from "vitest";
import { createCapabilityRegistry } from "../capabilities";
import { InMemoryKnowledgeStore, SupabaseKnowledgeStore } from "../knowledge";

const WORKSPACE_ID = "tenant-relevance";
const PRODUCT_A = { workspaceId: WORKSPACE_ID, productId: "product-a", productModels: ["Product A"] };
const PRODUCT_B = { workspaceId: WORKSPACE_ID, productId: "product-b", productModels: ["Product B"] };

function commerce() {
  return {
    providerName: "test",
    async getOrder() { return null; },
    async getOrderHistory() { return []; },
    async getCustomer() { return null; },
    async getProduct(query) { return { status: "not_found", query }; },
    async getProductAvailability(query) { return { status: "not_found", query }; },
    async inspectFulfillment(orderId) { return { status: "not_found", order_id: orderId }; },
  };
}

async function ingest(store, sourceId, title, content, options = {}) {
  return store.ingest(WORKSPACE_ID, {
    sourceKind: "merchant_authored",
    sourceId,
    title,
    content,
    knowledgeType: "procedural",
    authority: options.authority ?? "authoritative",
    structuredData: options.structuredData,
    metadata: options.metadata,
  });
}

async function ingestPolicy(store, sourceId, title, content, options = {}) {
  return store.ingest(WORKSPACE_ID, {
    sourceKind: options.sourceKind ?? "policy",
    sourceId,
    title,
    content,
    knowledgeType: "policy",
    authority: options.authority ?? "authoritative",
    structuredData: options.structuredData,
    metadata: { lifecycle_status: "published", ...(options.metadata ?? {}) },
  });
}

async function competingProcedures() {
  const store = new InMemoryKnowledgeStore();
  await ingest(store, "pairing", "Product A USB dongle pairing", "Pair the headset and dongle until the connection is established.", {
    structuredData: { applies_to: { product_models: ["Product A"] } },
  });
  await ingest(store, "reset", "Product A factory reset", "Factory reset the headset before pairing it again.", {
    structuredData: { applies_to: { product_models: ["Product A"] } },
  });
  await ingest(store, "firmware", "Product A firmware update", "Update the headset and dongle firmware in the updater.", {
    structuredData: { applies_to: { product_models: ["Product A"] } },
  });
  await ingest(store, "connection", "Product A connection troubleshooting", "Check the connection and reconnect the dongle.", {
    structuredData: { applies_to: { product_models: ["Product A"] } },
  });
  return store;
}

describe("generic greenfield knowledge task relevance", () => {
  it("selects relevant policy body content when the canonical title uses different terminology", async () => {
    const store = new InMemoryKnowledgeStore();
    await ingestPolicy(store, "refund-policy", "Refund policy", "Unused products may be returned within 30 days of delivery. Start the return through support.");
    await ingestPolicy(store, "privacy-policy", "Privacy policy", "Personal data is handled according to our privacy notice, including products you may like and whether you return, exchange, or cancel a purchase.");

    const hits = await store.search({
      workspaceId: WORKSPACE_ID,
      query: "I would like to return my order 1063?",
      taskQuery: "I would like to return my order 1063?",
      knowledgeTypes: ["policy"],
      limit: 5,
    });

    expect(hits.map((hit) => hit.record.sourceId)).toEqual(["refund-policy"]);
    expect(hits[0].taskTitleMatches).toBe(0);
    expect(hits[0].taskBodyMatches).toBeGreaterThan(0);
    expect(hits[0].record.content).toContain("returned within 30 days");
    expect(hits[0].evidenceSections.some((section) => section.content.includes("returned within 30 days"))).toBe(true);

    const broadPolicyLookup = await store.search({
      workspaceId: WORKSPACE_ID,
      query: "policy",
      taskQuery: "I would like to return my order 1063?",
      knowledgeTypes: ["policy"],
      limit: 5,
    });
    expect(broadPolicyLookup.map((hit) => hit.record.sourceId)).toEqual(["refund-policy"]);
  });

  it("matches policy topics by canonical content while excluding unrelated policy records", async () => {
    const store = new InMemoryKnowledgeStore();
    await ingestPolicy(store, "refund-policy", "Refund policy", "Returns are accepted within 30 days. Approved refunds are issued after inspection.");
    await ingestPolicy(store, "returns-policy", "Returns policy", "Customers may receive money back after an eligible return is inspected.");
    await ingestPolicy(store, "shipping-policy", "Shipping and delivery policy", "We deliver orders to supported destinations and publish delivery windows.");
    await ingestPolicy(store, "warranty-policy", "Legal coverage information", "Manufacturing defects are covered by the product warranty for the stated warranty period.");
    await ingestPolicy(store, "privacy-policy", "Privacy policy", "Personal data is handled according to our privacy notice.");

    const search = async (query) => store.search({
      workspaceId: WORKSPACE_ID,
      query,
      taskQuery: query,
      knowledgeTypes: ["policy"],
      limit: 5,
    });

    expect((await search("Can I return this item?"))[0].record.sourceId).toBe("refund-policy");
    expect((await search("Can I return this item?")).map((hit) => hit.record.sourceId)).not.toContain("privacy-policy");
    expect((await search("I want my money back for this purchase"))[0].record.sourceId).toBe("returns-policy");
    expect((await search("Can you deliver my order to Japan?"))[0].record.sourceId).toBe("shipping-policy");
    expect((await search("What warranty coverage applies to a manufacturing defect?"))[0].record.sourceId).toBe("warranty-policy");
    expect((await search("What is your privacy policy?"))[0].record.sourceId).toBe("privacy-policy");
    expect(await search("What loyalty program do you offer?")).toEqual([]);
    expect((await search("Can you deliver my order to Japan?")).some((hit) => hit.record.sourceId === "privacy-policy")).toBe(false);
    expect((await search("Can I return this item and what shipping options are available?"))
      .map((hit) => hit.record.sourceId)).toEqual(expect.arrayContaining(["refund-policy", "shipping-policy"]));
  });

  it("keeps policy type boundaries when other knowledge shares the requested wording", async () => {
    const store = new InMemoryKnowledgeStore();
    await ingestPolicy(store, "refund-policy", "Refund policy", "Returns are accepted within 30 days.");
    await ingest(store, "return-procedure", "How to return a device", "Pack the device and send it to support.", {
      structuredData: { procedure: { task: { key: "return_device", title: "Return a device" } } },
    });

    const hits = await store.search({
      workspaceId: WORKSPACE_ID,
      query: "How can I return this item?",
      knowledgeTypes: ["policy"],
      limit: 5,
    });

    expect(hits.map((hit) => hit.record.sourceId)).toEqual(["refund-policy"]);
  });

  it("A: exact task/title match outranks a same-product unrelated procedure", async () => {
    const hits = await (await competingProcedures()).search({ workspaceId: WORKSPACE_ID, query: "Product A factory reset", knowledgeTypes: ["procedural"], productContext: PRODUCT_A, limit: 5 });
    expect(hits[0].record.sourceId).toBe("reset");
    expect(hits[0].taskRelevance).toBeGreaterThan(0);
  });

  it("B/C: pairing does not select reset, and reset does not select pairing as primary evidence", async () => {
    const store = await competingProcedures();
    const pairing = await store.search({ workspaceId: WORKSPACE_ID, query: "Product A pair the USB dongle", knowledgeTypes: ["procedural"], productContext: PRODUCT_A, limit: 5 });
    const reset = await store.search({ workspaceId: WORKSPACE_ID, query: "Product A factory reset", knowledgeTypes: ["procedural"], productContext: PRODUCT_A, limit: 5 });
    expect(pairing[0].record.sourceId).toBe("pairing");
    expect(reset[0].record.sourceId).toBe("reset");
    expect(pairing.slice(1).some((hit) => hit.record.sourceId === "reset")).toBe(false);
    expect(reset.slice(1).some((hit) => hit.record.sourceId === "pairing")).toBe(false);
  });

  it("uses canonical task identity instead of secondary re-pair wording", async () => {
    const store = new InMemoryKnowledgeStore();
    await ingest(store, "pairing", "Product A dongle pairing", "Pair the headset and dongle.", {
      structuredData: {
        applies_to: { product_models: ["Product A"] },
        procedure: { task: { key: "dongle_pairing", title: "Dongle pairing" } },
      },
    });
    await ingest(store, "reset", "Product A factory reset and re-pair", "Factory reset the headset.", {
      structuredData: {
        applies_to: { product_models: ["Product A"] },
        procedure: { task: { key: "factory_reset", title: "Factory reset" } },
      },
    });

    const hits = await store.search({ workspaceId: WORKSPACE_ID, query: "Product A pair the USB dongle", knowledgeTypes: ["procedural"], productContext: PRODUCT_A, limit: 5 });

    expect(hits[0].record.sourceId).toBe("pairing");
    expect(hits[0].taskSpecificity).toBe("sufficient");
  });

  it("D: firmware wording outranks connection wording without changing semantic scores", async () => {
    const hits = await (await competingProcedures()).search({ workspaceId: WORKSPACE_ID, query: "Product A firmware update", knowledgeTypes: ["procedural"], productContext: PRODUCT_A, limit: 5 });
    expect(hits[0].record.sourceId).toBe("firmware");
    expect(hits[0].score).toBeGreaterThan(0);
    expect(hits[0].taskRelevance).toBeGreaterThan(hits.find((hit) => hit.record.sourceId === "connection")?.taskRelevance ?? 0);
  });

  it("E: an ambiguous request returns insufficient task signal instead of selecting a procedure", async () => {
    const store = new InMemoryKnowledgeStore();
    await ingest(store, "global-pairing", "USB dongle pairing", "Pair the headset and dongle.", { authority: "guidance" });
    await ingest(store, "global-interference", "USB dongle interference", "Check for interference around the dongle.", { authority: "guidance" });
    const hits = await store.search({ workspaceId: WORKSPACE_ID, query: "My USB dongle does not work", knowledgeTypes: ["procedural"], limit: 5 });
    expect(hits).toHaveLength(1);
    expect(hits[0].taskRelevance).toBe(0);

    const registry = createCapabilityRegistry({ tenant: { workspaceId: WORKSPACE_ID }, knowledge: store, commerce: commerce() });
    const result = await registry.execute("search_procedures", JSON.stringify({ query: "My USB dongle does not work" }));
    expect(result.data.task_specificity).toBe("insufficient");
  });

  it("fails closed when one product has several procedures but the task is broad", async () => {
    const store = await competingProcedures();
    const hits = await store.search({ workspaceId: WORKSPACE_ID, query: "My Product A is not working", knowledgeTypes: ["procedural"], productContext: PRODUCT_A, limit: 5 });
    expect(hits).toHaveLength(1);
    expect(hits[0].taskSpecificity).toBe("insufficient");
    expect(hits[0].procedureCandidates?.length).toBe(4);

    const registry = createCapabilityRegistry({ tenant: { workspaceId: WORKSPACE_ID }, knowledge: store, commerce: commerce() });
    const result = await registry.execute("search_procedures", JSON.stringify({ query: "My Product A is not working" }));
    expect(result.data.task_specificity).toBe("insufficient");
    expect(result.data.possible_tasks).toHaveLength(4);
    expect(result.data.results[0].structured_data).toMatchObject({ task_candidate_only: true });
    expect(result.data.results[0].structured_data).not.toHaveProperty("procedure_steps");
    expect(result.data.results[0].evidence_sections).toEqual([]);
  });

  it("fails closed for generic support wording even when retrieval returns a bundled procedure", async () => {
    const store = new InMemoryKnowledgeStore();
    await ingest(store, "bundled", "AceZone FAQ and support procedures", "Review the available support procedures for this product.", {
      structuredData: { applies_to: { product_models: ["Product A"] } },
    });
    const hits = await store.search({
      workspaceId: WORKSPACE_ID,
      query: "My Product A has a problem. Can you help me find the right support steps?",
      knowledgeTypes: ["procedural"],
      productContext: PRODUCT_A,
      limit: 5,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].taskSpecificity).toBe("insufficient");
  });

  it("clarifies when a retrieved specific procedure has no discriminating task term", async () => {
    const store = new InMemoryKnowledgeStore();
    await ingest(store, "only-procedure", "Product A reset", "Reset Product A.", {
      structuredData: { applies_to: { product_models: ["Product A"] } },
    });
    const hits = await store.search({ workspaceId: WORKSPACE_ID, query: "My Product A is not working", knowledgeTypes: ["procedural"], productContext: PRODUCT_A, limit: 5 });
    expect(hits).toHaveLength(1);
    expect(hits[0].taskSpecificity).toBe("insufficient");
  });

  it("keeps explicit task selection when only one eligible procedure is returned", async () => {
    const store = new InMemoryKnowledgeStore();
    await ingest(store, "only-procedure", "Product A reset", "Reset Product A.", {
      structuredData: { applies_to: { product_models: ["Product A"] } },
    });
    const hits = await store.search({ workspaceId: WORKSPACE_ID, query: "Product A factory reset", knowledgeTypes: ["procedural"], productContext: PRODUCT_A, limit: 5 });
    expect(hits[0].taskSpecificity).toBe("sufficient");
  });

  it("does not use a weak semantic tie between same-task candidates as a winner", async () => {
    const store = new InMemoryKnowledgeStore();
    await ingest(store, "connection-a", "Product A connection reset help", "Reconnect Product A.", {
      structuredData: { applies_to: { product_models: ["Product A"] } },
    });
    await ingest(store, "connection-b", "Product A connection pairing help", "Check the Product A connection and connectivity.", {
      structuredData: { applies_to: { product_models: ["Product A"] } },
    });
    const hits = await store.search({ workspaceId: WORKSPACE_ID, query: "Product A connection problem", knowledgeTypes: ["procedural"], productContext: PRODUCT_A, limit: 5 });
    expect(hits).toHaveLength(1);
    expect(hits[0].taskSpecificity).toBe("insufficient");
    expect(hits[0].procedureCandidates).toHaveLength(2);
  });

  it("uses customer aliases for task matching but omits them from procedural evidence", async () => {
    const store = new InMemoryKnowledgeStore();
    await ingest(store, "microphone", "Product A microphone diagnostics", "Check the input device.", {
      structuredData: {
        procedure: {
          task: { key: "microphone_troubleshooting", title: "Microphone troubleshooting" },
          aliases: ["nobody can hear me", "voice not detected"],
        },
      },
    });
    const hits = await store.search({ workspaceId: WORKSPACE_ID, query: "nobody can hear me", knowledgeTypes: ["procedural"], productContext: PRODUCT_A, limit: 5 });
    expect(hits[0].record.sourceId).toBe("microphone");
    expect(hits[0].taskRelevance).toBeGreaterThan(0);

    const registry = createCapabilityRegistry({ tenant: { workspaceId: WORKSPACE_ID }, knowledge: store, commerce: commerce() });
    const result = await registry.execute("search_procedures", JSON.stringify({ query: "nobody can hear me" }));
    expect(result.data.task_specificity).toBe("sufficient");
    expect(result.data.results[0].structured_data).not.toHaveProperty("procedure.aliases");
    expect(JSON.stringify(result.data.results[0].structured_data)).not.toContain("nobody can hear me");
  });

  it("turns a broad first turn into a specific procedure after task clarification", async () => {
    const store = new InMemoryKnowledgeStore();
    await ingest(store, "microphone", "Product A microphone diagnostics", "Check the input device.", {
      structuredData: {
        procedure: {
          task: { key: "microphone_troubleshooting", title: "Microphone troubleshooting" },
          aliases: ["nobody can hear me"],
        },
      },
    });
    await ingest(store, "reset", "Product A factory reset", "Factory reset Product A.", {
      structuredData: { applies_to: { product_models: ["Product A"] } },
    });
    const first = createCapabilityRegistry({
      tenant: { workspaceId: WORKSPACE_ID },
      knowledge: store,
      commerce: commerce(),
      conversationContext: { turn: 1, activeOrder: null, customerSignal: null, customerProvided: { product: "Product A", issue: "not working" } },
    });
    const firstResult = await first.execute("search_procedures", JSON.stringify({ query: "Product A" }));
    expect(firstResult.data.task_specificity).toBe("insufficient");

    const second = createCapabilityRegistry({
      tenant: { workspaceId: WORKSPACE_ID },
      knowledge: store,
      commerce: commerce(),
      conversationContext: { turn: 2, activeOrder: null, customerSignal: null, customerProvided: { product: "Product A", issue: "nobody can hear me" } },
    });
    const secondResult = await second.execute("search_procedures", JSON.stringify({ query: "nobody can hear me" }));
    expect(secondResult.data.task_specificity).toBe("sufficient");
    expect(secondResult.data.results[0].title).toContain("microphone");
  });

  it("keeps product correction separate from task specificity", async () => {
    const store = await competingProcedures();
    const registry = createCapabilityRegistry({
      tenant: { workspaceId: WORKSPACE_ID },
      knowledge: store,
      commerce: commerce(),
      conversationContext: { turn: 2, activeOrder: null, customerSignal: null, customerProvided: { product: "Product A", issue: "not working" } },
    });
    const result = await registry.execute("search_procedures", JSON.stringify({ query: "Product A" }));
    expect(result.data.task_specificity).toBe("insufficient");
  });

  it("uses the server-owned customer wording instead of a model-invented task query", async () => {
    const store = await competingProcedures();
    const registry = createCapabilityRegistry({
      tenant: { workspaceId: WORKSPACE_ID },
      knowledge: store,
      commerce: commerce(),
      customerMessage: "My Product A is not working",
    });
    const result = await registry.execute("search_procedures", JSON.stringify({ query: "Product A audio troubleshooting" }));
    expect(result.data.task_specificity).toBe("insufficient");
  });

  it("does not let unpublished procedure candidates contribute to specificity", async () => {
    const store = new InMemoryKnowledgeStore();
    await ingest(store, "draft", "Product A reset", "Reset Product A.", {
      metadata: { lifecycle_status: "draft" },
      structuredData: { applies_to: { product_models: ["Product A"] } },
    });
    await ingest(store, "archived", "Product A pairing", "Pair Product A.", {
      metadata: { lifecycle_status: "archived" },
      structuredData: { applies_to: { product_models: ["Product A"] } },
    });
    const hits = await store.search({ workspaceId: WORKSPACE_ID, query: "Product A reset", knowledgeTypes: ["procedural"], productContext: PRODUCT_A, limit: 5 });
    expect(hits).toEqual([]);
  });

  it("F: later clarification improves task-scoped retrieval", async () => {
    const store = await competingProcedures();
    const hits = await store.search({ workspaceId: WORKSPACE_ID, query: "Product A dongle will not pair with the headset", knowledgeTypes: ["procedural"], productContext: PRODUCT_A, limit: 5 });
    expect(hits[0].record.sourceId).toBe("pairing");
    expect(hits[0].taskRelevance).toBeGreaterThan(0);
  });

  it("G: product applicability still excludes the wrong product", async () => {
    const store = new InMemoryKnowledgeStore();
    await ingest(store, "product-a-reset", "Product A factory reset", "Factory reset Product A.", {
      metadata: { applies_to: { product_models: ["Product A"] } },
    });
    await ingest(store, "product-b-reset", "Product B factory reset", "Factory reset Product B.", {
      metadata: { applies_to: { product_models: ["Product B"] } },
    });
    const hits = await store.search({ workspaceId: WORKSPACE_ID, query: "factory reset", knowledgeTypes: ["procedural"], productContext: PRODUCT_A, limit: 5 });
    expect(hits.map((hit) => hit.record.sourceId)).toEqual(["product-a-reset"]);
  });

  it("H: global guidance does not crowd out an exact authoritative product task", async () => {
    const store = await competingProcedures();
    await ingest(store, "global-pairing", "General pairing help", "General pairing guidance for headsets.", { authority: "guidance" });
    const hits = await store.search({ workspaceId: WORKSPACE_ID, query: "Product A pair the USB dongle", knowledgeTypes: ["procedural"], productContext: PRODUCT_A, limit: 5 });
    expect(hits[0].record.sourceId).toBe("pairing");
    expect(hits[0].record.authority).toBe("authoritative");
  });

  it("I: lexical fallback recall can add an exact record without flooding final evidence", async () => {
    process.env.OPENAI_API_KEY = "test-key-for-stubbed-embedding";
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, async json() { return { data: [{ embedding: [0.1, 0.2] }] }; } })));
    const exact = {
      id: "exact",
      workspace_id: WORKSPACE_ID,
      knowledge_type: "procedural",
      authority: "authoritative",
      title: "Product A dongle connection",
      content: "Reconnect the dongle.",
      structured_data: { applies_to: { product_models: ["Product A"] } },
      source_kind: "merchant_authored",
      source_id: "exact",
      content_hash: "exact-hash",
      metadata: {},
      chunk_id: "chunk-exact",
      chunk_index: 0,
      chunk_content: "Product A dongle connection\n\nReconnect the dongle.",
      score: 0.7,
      match_reason: "semantic",
    };
    const related = ["interference", "reset"].map((sourceId, index) => ({
      ...exact,
      id: sourceId,
      source_id: sourceId,
      content_hash: `${sourceId}-hash`,
      chunk_id: `chunk-${sourceId}`,
      title: `Product A dongle ${sourceId}`,
      chunk_content: `Product A dongle ${sourceId}\n\nRelated ${sourceId}.`,
      score: 0.62 - index * 0.05,
    }));
    const rows = [exact, ...related];
    const client = {
      rpc: vi.fn(async (name) => name === "greenfield_search_knowledge_semantic" ? { data: rows, error: null } : { data: rows, error: null }),
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            in: async () => ({ data: rows.map((row) => ({ id: row.chunk_id, record_id: row.id, chunk_index: 0, content: row.chunk_content })), error: null }),
          }),
        }),
      })),
    };
    const hits = await new SupabaseKnowledgeStore(client).search({ workspaceId: WORKSPACE_ID, query: "Product A dongle connection", knowledgeTypes: ["procedural"], limit: 5 });
    expect(hits[0].record.sourceId).toBe("exact");
    expect(hits).toHaveLength(1);
    vi.unstubAllGlobals();
    delete process.env.OPENAI_API_KEY;
  });

  it("J: one strongly relevant record is selected alone", async () => {
    const hits = await (await competingProcedures()).search({ workspaceId: WORKSPACE_ID, query: "Product A firmware update", knowledgeTypes: ["procedural"], productContext: PRODUCT_A, limit: 5 });
    expect(hits.map((hit) => hit.record.sourceId)).toEqual(["firmware"]);
  });

  it("K: two complementary records may coexist when both match the requested task", async () => {
    const store = new InMemoryKnowledgeStore();
    await ingest(store, "pairing", "Pair the headset", "Pair the headset with the dongle.");
    await ingest(store, "reset", "Reset the headset", "Reset the headset, then pair it again.");
    const hits = await store.search({ workspaceId: WORKSPACE_ID, query: "How do I pair and reset the headset?", knowledgeTypes: ["procedural"], limit: 5 });
    expect(hits.map((hit) => hit.record.sourceId)).toEqual(expect.arrayContaining(["pairing", "reset"]));
    expect(hits).toHaveLength(2);
  });
});
