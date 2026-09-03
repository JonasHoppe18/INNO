import { describe, expect, it } from "vitest";
import { cleanRawContent, InMemoryKnowledgeStore, selectEvidenceSections } from "../knowledge";

describe("greenfield knowledge store", () => {
  it("conservatively converts generic HTML into visible source text", () => {
    const cleaned = cleanRawContent(`
      <html><body>
        <header>Store navigation</header>
        <nav>Home Products Cart</nav>
        <main>
          <h1>Returns</h1>
          <p>Unused products may be returned within 30 days.</p>
          <ul><li>Contact support first.</li><li>Keep the original packaging.</li></ul>
          <table><tr><th>Region</th><th>Warranty</th></tr><tr><td>EU</td><td>2 years</td></tr></table>
          <div class="cookie-banner">Accept all cookies</div>
          <script>window.dataLayer = window.dataLayer || []; </script>
          <footer>Unrelated footer links</footer>
        </main>
      </body></html>
    `);

    expect(cleaned).toContain("Returns");
    expect(cleaned).toContain("Unused products may be returned within 30 days.");
    expect(cleaned).toContain("- Contact support first.");
    expect(cleaned).toContain("EU | 2 years");
    expect(cleaned).not.toContain("Store navigation");
    expect(cleaned).not.toContain("dataLayer");
    expect(cleaned).not.toContain("Accept all cookies");
    expect(cleaned).not.toContain("Unrelated footer links");
  });

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

  it("selects a bounded relevant section instead of widening an adjacent chunk window", () => {
    const sections = selectEvidenceSections([
      { chunkId: "chunk-0", chunkIndex: 0, content: "Overview\n\nA wireless headset for everyday gaming." },
      { chunkId: "chunk-1", chunkIndex: 1, content: "Compatibility\n\nPC, PlayStation 5, Xbox and Switch." },
      { chunkId: "chunk-2", chunkIndex: 2, content: "Reviews\n\nIndependent reviews from gaming press." },
    ], 0, "Is the headset compatible with PlayStation 5", 160);

    expect(sections.some((section) => section.content.includes("PlayStation 5"))).toBe(true);
    expect(sections.reduce((total, section) => total + section.content.length, 0)).toBeLessThanOrEqual(160);
    expect(sections.flatMap((section) => section.chunkIds)).not.toContain("chunk-2");
  });
});
