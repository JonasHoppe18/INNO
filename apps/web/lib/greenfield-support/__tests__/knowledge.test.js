import { describe, expect, it } from "vitest";
import { cleanRawContent, InMemoryKnowledgeStore, isKnowledgeRecordApplicable, normalizeKnowledgeSource, normalizeKnowledgeSourceDocument, parseProcedureBlocks, selectEvidenceSections, splitMarkdownKnowledgeSource, SupabaseKnowledgeStore } from "../knowledge";

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
  it("preserves ordered semantic procedure blocks and critical source values", async () => {
    const blocks = parseProcedureBlocks([
      "## Factory reset",
      "Prerequisite: Connect the USB-C cable.",
      "1. Hold the power button for at least 15 seconds.",
      "Note: The LED stays purple.",
      "If the prompt says \"Reset complete\", continue.",
      "Expected result: Saved Bluetooth connections are deleted.",
    ].join("\n"));
    expect(blocks.map((block) => block.kind)).toEqual(["heading", "prerequisite", "instruction", "note", "condition", "expected_result"]);
    expect(blocks[2].text).toContain("15 seconds");
    expect(blocks[3].text).toContain("LED stays purple");
    expect(blocks[4].text).toContain("Reset complete");

    const record = await normalizeKnowledgeSource("tenant-a", {
      sourceKind: "procedure",
      sourceId: "manual-1",
      sourceRecordKey: "factory-reset",
      sourceVersion: 2,
      sourceContentHash: "source-hash",
      title: "Factory reset",
      content: "The source content remains canonical.",
      knowledgeType: "procedural",
      authority: "authoritative",
      structuredData: { procedure_blocks: blocks },
      taskKey: "factory_reset",
      customerAliases: ["reset my headset"],
    });
    expect(record.content).toBe("The source content remains canonical.");
    expect(record.sourceVersion).toBe(2);
    expect(record.structuredData.procedure_steps).toEqual(blocks);
    expect(record.structuredData.procedure.task.key).toBe("factory_reset");
  });

  it("supports one source producing multiple focused candidates without product collision", async () => {
    const candidates = splitMarkdownKnowledgeSource({
      title: "A-Spire Wireless manual",
      content: "## Factory reset\n\nHold power for 15 seconds.\n\n## Microphone troubleshooting\n\nCheck the input device and permissions.",
      knowledgeType: "procedural",
      authority: "authoritative",
    });
    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.recordKey)).toEqual(["section-1-factory_reset", "section-2-microphone_troubleshooting"]);

    const normalized = await normalizeKnowledgeSourceDocument("tenant-a", {
      sourceKind: "document",
      sourceId: "spire-manual-v1",
      title: "A-Spire Wireless manual",
      content: "## Factory reset\n\nHold power for 15 seconds.\n\n## Microphone troubleshooting\n\nCheck the input device and permissions.",
      candidates,
    });
    expect(normalized.records).toHaveLength(2);
    expect(normalized.records.map((record) => record.sourceRecordKey)).toEqual(["section-1-factory_reset", "section-2-microphone_troubleshooting"]);
    expect(normalized.records.every((record) => record.sourceContentHash === normalized.sourceContentHash)).toBe(true);
  });

  it("supports one source producing mixed canonical knowledge types", async () => {
    const normalized = await normalizeKnowledgeSourceDocument("tenant-a", {
      sourceKind: "merchant_manual",
      sourceId: "mixed-manual-v1",
      title: "Coffee Machine X manual",
      content: "## Product overview\n\n## Descale\n\nRun the descale cycle.",
      candidates: [
        {
          recordKey: "product-overview",
          title: "Coffee Machine X — Product overview",
          content: "Coffee Machine X supports the approved descale cycle.",
          knowledgeType: "product",
          authority: "reference",
          sourceLocation: { section: "Product overview", order: 0 },
        },
        {
          recordKey: "descale",
          title: "Coffee Machine X — Descale",
          content: "Run the descale cycle.",
          knowledgeType: "procedural",
          authority: "authoritative",
          structuredData: { applies_to: { product_models: ["Coffee Machine X"] } },
          sourceLocation: { section: "Descale", order: 1 },
          taskKey: "descale",
        },
      ],
    });

    expect(normalized.records).toHaveLength(2);
    expect(normalized.records.map((record) => record.knowledgeType)).toEqual(["product", "procedural"]);
    expect(normalized.records.every((record) => record.sourceId === "mixed-manual-v1")).toBe(true);
    expect(normalized.records.every((record) => record.sourceContentHash === normalized.sourceContentHash)).toBe(true);
    expect(normalized.records[1].structuredData.procedure.task.key).toBe("descale");
  });

  it("splits a multi-topic policy source into independently retrievable records", async () => {
    const store = new InMemoryKnowledgeStore();
    const sourceContent = [
      "# Store policies",
      "## Return window",
      "Unused items may be returned within 30 days of delivery.",
      "## Opened product eligibility",
      "Opened products may be inspected before a refund is approved.",
      "## Return shipping",
      "Customers arrange return shipping unless the policy says otherwise.",
      "## Refund timing",
      "Approved refunds are issued after inspection.",
    ].join("\n\n");
    const candidates = splitMarkdownKnowledgeSource({
      title: "Store policies",
      content: sourceContent,
      knowledgeType: "policy",
      authority: "authoritative",
    }).map((candidate) => ({
      ...candidate,
      metadata: { ...candidate.metadata, lifecycle_status: "published" },
    }));
    const result = await store.ingestSource("tenant-a", {
      sourceKind: "policy_document",
      sourceId: "store-policies-v1",
      title: "Store policies",
      content: sourceContent,
      candidates,
    });

    expect(result.records).toHaveLength(4);
    expect(result.records.every((record) => record.knowledgeType === "policy")).toBe(true);
    expect(new Set(result.records.map((record) => record.sourceId))).toEqual(new Set(["store-policies-v1"]));
    expect(new Set(result.records.map((record) => record.sourceContentHash)).size).toBe(1);
    const refund = await store.search({ workspaceId: "tenant-a", query: "refund inspection", knowledgeTypes: ["policy"], limit: 3 });
    expect(refund[0].record.title).toContain("Refund timing");
    expect(refund[0].record.content).toContain("after inspection");
  });

  it("keeps multiple procedures for one product distinct and asks retrieval to follow the task", async () => {
    const store = new InMemoryKnowledgeStore();
    const sourceCandidates = splitMarkdownKnowledgeSource({ title: "A-Spire Wireless manual", content: "## Factory reset\n\nHold power for 15 seconds.\n\n## Microphone troubleshooting\n\nCheck the microphone input device.", knowledgeType: "procedural", authority: "authoritative" })
      .map((candidate) => ({ ...candidate, metadata: { ...candidate.metadata, lifecycle_status: "published" } }));
    await store.ingestSource("tenant-a", {
      sourceKind: "document",
      sourceId: "spire-manual",
      title: "A-Spire Wireless manual",
      content: "## Factory reset\n\nHold power for 15 seconds.\n\n## Microphone troubleshooting\n\nCheck the microphone input device.",
      candidates: sourceCandidates,
    });
    const mic = await store.search({ workspaceId: "tenant-a", query: "A-Spire Wireless microphone not working", knowledgeTypes: ["procedural"], limit: 2 });
    expect(mic[0].record.title).toContain("Microphone troubleshooting");
    expect(mic[0].record.structuredData.procedure.task.key).toBe("microphone_troubleshooting");
  });

  it("works for a synthetic non-AceZone merchant with many product tasks", async () => {
    const store = new InMemoryKnowledgeStore();
    const sourceTitle = "Generic Home Store support manual";
    const sourceContent = [
      "## Descale",
      "Run the descale cycle with the approved solution.",
      "## Grinder blocked",
      "1. Switch the machine off.",
      "2. Clear the grinder channel.",
      "Warning: Do not insert tools while the machine is powered.",
      "## Water not heating",
      "Condition: If the machine has power but the water stays cold.",
      "Run the heating diagnostic and check the reservoir.",
      "## Cleaning cycle",
      "Run the cleaning cycle after removing the filter.",
      "## Pair remote",
      "Hold the remote pairing button for five seconds.",
    ].join("\n\n");
    const candidates = splitMarkdownKnowledgeSource({
      title: sourceTitle,
      content: sourceContent,
      knowledgeType: "procedural",
      authority: "authoritative",
    }).map((candidate) => ({
      ...candidate,
      metadata: {
        ...candidate.metadata,
        lifecycle_status: "published",
        applies_to: {
          product_models: candidate.title.includes("Pair remote") ? ["Desk Lamp Y"] : ["Coffee Machine X"],
        },
      },
    }));
    const first = await store.ingestSource("generic-home-store", {
      sourceKind: "merchant_manual",
      sourceId: "generic-support-manual",
      title: sourceTitle,
      content: sourceContent,
      candidates,
    });

    expect(first.records).toHaveLength(5);
    expect(new Set(first.records.map((record) => record.sourceRecordKey)).size).toBe(5);

    const coffeeContext = { workspaceId: "generic-home-store", productId: "coffee-x", productModels: ["Coffee Machine X"] };
    const grinder = await store.search({ workspaceId: "generic-home-store", query: "My Coffee Machine X grinder is blocked", knowledgeTypes: ["procedural"], productContext: coffeeContext, limit: 3 });
    expect(grinder[0].record.title).toContain("Grinder blocked");
    expect(grinder[0].taskSpecificity).toBe("sufficient");

    const descale = await store.search({ workspaceId: "generic-home-store", query: "How do I descale Coffee Machine X?", knowledgeTypes: ["procedural"], productContext: coffeeContext, limit: 3 });
    expect(descale[0].record.title).toContain("Descale");

    const ambiguous = await store.search({ workspaceId: "generic-home-store", query: "My Coffee Machine X isn't working", knowledgeTypes: ["procedural"], productContext: coffeeContext, limit: 5 });
    expect(ambiguous).toHaveLength(1);
    expect(ambiguous[0].taskSpecificity).toBe("insufficient");
    expect(ambiguous[0].procedureCandidates.length).toBeGreaterThan(1);
    expect(new Set(ambiguous[0].procedureCandidates.map((candidate) => candidate.taskKey))).toEqual(new Set([
      "descale",
      "grinder_blocked",
      "water_not_heating",
      "cleaning_cycle",
    ]));

    const wrongProduct = await store.search({
      workspaceId: "generic-home-store",
      query: "Coffee Machine X pair remote",
      knowledgeTypes: ["procedural"],
      productContext: coffeeContext,
      limit: 5,
    });
    expect(wrongProduct.map((hit) => hit.record.title)).not.toContain("Pair remote");

    const lampContext = { workspaceId: "generic-home-store", productId: "lamp-y", productModels: ["Desk Lamp Y"] };
    const lamp = await store.search({ workspaceId: "generic-home-store", query: "Desk Lamp Y pair remote", knowledgeTypes: ["procedural"], productContext: lampContext, limit: 3 });
    expect(lamp[0].record.title).toContain("Pair remote");
    expect(lamp.map((hit) => hit.record.title)).not.toContain("Grinder blocked");

    const foreignWorkspace = await store.search({ workspaceId: "other-workspace", query: "Coffee Machine X grinder blocked", knowledgeTypes: ["procedural"], productContext: { ...coffeeContext, workspaceId: "other-workspace" }, limit: 5 });
    expect(foreignWorkspace).toEqual([]);
  });

  it("keeps source refreshes identifiable and never deletes a removed published candidate", async () => {
    const store = new InMemoryKnowledgeStore();
    const source = (content) => ({
      sourceKind: "merchant_manual",
      sourceId: "refreshable-manual",
      title: "Refreshable manual",
      content,
      candidates: splitMarkdownKnowledgeSource({ title: "Refreshable manual", content, knowledgeType: "procedural", authority: "authoritative" })
        .map((candidate) => ({ ...candidate, metadata: { ...candidate.metadata, lifecycle_status: "published" } })),
    });
    const original = await store.ingestSource("tenant-a", source("## A\n\nRun task A.\n\n## B\n\nRun task B."));
    const same = await store.ingestSource("tenant-a", source("## A\n\nRun task A.\n\n## B\n\nRun task B."));
    expect(same.records.map((record) => record.id)).toEqual(original.records.map((record) => record.id));

    const changed = await store.ingestSource("tenant-a", source("## A\n\nRun task A updated.\n\n## B\n\nRun task B."));
    const updatedA = changed.records.find((record) => record.sourceRecordKey === "section-1-a");
    expect(updatedA?.content).toContain("updated");
    const removed = await store.ingestSource("tenant-a", source("## A\n\nRun task A updated."));
    expect(removed.records).toHaveLength(1);
    const removedB = Array.from(store.records.values()).find((record) => record.sourceRecordKey === "section-2-b");
    expect(removedB?.metadata.lifecycle_status).toBe("unpublished");
    expect(removedB?.metadata.source_refresh_state).toBe("removed");
    const allB = await store.search({ workspaceId: "tenant-a", query: "task B", knowledgeTypes: ["procedural"], limit: 5 });
    expect(allB.map((hit) => hit.record.sourceRecordKey)).not.toContain("section-2-b");
  });

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

  it("updates merchant-authored lifecycle in place without duplicating chunks", async () => {
    let record = null;
    let chunks = [];
    let chunkInsertCount = 0;
    const serviceClient = {
      from(table) {
        if (table === "greenfield_knowledge_records") {
          const state = { operation: null, payload: null };
          const builder = {
            select() { return this; },
            eq() { return this; },
            maybeSingle: async () => ({ data: record, error: null }),
            upsert(payload) { state.operation = "upsert"; state.payload = payload; return this; },
            update(payload) { state.operation = "update"; state.payload = payload; return this; },
            single: async () => {
              record = { ...(record || {}), ...(state.payload || {}), id: record?.id || "record-1" };
              return { data: record, error: null };
            },
          };
          return builder;
        }
        if (table === "greenfield_knowledge_chunks") {
          const state = { payload: null };
          const builder = {
            select() { return this; },
            eq() { return this; },
            order() { return this; },
            insert(payload) { chunkInsertCount += 1; state.payload = payload; chunks = payload.map((chunk) => ({ ...chunk, id: `chunk-${chunk.chunk_index}`, embedding: [0] })); return Promise.resolve({ error: null }); },
            then(resolve, reject) { return Promise.resolve({ data: chunks, error: null }).then(resolve, reject); },
          };
          return builder;
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    };
    const store = new SupabaseKnowledgeStore(serviceClient);
    store.embedQuery = async () => [0];
    const source = {
      sourceKind: "merchant_authored",
      sourceId: "merchant-ui:lifecycle",
      title: "Lifecycle policy",
      content: "Customers can return items within 30 days.",
      knowledgeType: "policy",
      authority: "authoritative",
      metadata: { lifecycle_status: "draft" },
    };

    const draft = await store.ingest("tenant-a", source);
    const published = await store.ingest("tenant-a", { ...source, metadata: { lifecycle_status: "published" } });

    expect(draft.id).toBe("record-1");
    expect(published.id).toBe(draft.id);
    expect(record.metadata.lifecycle_status).toBe("published");
    expect(chunkInsertCount).toBe(1);
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
      { id: "b", workspace_id: "tenant-a", title: "Product B", content: "pairing", knowledge_type: "procedural", authority: "authoritative", source_kind: "procedure", source_id: "b", source_label: "B", metadata: { applies_to: { product_ids: ["external-b"] } }, score: 0.99, chunk_id: "b-chunk", chunk_index: 0, chunk_content: "Product B pairing" },
      { id: "a", workspace_id: "tenant-a", title: "Product A", content: "pairing", knowledge_type: "procedural", authority: "authoritative", source_kind: "procedure", source_id: "a", source_label: "A", metadata: { applies_to: { product_ids: ["external-a"] } }, score: 0.80, chunk_id: "a-chunk", chunk_index: 0, chunk_content: "Product A pairing" },
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
    expect(hits[0].record.metadata.applies_to.product_ids).toEqual(["external-a"]);
  });

  it("fails closed when the trusted catalog row has no external Shopify id", async () => {
    const row = {
      id: "scoped",
      workspace_id: "tenant-a",
      title: "Product A",
      content: "Product A pairing",
      knowledge_type: "procedural",
      authority: "authoritative",
      source_kind: "procedure",
      source_id: "scoped",
      source_label: "A",
      metadata: { applies_to: { product_ids: ["external-a"] } },
      score: 0.99,
      chunk_id: "scoped-chunk",
      chunk_index: 0,
      chunk_content: "Product A pairing",
    };
    const serviceClient = {
      from(table) {
        if (table === "shops") return queryBuilder({ id: "shop-a" });
        if (table === "shop_products") return queryBuilder([{ id: "product-a", title: "Product A", handle: "product-a" }]);
        if (table === "greenfield_knowledge_chunks") return queryBuilder([]);
        throw new Error(`Unexpected table: ${table}`);
      },
      async rpc() {
        return { data: [row], error: null };
      },
    };
    const store = new SupabaseKnowledgeStore(serviceClient);
    store.embedQuery = async () => [0];

    const hits = await store.search({ workspaceId: "tenant-a", trustedShopId: "shop-a", query: "Product A pairing", knowledgeTypes: ["procedural"], limit: 1 });

    expect(hits).toEqual([]);
  });
});
