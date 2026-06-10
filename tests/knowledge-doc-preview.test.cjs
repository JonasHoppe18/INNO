require("sucrase/register/ts-legacy-module-interop");

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  loadPreviewDocumentContext,
} = require("../apps/web/lib/server/knowledge-doc-preview.ts");

function makeClient(seed = {}) {
  const db = {
    knowledge_documents: [...(seed.knowledge_documents || [])],
    agent_knowledge: [...(seed.agent_knowledge || [])],
  };

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
    }
    select() { return this; }
    eq(key, value) {
      this.filters.push({ key, value });
      return this;
    }
    order() { return this; }
    maybeSingle() {
      this.singleMode = true;
      return this;
    }
    then(resolve) {
      const rows = (db[this.table] || []).filter((row) => matches(row, this.filters));
      const data = this.singleMode ? rows[0] || null : rows;
      return Promise.resolve({ data, error: null }).then(resolve);
    }
  }

  return {
    db,
    from(table) {
      return new Query(table);
    },
  };
}

function maybePreviewPayload(previewDocumentContext) {
  return {
    shop_id: "shop-1",
    email_data: { subject: "Return", body: "Can I return this?" },
    ...(previewDocumentContext ? { preview_document_context: previewDocumentContext } : {}),
  };
}

test("preview context is explicit and scoped by shop, document id, and preview environment", async () => {
  const client = makeClient({
    knowledge_documents: [{ id: "doc-1", shop_id: "shop-1" }],
    agent_knowledge: [
      {
        id: 1,
        shop_id: "shop-1",
        source_provider: "knowledge_document",
        content: "Preview A",
        metadata: { document_id: "doc-1", environment: "preview", active_for_ai: false, section_heading: "Return window", section_order: 1 },
      },
      {
        id: 4,
        shop_id: "shop-1",
        source_provider: "knowledge_document",
        content: "Preview B",
        metadata: { document_id: "doc-1", environment: "preview", active_for_ai: false, section_heading: "Return shipping", section_order: 0 },
      },
      {
        id: 2,
        shop_id: "shop-1",
        source_provider: "knowledge_document",
        content: "Production A",
        metadata: { document_id: "doc-1", environment: "production", section_heading: "Return window" },
      },
      {
        id: 3,
        shop_id: "shop-2",
        source_provider: "knowledge_document",
        content: "Other shop",
        metadata: { document_id: "doc-1", environment: "preview", section_heading: "Other" },
      },
    ],
  });

  const context = await loadPreviewDocumentContext({
    serviceClient: client,
    shopId: "shop-1",
    documentId: "doc-1",
  });

  assert.equal(context.requested, true);
  assert.equal(context.document_id, "doc-1");
  assert.deepEqual(context.chunk_ids, ["4", "1"]);
  assert.deepEqual(context.section_headings, ["Return shipping", "Return window"]);
  assert.equal(context.chunks[0].content, "Preview B");
  assert.equal(context.chunks[0].metadata.active_for_ai, false);
});

test("no preview id leaves legacy production payload unchanged", () => {
  assert.deepEqual(maybePreviewPayload(null), {
    shop_id: "shop-1",
    email_data: { subject: "Return", body: "Can I return this?" },
  });
});

test("missing preview document fails safely", async () => {
  const client = makeClient();
  await assert.rejects(
    () => loadPreviewDocumentContext({
      serviceClient: client,
      shopId: "shop-1",
      documentId: "missing",
    }),
    /not found/,
  );
});

test("preview cannot load another shop's document", async () => {
  const client = makeClient({
    knowledge_documents: [{ id: "doc-1", shop_id: "shop-2" }],
    agent_knowledge: [
      {
        id: 1,
        shop_id: "shop-2",
        source_provider: "knowledge_document",
        content: "Other shop preview",
        metadata: { document_id: "doc-1", environment: "preview" },
      },
    ],
  });
  await assert.rejects(
    () => loadPreviewDocumentContext({
      serviceClient: client,
      shopId: "shop-1",
      documentId: "doc-1",
    }),
    /not found/,
  );
});

test("missing preview chunks fails safely", async () => {
  const client = makeClient({
    knowledge_documents: [{ id: "doc-1", shop_id: "shop-1" }],
    agent_knowledge: [
      {
        id: 2,
        shop_id: "shop-1",
        source_provider: "knowledge_document",
        content: "Production A",
        metadata: { document_id: "doc-1", environment: "production" },
      },
    ],
  });
  await assert.rejects(
    () => loadPreviewDocumentContext({
      serviceClient: client,
      shopId: "shop-1",
      documentId: "doc-1",
    }),
    /no generated preview chunks/,
  );
});
