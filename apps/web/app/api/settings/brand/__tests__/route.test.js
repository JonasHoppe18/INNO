import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ userId: "user", row: null, updates: [] }));

vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: state.userId, orgId: "org" }) }));
vi.mock("@/lib/server/supabase-server-config", () => ({
  resolveSupabaseServerConfig: () => ({ url: "https://abc.supabase.co", serviceKey: "test" }),
}));
vi.mock("@/lib/server/workspace-auth", () => ({
  resolveAuthScope: async () => ({ workspaceId: "ws-1" }),
}));
vi.mock("@/lib/server/stateless-service-client", () => ({
  createStatelessServiceClient: () => ({
    from: (table) => ({
      select: () => ({
        eq: (_column, id) => ({
          maybeSingle: async () => ({ data: table === "workspaces" && id === "ws-1" ? state.row : null, error: null }),
        }),
      }),
      update: (values) => ({
        eq: async (column, id) => {
          state.updates.push({ table, values, column, id });
          state.row = { ...state.row, ...values };
          return { error: null };
        },
      }),
    }),
  }),
}));

import { GET, PUT } from "../route";

const logo = (workspace) =>
  `https://abc.supabase.co/storage/v1/object/public/workspace-email-signature-assets/${workspace}/brand/a1.png`;
const put = (body) =>
  PUT(new Request("https://app.test/api/settings/brand", { method: "PUT", body: JSON.stringify(body) }));

beforeEach(() => {
  state.userId = "user";
  state.row = { brand_logo_url: null, brand_accent_color: "#4f46e5" };
  state.updates = [];
});

describe("workspace brand route", () => {
  it("requires a signed-in user", async () => {
    state.userId = null;
    expect((await GET()).status).toBe(401);
    expect((await put({ accent_color: "#000000" })).status).toBe(401);
  });

  it("returns the stored brand", async () => {
    const response = await GET();
    expect(await response.json()).toEqual({ logo_url: null, accent_color: "#4f46e5", workspace_found: true });
  });

  it("rejects an invalid color and a logo from another workspace", async () => {
    expect((await put({ accent_color: "red", logo_url: null })).status).toBe(400);
    expect((await put({ accent_color: null, logo_url: logo("ws-2") })).status).toBe(400);
    expect((await put({ accent_color: null, logo_url: "https://evil.example/logo.png" })).status).toBe(400);
    expect(state.updates).toHaveLength(0);
  });

  it("stores the brand on this workspace with a lowercase color", async () => {
    const response = await put({ accent_color: "#FFAA00", logo_url: logo("ws-1") });
    expect(response.status).toBe(200);
    expect(state.updates).toEqual([
      {
        table: "workspaces",
        values: { brand_logo_url: logo("ws-1"), brand_accent_color: "#ffaa00" },
        column: "id",
        id: "ws-1",
      },
    ]);
    expect(await response.json()).toEqual({ logo_url: logo("ws-1"), accent_color: "#ffaa00", workspace_found: true });
  });

  it("clears both values with null", async () => {
    await put({ accent_color: "", logo_url: null });
    expect(state.updates[0].values).toEqual({ brand_logo_url: null, brand_accent_color: null });
  });
});
