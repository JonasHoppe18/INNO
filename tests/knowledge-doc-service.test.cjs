require("sucrase/register/ts-legacy-module-interop");

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  RETURNS_DOCUMENT_TEMPLATE,
  getKnowledgeDocument,
  saveKnowledgeDocumentDraft,
  publishKnowledgeDocument,
} = require("../apps/web/lib/server/knowledge-doc-service.ts");

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
    select() {
      return this;
    }
    eq(key, value) {
      this.filters.push({ key, value });
      return this;
    }
    limit(count) {
      this.limitCount = count;
      return this;
    }
    maybeSingle() {
      this.singleMode = "maybe";
      return this;
    }
    single() {
      this.singleMode = "single";
      return this;
    }
    upsert(payload) {
      this.operation = "upsert";
      this.payload = payload;
      return this;
    }
    update(payload) {
      this.operation = "update";
      this.payload = payload;
      return this;
    }
    delete() {
      this.operation = "delete";
      return this;
    }
    insert(payload) {
      this.operation = "insert";
      this.payload = payload;
      return this;
    }
    then(resolve) {
      return Promise.resolve(this.execute()).then(resolve);
    }
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
        const keep = table.filter((r) => !matches(r, this.filters));
        db[this.table] = keep;
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
    from(table) {
      return new Query(table);
    },
  };
}

const markdown = `# Returns & Refunds

## Return window
30 days.

## Default return address
Example Shop ApS
Testvej 12
1000 Copenhagen
Denmark`;

test("GET missing doc returns template without inserting row", async () => {
  const client = makeClient();
  const result = await getKnowledgeDocument({
    serviceClient: client,
    shopId: "shop-1",
    category: "returns",
    documentType: "returns_refunds",
  });

  assert.equal(result.document.id, null);
  assert.equal(client.db.knowledge_documents.length, 0);
  assert.ok(result.parsed_sections.length > 0);
});

test("Returns document starter template begins with section headings", () => {
  assert.equal(RETURNS_DOCUMENT_TEMPLATE.startsWith("## Return window"), true);
  assert.equal(RETURNS_DOCUMENT_TEMPLATE.includes("# Returns & Refunds"), false);
});

test("starter template contains policy-fact sections only — no Internal guidance", () => {
  assert.equal(RETURNS_DOCUMENT_TEMPLATE.includes("## Internal guidance"), false);
  // The fact sections remain.
  for (const heading of [
    "## Return window",
    "## Opened or tested products",
    "## Return shipping",
    "## Refund processing",
    "## Default return address",
    "## Third-party purchases",
  ]) {
    assert.ok(RETURNS_DOCUMENT_TEMPLATE.includes(heading), `missing ${heading}`);
  }
});

test("PUT creates one doc, repeated PUT reuses id, and regenerates only preview chunks", async () => {
  const client = makeClient({
    agent_knowledge: [
      {
        id: 900,
        shop_id: "shop-1",
        source_provider: "knowledge_document",
        metadata: { document_id: "doc-1", environment: "production" },
      },
      {
        id: 901,
        shop_id: "shop-1",
        source_provider: "manual_text",
        metadata: { category: "returns", snippet_id: "legacy-1" },
      },
      {
        id: 902,
        shop_id: "shop-1",
        source_provider: "saved_reply",
        metadata: { category: "returns", snippet_id: "macro-1" },
      },
    ],
    saved_replies: [{ id: "macro-1", title: "Return macro" }],
  });
  const embedder = async () => [0, 1, 2];

  const first = await saveKnowledgeDocumentDraft({
    serviceClient: client,
    embedder,
    shopId: "shop-1",
    category: "returns",
    documentType: "returns_refunds",
    title: "Returns & Refunds",
    draftMarkdown: markdown,
  });
  const second = await saveKnowledgeDocumentDraft({
    serviceClient: client,
    embedder,
    shopId: "shop-1",
    category: "returns",
    documentType: "returns_refunds",
    title: "Returns & Refunds",
    draftMarkdown: `${markdown}\n`,
  });

  assert.equal(client.db.knowledge_documents.length, 1);
  assert.equal(first.document.id, second.document.id);
  assert.equal(second.document.has_unpublished_changes, true);
  assert.equal(client.db.agent_knowledge.filter((r) => r.metadata?.environment === "production").length, 1);
  assert.equal(client.db.agent_knowledge.filter((r) => r.source_provider === "manual_text").length, 1);
  assert.equal(client.db.agent_knowledge.filter((r) => r.source_provider === "saved_reply").length, 1);
  assert.equal(client.db.saved_replies.length, 1);
  assert.ok(client.db.agent_knowledge.some((r) => r.metadata?.environment === "preview" && r.metadata?.active_for_ai === false));
});

test("publish copies draft to published and regenerates only production chunks", async () => {
  const client = makeClient({
    knowledge_documents: [
      {
        id: "doc-1",
        shop_id: "shop-1",
        category: "returns",
        document_type: "returns_refunds",
        title: "Returns & Refunds",
        draft_markdown: markdown,
        published_markdown: "",
        has_unpublished_changes: true,
        published_at: null,
        metadata: {},
      },
    ],
    agent_knowledge: [
      {
        id: 1,
        shop_id: "shop-1",
        source_provider: "knowledge_document",
        metadata: { document_id: "doc-1", environment: "preview", active_for_ai: false },
      },
      {
        id: 2,
        shop_id: "shop-1",
        source_provider: "manual_text",
        metadata: { category: "returns", snippet_id: "legacy-1" },
      },
      {
        id: 3,
        shop_id: "shop-1",
        source_provider: "saved_reply",
        metadata: { category: "returns", snippet_id: "macro-1" },
      },
    ],
    saved_replies: [{ id: "macro-1", title: "Return macro" }],
  });

  const result = await publishKnowledgeDocument({
    serviceClient: client,
    embedder: async () => [0, 1, 2],
    shopId: "shop-1",
    category: "returns",
    documentType: "returns_refunds",
  });

  assert.equal(result.document.published_markdown, markdown);
  assert.equal(result.document.has_unpublished_changes, false);
  assert.ok(result.document.published_at);
  assert.equal(client.db.agent_knowledge.filter((r) => r.metadata?.environment === "preview").length, 1);
  assert.ok(client.db.agent_knowledge.some((r) =>
    r.metadata?.environment === "production" &&
    r.metadata?.active_for_ai === false &&
    r.metadata?.runtime_activation_pending === true
  ));
  assert.equal(client.db.agent_knowledge.filter((r) => r.source_provider === "manual_text").length, 1);
  assert.equal(client.db.agent_knowledge.filter((r) => r.source_provider === "saved_reply").length, 1);
  assert.equal(client.db.saved_replies.length, 1);
});
