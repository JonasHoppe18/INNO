import { describe, expect, it, vi } from "vitest";
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({}) }));
import { resolveAuthScope } from "../workspace-auth.js";

describe("workspace authorization concurrency", () => {
  it("shares simultaneous checks, keeps result objects separate, and rechecks revoked membership", async () => {
    let member = true;
    const calls = [];
    const client = { from(table) {
      const query = {
        select() { return query; }, eq() { return query; },
        maybeSingle() {
          calls.push(table);
          return Promise.resolve({ error: null, data: table === "profiles" ? { user_id: "profile-a" } :
            table === "workspaces" ? { id: "workspace-a" } : member ? { workspace_id: "workspace-a" } : null });
        },
      }; return query;
    } };
    const identity = { clerkUserId: "viewer-a", orgId: "org-a" };
    const [a, b] = await Promise.all([resolveAuthScope(client, identity), resolveAuthScope(client, identity)]);
    expect(calls).toEqual(["profiles", "workspaces", "workspace_members"]);
    expect(a).toEqual({ supabaseUserId: "profile-a", workspaceId: "workspace-a" });
    expect(a).not.toBe(b);
    a.workspaceId = "changed by one caller";
    expect(b.workspaceId).toBe("workspace-a");
    member = false;
    await expect(resolveAuthScope(client, identity)).rejects.toThrow("not available");
    expect(calls).toHaveLength(6);
  });
  it("rejects an unmapped account before callers can issue unscoped service reads", async () => {
    const query = { select(){return query;}, eq(){return query;}, order(){return query;}, limit(){return query;}, maybeSingle(){return query;}, then(done){return Promise.resolve({data:null,error:null}).then(done);} };
    const client = { from(){return query;} };
    await expect(resolveAuthScope(client, {clerkUserId:"unmapped-viewer", sessionClaims:{}})).rejects.toThrow("Workspace scope not found");
  });

});
