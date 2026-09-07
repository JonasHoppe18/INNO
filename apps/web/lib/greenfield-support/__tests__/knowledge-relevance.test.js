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
