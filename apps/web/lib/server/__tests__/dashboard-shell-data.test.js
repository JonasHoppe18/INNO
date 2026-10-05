import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ resolveScope: vi.fn() }));
vi.mock("@/lib/server/workspace-auth", () => ({
  resolveAuthScope: mocks.resolveScope,
  applyScope: (query, scope) => query.eq("workspace_id", scope.workspaceId),
}));
import { loadDashboardShellData } from "../dashboard-shell-data.js";

function client({ shops = [], mailboxes = [], error = null } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const call = { table, filters: [], limit: null, select: null };
      calls.push(call);
      const query = {
        select(fields, options) { call.select = { fields, options }; return query; },
        is(...args) { call.filters.push(args); return query; },
        limit(n) { call.limit = n; return query; },
        eq(...args) { call.filters.push(args); return query; },
        then(done) { return Promise.resolve({ data: table === "shops" ? shops : mailboxes, error }).then(done); },
      };
      return query;
    },
  };
}
afterEach(() => vi.clearAllMocks());
const auth = { clerkUserId: "user-a", orgId: "org-a" };

describe("dashboard shell data", () => {
  it("starts the user lookup before workspace resolution completes", async () => {
    let finishScope;
    mocks.resolveScope.mockReturnValue(new Promise((resolve) => { finishScope = resolve; }));
    const loadUser = vi.fn(async () => ({ name: "Test" }));
    const pending = loadDashboardShellData(client(), auth, loadUser);
    await Promise.resolve();
    expect(loadUser).toHaveBeenCalledOnce();
    finishScope({ workspaceId: "workspace-a" });
    expect(await pending).toEqual({ needsOnboarding: true, user: { name: "Test" } });
  });
  it.each([
    { shops: [], mailboxes: [], expected: true },
    { shops: [{ id: "shop-a" }], mailboxes: [], expected: false },
    { shops: [], mailboxes: [{ id: "mail-a" }], expected: false },
  ])("uses scoped existence reads: $expected", async ({ shops, mailboxes, expected }) => {
    mocks.resolveScope.mockResolvedValue({ workspaceId: "workspace-a" });
    const db = client({ shops, mailboxes });
    expect((await loadDashboardShellData(db, auth, async () => null)).needsOnboarding).toBe(expected);
    for (const call of db.calls) {
      expect(call.limit).toBe(1);
      expect(call.select).toEqual({ fields: "id", options: undefined });
      expect(call.filters).toContainEqual(["workspace_id", "workspace-a"]);
    }
    expect(db.calls[0].filters).toContainEqual(["uninstalled_at", null]);
  });
  it("does not redirect on query failure or run unscoped reads", async () => {
    mocks.resolveScope.mockResolvedValue({ workspaceId: "workspace-a" });
    expect((await loadDashboardShellData(client({ error: { message: "offline" } }), auth, async () => null)).needsOnboarding).toBe(false);
    mocks.resolveScope.mockResolvedValue({});
    const db = client();
    expect((await loadDashboardShellData(db, auth, async () => null)).needsOnboarding).toBe(false);
    expect(db.calls).toHaveLength(0);
  });
  it("keeps authentication errors isolated and does not cache between workspaces", async () => {
    mocks.resolveScope.mockResolvedValueOnce({ workspaceId: "workspace-a" }).mockResolvedValueOnce({ workspaceId: "workspace-b" });
    const a = client();
    const b = client();
    expect((await loadDashboardShellData(a, auth, async () => { throw new Error("Clerk unavailable"); })).user).toBeNull();
    await loadDashboardShellData(b, { ...auth, orgId: "org-b" }, async () => null);
    expect(a.calls[0].filters).toContainEqual(["workspace_id", "workspace-a"]);
    expect(b.calls[0].filters).toContainEqual(["workspace_id", "workspace-b"]);
  });
});
