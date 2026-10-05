import { describe, expect, it, vi } from "vitest";
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({}) }));
import { resolveAuthScope } from "../workspace-auth.js";

describe("workspace authorization concurrency", () => {
  it("shares simultaneous checks, keeps result objects separate, and rechecks revoked membership", async () => {
    let member = true;
    const calls = [];
    const client = { from(table) {
      const query = {
        select(fields) { if(table === "workspace_members") expect(fields).toContain("workspaces!inner(clerk_org_id)"); return query; }, eq(key, value) { if(key === "workspaces.clerk_org_id") expect(value).toBe("org-a"); return query; },
        maybeSingle() {
          calls.push(table);
          return Promise.resolve({ error: null, data: table === "profiles" ? { user_id: "profile-a" } :
            table === "workspaces" ? { id: "workspace-a" } : member ? { workspace_id: "workspace-a" } : null });
        },
      }; return query;
    } };
    const identity = { clerkUserId: "viewer-a", orgId: "org-a" };
    const [a, b] = await Promise.all([resolveAuthScope(client, identity), resolveAuthScope(client, identity)]);
    expect(calls).toEqual(["profiles", "workspace_members"]);
    expect(a).toEqual({ supabaseUserId: "profile-a", workspaceId: "workspace-a" });
    expect(a).not.toBe(b);
    a.workspaceId = "changed by one caller";
    expect(b.workspaceId).toBe("workspace-a");
    member = false;
    await expect(resolveAuthScope(client, identity)).rejects.toThrow("not available");
    expect(calls).toHaveLength(4);
  });
  it("rejects an unmapped account before callers can issue unscoped service reads", async () => {
    const query = { select(){return query;}, eq(){return query;}, order(){return query;}, limit(){return query;}, maybeSingle(){return query;}, then(done){return Promise.resolve({data:null,error:null}).then(done);} };
    const client = { from(){return query;} };
    await expect(resolveAuthScope(client, {clerkUserId:"unmapped-viewer", sessionClaims:{}})).rejects.toThrow("Workspace scope not found");
  });

  it("does not fall back when the joined organization is absent or the relation fails", async () => {
    for (const error of [null, { message: "Relationship is unavailable" }]) {
      const calls = [];
      const client = { from(table) {
        const query = {
          select(fields) { if (table === "workspace_members") expect(fields).toContain("!inner"); return query; },
          eq(key, value) { calls.push([table, key, value]); return query; },
          maybeSingle() { return Promise.resolve(table === "profiles" ? { data: { user_id: "profile-a" }, error: null } : { data: null, error }); },
        }; return query;
      } };
      await expect(resolveAuthScope(client, { clerkUserId: "viewer-a", orgId: "missing-org" })).rejects.toThrow();
      expect(calls).toContainEqual(["workspace_members", "workspaces.clerk_org_id", "missing-org"]);
      expect(calls).toContainEqual(["workspace_members", "clerk_user_id", "viewer-a"]);
      expect(calls.every(([table]) => table !== "workspaces")).toBe(true);
    }
  });

});
