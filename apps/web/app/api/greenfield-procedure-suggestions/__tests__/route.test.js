import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createServiceSupabase: vi.fn(),
  resolveAuthScope: vi.fn(),
  ingest: vi.fn(),
  devTarget: vi.fn(),
  enabled: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/server/shopify-oauth", () => ({ createServiceSupabase: mocks.createServiceSupabase }));
vi.mock("@/lib/server/workspace-auth", () => ({ resolveAuthScope: mocks.resolveAuthScope }));
vi.mock("@/lib/server/greenfield-playground", () => ({
  isGreenfieldPlaygroundDevTarget: mocks.devTarget,
  isGreenfieldPlaygroundEnabled: mocks.enabled,
}));
vi.mock("@/lib/greenfield-support", () => ({
  SupabaseKnowledgeStore: class {
    ingest(...args) { return mocks.ingest(...args); }
  },
}));

const baseSuggestion = {
  id: "suggestion-1",
  workspace_id: "workspace-a",
  suggestion_key: "returns_rma",
  title: "Returns / RMA intake",
  trigger: "Customer asks to return an item or receive a refund.",
  customer_phrasing_examples: ["I want to return this"],
  recommended_steps: [{ kind: "instruction", text: "Check the current return policy.", list_style: "ordered" }],
  escalation_condition: "Escalate exceptions.",
  policy_dependencies: ["Current return policy"],
  action_permission_note: "Human approval required for refund or return action.",
  historical_evidence_count: 320,
  confidence: "HIGH",
  status: "suggested",
  provenance: { origin: "historical_support_suggestion", evidence_count: 320, confidence_at_creation: "HIGH", policy_conflict_warnings: ["Current policy is authoritative."] },
  published_knowledge_record_id: null,
  reviewed_at: null,
  dismissed_at: null,
  published_at: null,
  created_at: "2026-09-13T12:00:00.000Z",
  updated_at: "2026-09-13T12:00:00.000Z",
};

const canonicalRecord = {
  id: "record-1",
  workspace_id: "workspace-a",
  knowledge_type: "procedural",
  authority: "authoritative",
  title: "Returns / RMA intake",
  content: "Identify the customer and order.\n\nCheck the current return policy.",
  structured_data: {
    procedure: {
      task: { key: "returns_rma", title: "Returns / RMA intake" },
      aliases: ["I want to return this"],
      blocks: [{ kind: "instruction", text: "Check the current return policy.", list_style: "ordered" }],
    },
    procedure_blocks: [{ kind: "instruction", text: "Check the current return policy.", list_style: "ordered" }],
  },
  source_kind: "merchant_authored",
  source_id: "historical-support-suggestion:suggestion-1",
  source_label: "Merchant",
  metadata: { lifecycle_status: "published", historical_support_suggestion: { origin: "historical_support_suggestion", evidence_count: 320 } },
  published_at: "2026-09-13T12:00:00.000Z",
  observed_at: "2026-09-13T12:00:00.000Z",
  expires_at: null,
  created_at: "2026-09-13T12:00:00.000Z",
  updated_at: "2026-09-13T12:00:00.000Z",
};

function makeSupabase({ suggestions = [baseSuggestion], record = canonicalRecord } = {}) {
  const state = { suggestions: suggestions.map((item) => ({ ...item })), updateCalls: [] };
  const service = {
    state,
    from(table) {
      const queryState = { filters: {}, update: null };
      const query = {
        select() { return this; },
        eq(key, value) { queryState.filters[key] = value; return this; },
        order() { return this; },
        update(payload) { queryState.update = payload; return this; },
        maybeSingle() { return Promise.resolve({ data: resolveRow(table, queryState, state, record, false), error: null }); },
        single() { return Promise.resolve({ data: resolveRow(table, queryState, state, record, true), error: null }); },
        then(resolve, reject) { return Promise.resolve({ data: resolveRows(table, queryState, state, record), error: null }).then(resolve, reject); },
      };
      return query;
    },
  };
  return service;
}

function matches(row, filters) {
  return Object.entries(filters).every(([key, value]) => String(row?.[key] ?? "") === String(value));
}

function resolveRows(table, queryState, state, record) {
  if (table === "greenfield_procedure_suggestions") return state.suggestions.filter((row) => matches(row, queryState.filters));
  if (table === "greenfield_knowledge_records") return [record].filter((row) => matches(row, queryState.filters));
  return [];
}

function resolveRow(table, queryState, state, record, requireRow) {
  const rows = resolveRows(table, queryState, state, record);
  const row = rows[0] || null;
  if (queryState.update && row && table === "greenfield_procedure_suggestions") {
    Object.assign(row, queryState.update);
    state.updateCalls.push({ filters: queryState.filters, payload: queryState.update });
  }
  return requireRow ? row : row;
}

const { GET } = await import("../route");
const { PATCH } = await import("../[id]/route");
const { POST: publish } = await import("../[id]/publish/route");

describe("greenfield procedure suggestion API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ userId: "clerk-user-a", orgId: "org-a", sessionClaims: {} });
    mocks.resolveAuthScope.mockResolvedValue({ workspaceId: "workspace-a" });
    mocks.ingest.mockResolvedValue({ id: "record-1" });
    mocks.devTarget.mockReturnValue(true);
    mocks.enabled.mockReturnValue(true);
  });

  it("lists only the authenticated workspace and keeps suggestions outside canonical retrieval", async () => {
    const service = makeSupabase({ suggestions: [baseSuggestion, { ...baseSuggestion, id: "other", workspace_id: "workspace-b" }] });
    mocks.createServiceSupabase.mockReturnValue(service);
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ suggestions: [{ id: "suggestion-1" }] });
    expect(service.state.suggestions).toHaveLength(2);
  });

  it("fails closed outside the DEV Greenfield environment", async () => {
    mocks.devTarget.mockReturnValue(false);
    const response = await GET();
    expect(response.status).toBe(404);
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it("fails closed for a suggestion outside the scoped workspace", async () => {
    const service = makeSupabase({ suggestions: [{ ...baseSuggestion, workspace_id: "workspace-b" }] });
    mocks.createServiceSupabase.mockReturnValue(service);
    const response = await PATCH(new Request("http://localhost/api/greenfield-procedure-suggestions/suggestion-1", { method: "PATCH", body: JSON.stringify({ status: "reviewed" }) }), { params: { id: "suggestion-1" } });
    expect(response.status).toBe(404);
  });

  it("supports edit/review and dismiss without changing evidence or provenance", async () => {
    const service = makeSupabase();
    mocks.createServiceSupabase.mockReturnValue(service);
    const reviewed = await PATCH(new Request("http://localhost/api/greenfield-procedure-suggestions/suggestion-1", {
      method: "PATCH",
      body: JSON.stringify({ title: "Returns intake revised", trigger: "A customer asks to return an item.", recommended_steps: [{ kind: "instruction", text: "Check the current return policy." }], escalation_condition: "Escalate exceptions.", status: "reviewed" }),
    }), { params: { id: "suggestion-1" } });
    expect(reviewed.status).toBe(200);
    expect(service.state.updateCalls[0].payload).toMatchObject({ status: "reviewed", title: "Returns intake revised" });
    expect(service.state.suggestions[0].historical_evidence_count).toBe(320);
    expect(service.state.suggestions[0].provenance.origin).toBe("historical_support_suggestion");

    const dismissed = await PATCH(new Request("http://localhost/api/greenfield-procedure-suggestions/suggestion-1", { method: "PATCH", body: JSON.stringify({ status: "dismissed" }) }), { params: { id: "suggestion-1" } });
    expect(dismissed.status).toBe(200);
    expect(service.state.suggestions[0].status).toBe("dismissed");
  });

  it("does not publish a dismissed suggestion", async () => {
    const service = makeSupabase({ suggestions: [{ ...baseSuggestion, status: "dismissed" }] });
    mocks.createServiceSupabase.mockReturnValue(service);
    const response = await publish(new Request("http://localhost/api/greenfield-procedure-suggestions/suggestion-1", { method: "POST" }), { params: { id: "suggestion-1" } });
    expect(response.status).toBe(409);
    expect(mocks.ingest).not.toHaveBeenCalled();
  });

  it("publishes through the existing canonical Knowledge V1 model with provenance and no action permission", async () => {
    const service = makeSupabase();
    mocks.createServiceSupabase.mockReturnValue(service);
    const response = await publish(new Request("http://localhost/api/greenfield-procedure-suggestions/suggestion-1", { method: "POST" }), { params: { id: "suggestion-1" } });
    expect(response.status).toBe(200);
    expect(mocks.ingest).toHaveBeenCalledWith("workspace-a", expect.objectContaining({
      sourceKind: "merchant_authored",
      knowledgeType: "procedural",
      authority: "authoritative",
      metadata: expect.objectContaining({ historical_support_suggestion: expect.objectContaining({ origin: "historical_support_suggestion", evidence_count: 320 }) }),
      structuredData: expect.objectContaining({ procedure_blocks: expect.any(Array) }),
    }));
    const publishedSource = mocks.ingest.mock.calls[0][1];
    expect(publishedSource.metadata.historical_support_suggestion).not.toHaveProperty("action");
    expect(service.state.suggestions[0].status).toBe("published");
    expect(service.state.suggestions[0].published_knowledge_record_id).toBe("record-1");
  });
});
