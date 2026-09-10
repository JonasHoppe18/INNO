import { describe, expect, it } from "vitest";
import { saveKnowledgeDocumentDraft } from "../../server/knowledge-doc-service.ts";

function createKnowledgeClient() {
  const state = {
    document: {
      id: "doc-1",
      category: "returns",
      document_type: "returns_refunds",
      title: "Returns & Refunds",
      draft_markdown: "## Return window\n\nCustomers have 30 days.",
      published_markdown: "",
      has_unpublished_changes: false,
      published_at: null,
      metadata: {},
    },
    calls: [],
  };

  const from = (table) => {
    const query = {
      operation: "",
      values: null,
      select() {
        return query;
      },
      upsert(values) {
        query.operation = "upsert";
        query.values = values;
        return query;
      },
      update(values) {
        query.operation = "update";
        query.values = values;
        return query;
      },
      delete() {
        query.operation = "delete";
        return query;
      },
      insert(values) {
        query.operation = "insert";
        query.values = values;
        return query;
      },
      eq() {
        return query;
      },
      limit() {
        return query;
      },
      single() {
        return Promise.resolve(resolve());
      },
      maybeSingle() {
        return Promise.resolve(resolve());
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve(resolve()).then(onFulfilled, onRejected);
      },
    };

    function resolve() {
      state.calls.push({ table, operation: query.operation });
      if (table === "knowledge_documents" && query.operation === "upsert") {
        state.document = { ...state.document, ...query.values, id: "doc-1" };
        return { data: state.document, error: null };
      }
      if (table === "knowledge_documents" && query.operation === "update") {
        state.document = { ...state.document, ...query.values };
        return { data: state.document, error: null };
      }
      if (table === "knowledge_documents") {
        return { data: state.document, error: null };
      }
      if (table === "agent_knowledge" && query.operation === "select") {
        return { data: [], error: null };
      }
      return { data: null, error: null };
    }

    return query;
  };

  return { from, state };
}

describe("knowledge document save resilience", () => {
  it("saves the draft and preserves the existing preview index when embedding is unavailable", async () => {
    const client = createKnowledgeClient();

    const result = await saveKnowledgeDocumentDraft({
      serviceClient: client,
      embedder: async () => {
        throw new Error("OPENAI_API_KEY is missing.");
      },
      shopId: "shop-1",
      category: "returns",
      documentType: "returns_refunds",
      title: "Returns & Refunds",
      draftMarkdown: "## Return window\n\nCustomers have 30 days.",
    });

    expect(result.preview_chunks).toBe(0);
    expect(result.indexing).toMatchObject({ environment: "preview", status: "error" });
    expect(result.warning).toContain("Your changes were saved");
    expect(result.document.metadata.knowledge_index.preview.status).toBe("error");
    expect(
      client.state.calls.some(
        (call) => call.table === "agent_knowledge" && call.operation === "delete",
      ),
    ).toBe(false);
  });
});
