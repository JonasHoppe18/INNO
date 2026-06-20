require("sucrase/register/ts-legacy-module-interop");

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  PRODUCT_SUPPORT_DOCUMENT_TEMPLATE,
  RETURNS_DOCUMENT_TEMPLATE,
  defaultKnowledgeDocument,
  getKnowledgeDocument,
  saveKnowledgeDocumentDraft,
  publishKnowledgeDocument,
} = require("../apps/web/lib/server/knowledge-doc-service.ts");
const {
  PRODUCT_SUPPORT_CATEGORY,
  productScopeForProduct,
  productSupportDocumentTypeForScope,
  productScopeFromDocumentType,
  isProductSupportDocument,
} = require("../apps/web/lib/knowledge/product-support.js");
const {
  buildKnowledgeDocumentPreviewPayload,
  buildKnowledgeDocumentSimulationHref,
} = require("../apps/web/lib/knowledge/knowledge-doc-preview-actions.js");

function makeClient(seed = {}) {
  const db = {
    knowledge_documents: [...(seed.knowledge_documents || [])],
    agent_knowledge: [...(seed.agent_knowledge || [])],
    saved_replies: [...(seed.saved_replies || [])],
  };
  let nextDoc = 1;
  let nextKnowledge = 1;

  const matches = (row, filters) => filters.every(({ key, value }) => {
    if (key.startsWith("metadata->>")) {
      const metaKey = key.slice("metadata->>".length);
      return String(row.metadata?.[metaKey] ?? "") === String(value);
    }
    return row[key] === value;
  });

  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.limitCount = null;
      this.operation = "select";
      this.payload = null;
    }
    select() { return this; }
    eq(key, value) { this.filters.push({ key, value }); return this; }
    limit(count) { this.limitCount = count; return this; }
    maybeSingle() { this.singleMode = "maybe"; return this; }
    single() { this.singleMode = "single"; return this; }
    upsert(payload) { this.operation = "upsert"; this.payload = payload; return this; }
    update(payload) { this.operation = "update"; this.payload = payload; return this; }
    delete() { this.operation = "delete"; return this; }
    insert(payload) { this.operation = "insert"; this.payload = payload; return this; }
    then(resolve) { return Promise.resolve(this.execute()).then(resolve); }
    execute() {
      const table = db[this.table];
      if (!table) return { data: null, error: { message: `unknown table ${this.table}` } };

      if (this.operation === "upsert") {
        const incoming = { ...this.payload };
        let row = table.find((r) =>
          r.shop_id === incoming.shop_id &&
          r.category === incoming.category &&
          r.document_type === incoming.document_type
        );
        if (row) {
          Object.assign(row, incoming);
        } else {
          row = {
            id: `doc-${nextDoc++}`,
            published_markdown: "",
            metadata: {},
            published_at: null,
            ...incoming,
          };
          table.push(row);
        }
        return { data: row, error: null };
      }

      if (this.operation === "update") {
        const rows = table.filter((r) => matches(r, this.filters));
        for (const row of rows) Object.assign(row, this.payload);
        return { data: rows[0] || null, error: null };
      }

      if (this.operation === "delete") {
        db[this.table] = table.filter((r) => !matches(r, this.filters));
        return { data: null, error: null };
      }

      if (this.operation === "insert") {
        const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
        for (const row of rows) {
          table.push({ id: row.id ?? nextKnowledge++, ...row });
        }
        return { data: rows, error: null };
      }

      let rows = table.filter((r) => matches(r, this.filters));
      if (this.limitCount != null) rows = rows.slice(0, this.limitCount);
      if (this.singleMode) return { data: rows[0] || null, error: null };
      return { data: rows, error: null };
    }
  }

  return {
    db,
    from(table) { return new Query(table); },
  };
}

const embedder = async () => [0, 1, 2];

const docMarkdown = `## Product overview
A wireless gaming headset.

## Microphone troubleshooting
Set the mic format to 48000Hz.

## My own custom section
Custom troubleshooting content.`;

test("product scope helpers build stable identifiers", () => {
  assert.equal(productScopeForProduct({ externalId: "9114609942851" }), "product-9114609942851");
  assert.equal(productScopeForProduct({ title: "A-Spire Wireless" }), "a-spire-wireless");
  assert.equal(
    productSupportDocumentTypeForScope("product-9114609942851"),
    "product_support:product-9114609942851",
  );
  assert.equal(
    productScopeFromDocumentType("product_support:product-9114609942851"),
    "product-9114609942851",
  );
  assert.equal(productScopeFromDocumentType("returns_refunds"), "");
  assert.equal(
    isProductSupportDocument({ category: "product_support", documentType: "product_support:x" }),
    true,
  );
  assert.equal(
    isProductSupportDocument({ category: "product_support", documentType: "product_support" }),
    false,
  );
  assert.throws(() => productScopeForProduct({}));
});

test("starter template is empty — no predefined headings inserted", () => {
  assert.equal(PRODUCT_SUPPORT_DOCUMENT_TEMPLATE, "");
  for (const heading of [
    "## Product overview",
    "## Microphone troubleshooting",
    "## Bluetooth pairing",
    "## Firmware update",
    "## Reset instructions",
    "## Charging issues",
    "## Serial number location",
    "## When to escalate for further review",
    "## Internal guidance",
  ]) {
    assert.equal(PRODUCT_SUPPORT_DOCUMENT_TEMPLATE.includes(heading), false, `unexpected ${heading}`);
  }
});

test("GET missing product-support doc opens empty without inserting a row", async () => {
  const client = makeClient();
  const result = await getKnowledgeDocument({
    serviceClient: client,
    shopId: "shop-1",
    category: PRODUCT_SUPPORT_CATEGORY,
    documentType: "product_support:product-1",
  });
  assert.equal(result.document.id, null);
  assert.equal(result.document.draft_markdown, "");
  assert.equal(result.parsed_sections.length, 0);
  assert.equal(client.db.knowledge_documents.length, 0);
});

test("existing saved product-support Markdown loads unchanged (template does not override)", async () => {
  const saved = "## Existing custom heading\nSaved content.";
  const client = makeClient({
    knowledge_documents: [
      {
        id: "doc-existing",
        shop_id: "shop-1",
        category: PRODUCT_SUPPORT_CATEGORY,
        document_type: "product_support:product-1",
        title: "Product Support",
        draft_markdown: saved,
        published_markdown: "",
        has_unpublished_changes: true,
        published_at: null,
        metadata: {},
      },
    ],
  });
  const result = await getKnowledgeDocument({
    serviceClient: client,
    shopId: "shop-1",
    category: PRODUCT_SUPPORT_CATEGORY,
    documentType: "product_support:product-1",
  });
  assert.equal(result.document.id, "doc-existing");
  assert.equal(result.document.draft_markdown, saved);
  assert.equal(result.parsed_sections.length, 1);
  assert.equal(result.parsed_sections[0].section_key, "existing_custom_heading");
});

test("default document for unscoped product_support type is not treated as product-support", () => {
  const doc = defaultKnowledgeDocument(PRODUCT_SUPPORT_CATEGORY, "product_support");
  // Unscoped falls through to the generic default, not the empty product-support template.
  assert.equal(doc.draft_markdown, "# Knowledge Document\n\n## Overview");
});

test("new product-support default document opens empty", () => {
  const doc = defaultKnowledgeDocument(PRODUCT_SUPPORT_CATEGORY, "product_support:product-1");
  assert.equal(doc.draft_markdown, "");
});

test("save requires a product-scoped document_type for product_support", async () => {
  const client = makeClient();
  await assert.rejects(
    saveKnowledgeDocumentDraft({
      serviceClient: client,
      embedder,
      shopId: "shop-1",
      category: PRODUCT_SUPPORT_CATEGORY,
      documentType: "product_support",
      title: "Product Support",
      draftMarkdown: docMarkdown,
    }),
    /product-scoped document_type/,
  );
});

test("save is idempotent — one doc per shop + product scope, custom H2 supported", async () => {
  const client = makeClient();
  const first = await saveKnowledgeDocumentDraft({
    serviceClient: client,
    embedder,
    shopId: "shop-1",
    category: PRODUCT_SUPPORT_CATEGORY,
    documentType: "product_support:product-9114609942851",
    title: "A-Spire Wireless — Product Support",
    draftMarkdown: docMarkdown,
  });
  const second = await saveKnowledgeDocumentDraft({
    serviceClient: client,
    embedder,
    shopId: "shop-1",
    category: PRODUCT_SUPPORT_CATEGORY,
    documentType: "product_support:product-9114609942851",
    title: "A-Spire Wireless — Product Support",
    draftMarkdown: `${docMarkdown}\nMore.`,
  });

  assert.equal(client.db.knowledge_documents.length, 1);
  assert.equal(first.document.id, second.document.id);
  // Custom heading parsed as its own section.
  assert.ok(second.parsed_sections.some((s) => s.section_key === "my_own_custom_section"));
});

test("preview chunks carry product scope and stay inactive", async () => {
  const client = makeClient();
  await saveKnowledgeDocumentDraft({
    serviceClient: client,
    embedder,
    shopId: "shop-1",
    category: PRODUCT_SUPPORT_CATEGORY,
    documentType: "product_support:product-9114609942851",
    title: "A-Spire Wireless — Product Support",
    draftMarkdown: docMarkdown,
  });

  const chunks = client.db.agent_knowledge.filter((r) => r.source_provider === "knowledge_document");
  assert.equal(chunks.length, 3);
  chunks.forEach((chunk, index) => {
    assert.equal(chunk.shop_id, "shop-1");
    assert.equal(chunk.metadata.category, "product_support");
    assert.equal(chunk.metadata.document_type, "product_support");
    assert.equal(chunk.metadata.product_scope, "product-9114609942851");
    assert.equal(chunk.metadata.environment, "preview");
    assert.equal(chunk.metadata.active_for_ai, false);
    assert.equal(chunk.metadata.runtime_activation_pending, undefined);
    assert.equal(typeof chunk.metadata.document_id, "string");
    assert.equal(typeof chunk.metadata.section_key, "string");
    assert.equal(typeof chunk.metadata.section_heading, "string");
    assert.equal(chunk.metadata.section_order, index);
  });
});

test("no cross-product and no cross-shop mixing", async () => {
  const client = makeClient();
  const save = (shopId, scope) => saveKnowledgeDocumentDraft({
    serviceClient: client,
    embedder,
    shopId,
    category: PRODUCT_SUPPORT_CATEGORY,
    documentType: `product_support:${scope}`,
    title: `${scope} — Product Support`,
    draftMarkdown: docMarkdown,
  });

  const a = await save("shop-1", "product-a");
  const b = await save("shop-1", "product-b");
  const c = await save("shop-2", "product-a");

  assert.equal(client.db.knowledge_documents.length, 3);
  assert.notEqual(a.document.id, b.document.id);
  assert.notEqual(a.document.id, c.document.id);

  // Re-saving product-a on shop-1 must not touch product-b or shop-2 chunks.
  await save("shop-1", "product-a");
  const byDoc = (docId) => client.db.agent_knowledge.filter((r) => r.metadata?.document_id === docId);
  assert.equal(byDoc(a.document.id).length, 3);
  assert.equal(byDoc(b.document.id).length, 3);
  assert.equal(byDoc(c.document.id).length, 3);
  for (const chunk of byDoc(b.document.id)) {
    assert.equal(chunk.metadata.product_scope, "product-b");
    assert.equal(chunk.shop_id, "shop-1");
  }
  for (const chunk of byDoc(c.document.id)) {
    assert.equal(chunk.shop_id, "shop-2");
  }
});

test("save leaves legacy snippets and saved replies untouched (no archive/delete)", async () => {
  const client = makeClient({
    agent_knowledge: [
      {
        id: 901,
        shop_id: "shop-1",
        source_provider: "manual_text",
        metadata: { category: "product-questions", snippet_id: "legacy-1" },
      },
      {
        id: 902,
        shop_id: "shop-1",
        source_provider: "saved_reply",
        metadata: { snippet_id: "macro-1" },
      },
    ],
    saved_replies: [{ id: "macro-1", title: "Pairing macro" }],
  });
  await saveKnowledgeDocumentDraft({
    serviceClient: client,
    embedder,
    shopId: "shop-1",
    category: PRODUCT_SUPPORT_CATEGORY,
    documentType: "product_support:product-a",
    title: "Product Support",
    draftMarkdown: docMarkdown,
  });
  assert.equal(client.db.agent_knowledge.filter((r) => r.source_provider === "manual_text").length, 1);
  assert.equal(client.db.agent_knowledge.filter((r) => r.source_provider === "saved_reply").length, 1);
  assert.equal(client.db.saved_replies.length, 1);
});

test("product-support documents can be published into active, product-scoped production chunks", async () => {
  const client = makeClient({
    knowledge_documents: [
      {
        id: "doc-1",
        shop_id: "shop-1",
        category: PRODUCT_SUPPORT_CATEGORY,
        document_type: "product_support:product-a",
        title: "Product Support",
        draft_markdown: docMarkdown,
        published_markdown: "",
        has_unpublished_changes: true,
        published_at: null,
        metadata: {},
      },
    ],
  });

  const result = await publishKnowledgeDocument({
    serviceClient: client,
    embedder,
    shopId: "shop-1",
    category: PRODUCT_SUPPORT_CATEGORY,
    documentType: "product_support:product-a",
  });

  assert.equal(result.document.published_markdown, docMarkdown);
  assert.equal(result.document.has_unpublished_changes, false);
  assert.ok(result.document.published_at);

  const productionChunks = client.db.agent_knowledge.filter(
    (r) => r.source_provider === "knowledge_document" && r.metadata?.environment === "production",
  );
  // Three draft sections => three production chunks, all live and product-scoped.
  assert.equal(productionChunks.length, 3);
  assert.ok(productionChunks.every((r) => r.metadata?.active_for_ai === true));
  assert.ok(productionChunks.every((r) => r.metadata?.runtime_activation_pending === undefined));
  assert.ok(productionChunks.every((r) => r.metadata?.document_type === "product_support"));
  assert.ok(productionChunks.every((r) => r.metadata?.product_scope === "product-a"));
});

test("ticket preview payload and simulation href pass the document id", () => {
  const payload = buildKnowledgeDocumentPreviewPayload({ documentId: "doc-9", threadId: "t-1" });
  assert.deepEqual(payload, { preview_document_id: "doc-9", thread_id: "t-1" });
  assert.equal(
    buildKnowledgeDocumentSimulationHref("doc-9"),
    "/knowledge/simulate?preview_document_id=doc-9",
  );
});

test("Returns & Refunds flow is unchanged by product-support additions", async () => {
  assert.ok(RETURNS_DOCUMENT_TEMPLATE.startsWith("## Return window"));
  const client = makeClient();
  const result = await saveKnowledgeDocumentDraft({
    serviceClient: client,
    embedder,
    shopId: "shop-1",
    category: "returns",
    documentType: "returns_refunds",
    title: "Returns & Refunds",
    draftMarkdown: "## Return window\n30 days.",
  });
  const chunk = client.db.agent_knowledge.find((r) => r.source_provider === "knowledge_document");
  assert.equal(result.document.category, "returns");
  assert.equal(chunk.metadata.document_type, "returns_refunds");
  assert.equal(chunk.metadata.product_scope, undefined);
  assert.equal(chunk.metadata.environment, "preview");
  assert.equal(chunk.metadata.active_for_ai, false);
});
