import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  denied: false,
  scheduledFor: "2000-01-01T00:00:00Z",
  filters: [],
  dispatch: vi.fn(async () => ({ processed: 1 })),
  schedule: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "viewer", orgId: "org-a" }),
}));
vi.mock("@/lib/server/workspace-auth", () => ({
  resolveClerkOrgId: () => "org-a",
  resolveAuthScope: async () => ({ workspaceId: "workspace-a" }),
  applyScope: (query, scope) => query.eq("workspace_id", scope.workspaceId),
}));
vi.mock("@/lib/server/customer-satisfaction-surveys", () => ({
  resolveCustomerSatisfactionOrigin: () => "https://dev.sona-ai.dk",
  dispatchDueCustomerSatisfactionSurveys: state.dispatch,
  scheduleCustomerSatisfactionSurvey: async (...args) => {
    state.schedule(...args);
    return { status: "pending", scheduledFor: state.scheduledFor };
  },
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from() {
      let status;
      const query = {
        update(value) {
          status = value.status;
          return query;
        },
        select() {
          return query;
        },
        eq(key, value) {
          state.filters.push([key, value]);
          return query;
        },
        maybeSingle() {
          return query;
        },
        then(resolve) {
          return Promise.resolve({
            data: state.denied ? null : { id: "thread-target", status },
            error: null,
          }).then(resolve);
        },
      };
      return query;
    },
  }),
}));
beforeEach(() => {
  state.denied = false;
  state.scheduledFor = "2000-01-01T00:00:00Z";
  state.filters = [];
  state.schedule.mockClear();
  state.dispatch.mockClear();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
  vi.resetModules();
});
afterEach(() => vi.unstubAllEnvs());
async function resolve() {
  const { PATCH } = await import("../thread-status/route.js");
  return PATCH(
    new Request("https://app.test/api/inbox/thread-status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId: "thread-target", status: "resolved" }),
    }),
  );
}
describe("CSAT on manual resolution", () => {
  it("dispatches only the resolved thread in the verified workspace", async () => {
    expect((await resolve()).status).toBe(200);
    expect(state.dispatch.mock.calls[0][1]).toMatchObject({
      workspaceId: "workspace-a",
      threadId: "thread-target",
      limit: 1,
    });
    expect(state.filters).toContainEqual(["workspace_id", "workspace-a"]);
  });
  it("preserves a future send delay", async () => {
    state.scheduledFor = "2100-01-01T00:00:00Z";
    expect((await resolve()).status).toBe(200);
    expect(state.schedule).toHaveBeenCalledOnce();
    expect(state.dispatch).not.toHaveBeenCalled();
  });
  it("does not schedule or dispatch an inaccessible thread", async () => {
    state.denied = true;
    expect((await resolve()).status).toBe(404);
    expect(state.schedule).not.toHaveBeenCalled();
    expect(state.dispatch).not.toHaveBeenCalled();
  });
});
