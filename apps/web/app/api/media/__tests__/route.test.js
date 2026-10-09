import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userId: "user",
  scope: { workspaceId: "ws-1", supabaseUserId: "sb-user" },
  list: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: mocks.userId, orgId: "org" }) }));
vi.mock("@/lib/server/supabase-server-config", () => ({
  resolveSupabaseServerConfig: () => ({ url: "https://abc.supabase.co", serviceKey: "test" }),
}));
vi.mock("@/lib/server/stateless-service-client", () => ({ createStatelessServiceClient: () => ({ client: true }) }));
vi.mock("@/lib/server/workspace-auth", () => ({ resolveAuthScope: async () => mocks.scope }));
vi.mock("@/lib/server/workspace-media", () => ({
  listWorkspaceMedia: mocks.list,
  uploadWorkspaceMedia: mocks.upload,
  softDeleteWorkspaceMedia: mocks.remove,
  restoreWorkspaceMedia: mocks.restore,
}));

import { GET, POST } from "../route";
import { DELETE } from "../[id]/route";
import { POST as RESTORE } from "../[id]/restore/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userId = "user";
  mocks.scope = { workspaceId: "ws-1", supabaseUserId: "sb-user" };
});

describe("media library routes", () => {
  it("requires a signed-in user", async () => {
    mocks.userId = null;
    expect((await GET(new Request("https://app.test/api/media"))).status).toBe(401);
    expect((await POST(new Request("https://app.test/api/media", { method: "POST" }))).status).toBe(401);
    expect((await DELETE(new Request("https://app.test/api/media/x"), { params: { id: "x" } })).status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("lists the scoped workspace's images with the cursor", async () => {
    mocks.list.mockResolvedValue({ items: [{ id: "a" }], next_before: null });
    const response = await GET(new Request("https://app.test/api/media?before=c1"));
    expect(mocks.list).toHaveBeenCalledWith({ client: true }, "ws-1", { before: "c1" });
    expect(await response.json()).toEqual({ items: [{ id: "a" }], next_before: null });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("uploads into the scoped workspace and reports validation errors", async () => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array([1])], "a.png", { type: "image/png" }));
    mocks.upload.mockResolvedValue({ id: "new" });
    const response = await POST(new Request("https://app.test/api/media", { method: "POST", body: form }));
    expect(response.status).toBe(201);
    expect(mocks.upload.mock.calls[0][1]).toMatchObject({
      supabaseUrl: "https://abc.supabase.co", workspaceId: "ws-1", userId: "sb-user",
    });
    mocks.upload.mockRejectedValue(Object.assign(new Error("Images must be PNG, JPG or GIF files."), { status: 400 }));
    const again = new FormData();
    again.append("file", new File([new Uint8Array([1])], "a.svg", { type: "image/svg+xml" }));
    const rejected = await POST(new Request("https://app.test/api/media", { method: "POST", body: again }));
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).error).toBe("Images must be PNG, JPG or GIF files.");
  });

  it("hides an image in this workspace and returns 404 for anything else", async () => {
    mocks.remove.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const ok = await DELETE(new Request("https://app.test/api/media/a"), { params: { id: "a" } });
    expect(ok.status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith({ client: true }, "ws-1", "a");
    const missing = await DELETE(new Request("https://app.test/api/media/b"), { params: { id: "b" } });
    expect(missing.status).toBe(404);
  });

  it("restores a hidden image in this workspace and returns 404 otherwise", async () => {
    mocks.restore.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const ok = await RESTORE(new Request("https://app.test/api/media/a/restore", { method: "POST" }), { params: { id: "a" } });
    expect(ok.status).toBe(200);
    expect(mocks.restore).toHaveBeenCalledWith({ client: true }, "ws-1", "a");
    const missing = await RESTORE(new Request("https://app.test/api/media/b/restore", { method: "POST" }), { params: { id: "b" } });
    expect(missing.status).toBe(404);
  });

  it("returns 404 without a workspace", async () => {
    mocks.scope = { workspaceId: null };
    expect((await GET(new Request("https://app.test/api/media"))).status).toBe(404);
  });
});
