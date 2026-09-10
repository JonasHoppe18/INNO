import { describe, expect, it } from "vitest";
import { SupabaseKnowledgeStore, normalizeKnowledgeSource } from "../knowledge";
import { buildShopifyKnowledgeSource } from "../../server/greenfield-shopify-source";

function fakeSupabase(initial = {}) {
  const state = {
    sources: [...(initial.sources || [])],
    records: [...(initial.records || [])],
    chunks: [...(initial.chunks || [])],
    nextRecord: 1,
    nextChunk: 1,
  };

  function matches(row, filters) {
    return Object.entries(filters).every(([key, value]) => String(row?.[key]) === String(value));
  }

  function builder(table) {
    const filters = {};
    let operation = "select";
    let payload = null;
    const query = {
      select() { return this; },
      eq(key, value) { filters[key] = value; return this; },
      order() { return this; },
      maybeSingle: async () => {
        const rows = state[table].filter((row) => matches(row, filters));
        return { data: rows[0] || null, error: null };
      },
      upsert(next) { operation = "upsert"; payload = next; return this; },
      update(next) { operation = "update"; payload = next; return this; },
      delete() { operation = "delete"; return this; },
      insert(next) { operation = "insert"; payload = next; return this; },
      single: async () => {
        const rows = state[table];
        if (operation === "upsert" || operation === "update") {
          const existing = rows.find((row) => table === "greenfield_knowledge_sources"
            ? row.workspace_id === payload.workspace_id && row.source_kind === payload.source_kind && row.source_id === payload.source_id
            : row.id === payload.id || (row.workspace_id === payload.workspace_id && row.source_id === payload.source_id && row.source_record_key === payload.source_record_key));
          if (existing) Object.assign(existing, payload);
          else rows.push({ ...payload, id: table === "greenfield_knowledge_sources" ? "source-1" : `record-${state.nextRecord++}` });
          return { data: existing || rows[rows.length - 1], error: null };
        }
        return { data: rows.find((row) => matches(row, filters)) || null, error: null };
      },
      then(resolve, reject) {
        if (operation === "delete") {
          state[table] = state[table].filter((row) => !matches(row, filters));
        } else if (operation === "insert") {
          const rows = Array.isArray(payload) ? payload : [payload];
          state[table].push(...rows.map((row) => ({ ...row, id: row.id || `${table}-chunk-${state.nextChunk++}` })));
        }
        return Promise.resolve({ data: state[table].filter((row) => matches(row, filters)), error: null }).then(resolve, reject);
      },
    };
    return query;
  }

  return {
    state,
    from(table) {
      const tableName = table === "greenfield_knowledge_sources"
        ? "sources"
        : table === "greenfield_knowledge_records"
          ? "records"
          : "chunks";
      return builder(tableName);
    },
  };
}

function source({ body = "Returns within 30 days.", observedAt = "2026-09-10T12:00:00.000Z" } = {}) {
  return buildShopifyKnowledgeSource({
    shopId: "shop-a",
    shopDomain: "store.example",
    observedAt,
    policies: [{ id: 1, title: "Returns", body }],
    products: [{ id: 2, title: "Headset", body: "Wireless audio." }],
  });
}

describe("Shopify -> Knowledge V1 persistence", () => {
  it("keeps first import draft, preserves source lifecycle, and re-syncs without duplicate chunks", async () => {
    const client = fakeSupabase();
    const store = new SupabaseKnowledgeStore(client);
    const first = await store.ingestSource("workspace-a", source());
    expect(first.records).toHaveLength(2);
    expect(client.state.sources).toHaveLength(1);
    expect(client.state.records).toHaveLength(2);
    expect(client.state.chunks).toHaveLength(2);
    expect(client.state.records.every((row) => row.metadata.lifecycle_status === "draft")).toBe(true);

    client.state.sources[0].status = "published";
    const same = await store.ingestSource("workspace-a", source());
    expect(same.sourceId).toBe(first.sourceId);
    expect(client.state.sources).toHaveLength(1);
    expect(client.state.sources[0].status).toBe("published");
    expect(client.state.records.map((row) => row.id)).toEqual(first.records.map((row) => row.id));
    expect(client.state.chunks).toHaveLength(2);
  });

  it("updates the same canonical Shopify records when source content changes", async () => {
    const client = fakeSupabase();
    const store = new SupabaseKnowledgeStore(client);
    const first = await store.ingestSource("workspace-a", source());
    const changed = await store.ingestSource("workspace-a", source({ body: "Returns within 60 days." }));

    expect(changed.records.map((row) => row.id)).toEqual(first.records.map((row) => row.id));
    expect(client.state.records.find((row) => row.source_record_key === "policy:1").content).toBe("Returns within 60 days.");
    expect(client.state.chunks).toHaveLength(2);
    expect(client.state.chunks.filter((chunk) => chunk.record_id === first.records[0].id)).toHaveLength(1);
  });

  it("does not adopt or modify a manual record with matching content", async () => {
    const manual = await normalizeKnowledgeSource("workspace-a", {
      sourceKind: "merchant_authored",
      sourceId: "merchant-ui:returns",
      title: "Manual returns",
      content: "Returns within 30 days.",
      knowledgeType: "policy",
      authority: "authoritative",
      metadata: { lifecycle_status: "published" },
    });
    const client = fakeSupabase({ records: [{ ...manual, id: "manual-1", content_hash: manual.contentHash, workspace_id: "workspace-a", source_id: manual.sourceId, source_kind: "merchant_authored", metadata: manual.metadata }] });
    const store = new SupabaseKnowledgeStore(client);
    const result = await store.ingestSource("workspace-a", source());

    expect(result.records.every((row) => row.id !== "manual-1")).toBe(true);
    expect(client.state.records.find((row) => row.id === "manual-1").source_id).toBe("merchant-ui:returns");
    expect(client.state.records.find((row) => row.id === "manual-1").metadata.lifecycle_status).toBe("published");
  });

  it("keeps another workspace outside the Shopify source scope", async () => {
    const client = fakeSupabase({ sources: [{ id: "other-source", workspace_id: "workspace-b", source_kind: "shopify", source_id: "shopify:shop-a", status: "published" }] });
    const store = new SupabaseKnowledgeStore(client);
    await store.ingestSource("workspace-a", source());

    expect(client.state.sources).toHaveLength(2);
    expect(client.state.sources.find((row) => row.workspace_id === "workspace-b").status).toBe("published");
  });
});
