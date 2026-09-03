import { describe, expect, it } from "vitest";
import { InMemoryKnowledgeStore } from "../knowledge";

describe("greenfield knowledge store", () => {
  it("keeps tenant retrieval deterministic and isolated", async () => {
    const store = new InMemoryKnowledgeStore();
    await store.ingest("tenant-a", {
      sourceKind: "policy",
      sourceId: "returns-a",
      title: "Returns",
      content: "Returns are accepted within 30 days of delivery.",
      sourceLabel: "Tenant A policy",
    });
    await store.ingest("tenant-b", {
      sourceKind: "policy",
      sourceId: "returns-b",
      title: "Returns",
      content: "Returns are accepted within 14 days of delivery.",
      sourceLabel: "Tenant B policy",
    });

    const hits = await store.search({ workspaceId: "tenant-a", query: "return window" });
    expect(hits).toHaveLength(1);
    expect(hits[0].record.content).toContain("30 days");
    expect(hits[0].record.sourceLabel).toBe("Tenant A policy");
  });

  it("deduplicates normalized source content and preserves provenance", async () => {
    const store = new InMemoryKnowledgeStore();
    const source = {
      sourceKind: "return_policy",
      sourceId: "returns-v1",
      title: "Returns",
      content: "Returns are accepted within 30 days of delivery.",
      sourceUri: "https://merchant.example.test/returns",
      structuredData: { return_window_days: 30 },
    };
    const first = await store.ingest("tenant-a", source);
    const second = await store.ingest("tenant-a", source);
    expect(second.id).toBe(first.id);
    expect(first.structuredData.return_window_days).toBe(30);
    expect(first.sourceUri).toContain("merchant.example.test");
    expect(first.chunks.length).toBeGreaterThan(0);
  });

  it("does not use live operational snapshots as stale knowledge", async () => {
    const store = new InMemoryKnowledgeStore();
    await store.ingest("tenant-a", {
      sourceKind: "operational_snapshot",
      sourceId: "order-1",
      title: "Order status",
      content: "Order 1 is delivered.",
    });
    expect(await store.search({ workspaceId: "tenant-a", query: "order delivered" })).toEqual([]);
  });
});
