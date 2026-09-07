import { describe, expect, it } from "vitest";
import { cleanRawContent, InMemoryKnowledgeStore, isKnowledgeRecordApplicable, normalizeKnowledgeSource, selectEvidenceSections, SupabaseKnowledgeStore } from "../knowledge";

const PRODUCT_A = { workspaceId: "tenant-a", productId: "product-a", productModels: ["Product A"] };
const PRODUCT_B = { workspaceId: "tenant-a", productId: "product-b", productModels: ["Product B"] };

async function ingestScopedCorpus(store) {
  await store.ingest("tenant-a", {
    sourceKind: "procedure",
    sourceId: "global-procedure",
    title: "Global pairing procedure",
    content: "Shared pairing troubleshooting steps for every product.",
    authority: "guidance",
    sourceLabel: "Global help",
    metadata: { lifecycle_status: "published", applies_to: { kind: "all", product_ids: [] } },
  });
  await store.ingest("tenant-a", {
    sourceKind: "procedure",
    sourceId: "product-a-procedure",
    title: "Product A pairing procedure",
    content: "Shared pairing troubleshooting steps specifically for Product A.",
    authority: "authoritative",
    sourceLabel: "Product A manual",
    metadata: { lifecycle_status: "published", applies_to: { kind: "products", product_ids: ["product-a"] } },
  });
  await store.ingest("tenant-a", {
    sourceKind: "procedure",
    sourceId: "product-b-procedure",
    title: "Product B pairing procedure",
    content: "Shared pairing troubleshooting steps specifically for Product B.",
    authority: "authoritative",
    sourceLabel: "Product B manual",
    metadata: { lifecycle_status: "published", applies_to: { kind: "products", product_ids: ["product-b"] } },
  });
  await store.ingest("tenant-a", {
    sourceKind: "procedure",
    sourceId: "product-a-draft",
    title: "Product A draft procedure",
    content: "Shared pairing troubleshooting steps for Product A draft.",
    authority: "authoritative",
    metadata: { lifecycle_status: "draft", applies_to: { kind: "products", product_ids: ["product-a"] } },
  });
  await store.ingest("tenant-a", {
    sourceKind: "procedure",
    sourceId: "product-a-archived",
    title: "Product A archived procedure",
    content: "Shared pairing troubleshooting steps for Product A archived.",
    authority: "authoritative",
    metadata: { lifecycle_status: "archived", applies_to: { kind: "products", product_ids: ["product-a"] } },
  });
}

function queryBuilder(data, error = null) {
  const result = { data, error };
  const builder = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    in: () => builder,
    limit: () => builder,
    order: () => builder,
    maybeSingle: async () => result,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

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

  it("represents merchant-authored applicability as generic data", async () => {
    const record = await normalizeKnowledgeSource("tenant-a", {
      sourceKind: "merchant_authored",
      sourceId: "merchant-guide-1",
      title: "Wireless connection guide",
      content: "Disconnect the dongle, power on the headset, and pair the devices again.",
      sourceUri: "https://merchant.example.test/support/wireless",
      sourceLabel: "Merchant support guide",
      knowledgeType: "procedural",
      authority: "authoritative",
      publishedAt: "2026-09-01T00:00:00.000Z",
      metadata: {
        status: "published",
        authored_by: "merchant",
        origin: "merchant_authored",
        applies_to: { product_models: ["Example Wireless"] },
      },
    });

    expect(record.sourceKind).toBe("merchant_authored");
    expect(record.knowledgeType).toBe("procedural");
    expect(record.authority).toBe("authoritative");
    expect(record.metadata.applies_to).toEqual({ product_models: ["Example Wireless"] });
    expect(record.metadata.status).toBe("published");
    expect(record.contentHash).toMatch(/^[a-f0-9]{64}$/);
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

  it("excludes draft, unpublished, and archived merchant knowledge from retrieval", async () => {
    const store = new InMemoryKnowledgeStore();
    await store.ingest("tenant-a", {
      sourceKind: "merchant_authored",
      sourceId: "draft-guide",
      title: "Draft guide",
      content: "Draft pairing steps for the wireless receiver.",
      knowledgeType: "procedural",
      authority: "authoritative",
      metadata: { lifecycle_status: "draft" },
    });
    await store.ingest("tenant-a", {
      sourceKind: "merchant_authored",
      sourceId: "unpublished-guide",
      title: "Unpublished guide",
      content: "Unpublished pairing steps for the wireless receiver.",
      knowledgeType: "procedural",
      authority: "authoritative",
      metadata: { lifecycle_status: "unpublished" },
    });
    await store.ingest("tenant-a", {
      sourceKind: "merchant_authored",
      sourceId: "archived-guide",
      title: "Archived guide",
      content: "Archived pairing steps for the wireless receiver.",
      knowledgeType: "procedural",
      authority: "authoritative",
      metadata: { lifecycle_status: "archived" },
    });

    expect(await store.search({ workspaceId: "tenant-a", query: "pairing wireless receiver" })).toEqual([]);
  });

  it("makes published edits replace the old searchable content", async () => {
    const store = new InMemoryKnowledgeStore();
    await store.ingest("tenant-a", {
      sourceKind: "merchant_authored",
      sourceId: "published-guide",
      title: "Published guide",
      content: "Step one is to disconnect the old receiver.",
      knowledgeType: "procedural",
      authority: "authoritative",
      metadata: { lifecycle_status: "published" },
    });
    await store.replaceSource("tenant-a", "published-guide", {
      sourceKind: "merchant_authored",
      sourceId: "published-guide",
      title: "Published guide",
      content: "Step one is to restart the new receiver.",
      knowledgeType: "procedural",
      authority: "authoritative",
      metadata: { lifecycle_status: "published" },
    });

    expect(await store.search({ workspaceId: "tenant-a", query: "disconnect old" })).toEqual([]);
    expect((await store.search({ workspaceId: "tenant-a", query: "restart new receiver" }))[0].record.content).toContain("restart the new receiver");
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

  it("enforces generic applicability while preserving global and matching product knowledge", async () => {
    const store = new InMemoryKnowledgeStore();
    await ingestScopedCorpus(store);

    const hits = await store.search({
      workspaceId: "tenant-a",
      query: "shared pairing troubleshooting steps",
      productContext: PRODUCT_A,
      limit: 10,
    });

    expect(hits.map((hit) => hit.record.sourceId)).toEqual(["product-a-procedure", "global-procedure"]);
    expect(hits[0].record.authority).toBe("authoritative");
    expect(hits[1].record.sourceLabel).toBe("Global help");
  });

  it("hides product-scoped knowledge when the product is unknown or from another workspace", async () => {
    const store = new InMemoryKnowledgeStore();
    await ingestScopedCorpus(store);

    const unknownHits = await store.search({ workspaceId: "tenant-a", query: "shared pairing troubleshooting steps", limit: 10 });
    const crossWorkspaceHits = await store.search({
      workspaceId: "tenant-a",
      query: "shared pairing troubleshooting steps",
      productContext: { ...PRODUCT_A, workspaceId: "tenant-b" },
      limit: 10,
    });

    expect(unknownHits.map((hit) => hit.record.sourceId)).toEqual(["global-procedure"]);
    expect(crossWorkspaceHits.map((hit) => hit.record.sourceId)).toEqual(["global-procedure"]);
  });

  it("keeps lifecycle filtering ahead of applicability", async () => {
    const store = new InMemoryKnowledgeStore();
    await ingestScopedCorpus(store);
    const hits = await store.search({ workspaceId: "tenant-a", query: "shared pairing troubleshooting steps", productContext: PRODUCT_A, limit: 10 });

    expect(hits.map((hit) => hit.record.sourceId)).not.toContain("product-a-draft");
    expect(hits.map((hit) => hit.record.sourceId)).not.toContain("product-a-archived");
  });

  it("preserves legacy product_models and gives product_ids precedence", async () => {
    const legacy = await normalizeKnowledgeSource("tenant-a", {
      sourceKind: "procedure",
      sourceId: "legacy-a",
      title: "Legacy Product A procedure",
      content: "Product A legacy troubleshooting steps.",
      metadata: { applies_to: { product_models: ["Product A"] } },
    });
    const stronger = await normalizeKnowledgeSource("tenant-a", {
      sourceKind: "procedure",
      sourceId: "stronger-a",
      title: "Stronger identifier procedure",
      content: "Product A identifier troubleshooting steps.",
      metadata: { applies_to: { product_ids: ["product-b"], product_models: ["Product A"] } },
    });

    expect(isKnowledgeRecordApplicable(legacy, PRODUCT_A)).toBe(true);
    expect(isKnowledgeRecordApplicable(legacy, PRODUCT_B)).toBe(false);
    expect(isKnowledgeRecordApplicable(stronger, PRODUCT_A)).toBe(false);
  });

  it("uses a bounded larger semantic candidate pool before filtering", async () => {
    let rpcArguments;
    const rows = [
      { id: "b", workspace_id: "tenant-a", title: "Product B", content: "pairing", knowledge_type: "procedural", authority: "authoritative", source_kind: "procedure", source_id: "b", source_label: "B", metadata: { applies_to: { product_ids: ["product-b"] } }, score: 0.99, chunk_id: "b-chunk", chunk_index: 0, chunk_content: "Product B pairing" },
      { id: "a", workspace_id: "tenant-a", title: "Product A", content: "pairing", knowledge_type: "procedural", authority: "authoritative", source_kind: "procedure", source_id: "a", source_label: "A", metadata: { applies_to: { product_ids: ["product-a"] } }, score: 0.80, chunk_id: "a-chunk", chunk_index: 0, chunk_content: "Product A pairing" },
      { id: "global", workspace_id: "tenant-a", title: "Global", content: "pairing", knowledge_type: "procedural", authority: "guidance", source_kind: "procedure", source_id: "global", source_label: "Global", metadata: {}, score: 0.70, chunk_id: "global-chunk", chunk_index: 0, chunk_content: "Global pairing" },
    ];
    const serviceClient = {
      from(table) {
        if (table === "shops") return queryBuilder({ id: "shop-a" });
        if (table === "shop_products") return queryBuilder([{ id: "product-a", title: "Product A", handle: "product-a", external_id: "external-a" }]);
        if (table === "greenfield_knowledge_chunks") return queryBuilder(rows.map((row) => ({ id: row.chunk_id, record_id: row.id, chunk_index: 0, content: row.chunk_content })));
        throw new Error(`Unexpected table: ${table}`);
      },
      async rpc(_name, args) {
        rpcArguments = args;
        return { data: rows, error: null };
      },
    };
    const store = new SupabaseKnowledgeStore(serviceClient);
    store.embedQuery = async () => [0];

    const hits = await store.search({ workspaceId: "tenant-a", trustedShopId: "shop-a", query: "Product A pairing", knowledgeTypes: ["procedural"], limit: 1 });

    expect(rpcArguments.p_limit).toBe(4);
    expect(hits.map((hit) => hit.record.sourceId)).toEqual(["a"]);
  });
});
