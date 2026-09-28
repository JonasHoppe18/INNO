import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createClient: vi.fn(),
  resolveAuthScope: vi.fn(),
  sendPostmarkEmail: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/server/workspace-auth", () => ({
  resolveAuthScope: mocks.resolveAuthScope,
}));
vi.mock("@/lib/server/postmark", () => ({
  sendPostmarkEmail: mocks.sendPostmarkEmail,
}));
vi.mock("@/lib/server/supabase-server-config", () => ({
  resolveSupabaseServerConfig: () => ({
    url: "https://supabase.example",
    serviceKey: "service-key",
  }),
}));

const { POST } = await import("../route.js");

function mailboxQuery(result) {
  const query = {};
  for (const method of ["select", "eq", "order"]) {
    query[method] = vi.fn(() => query);
  }
  query.limit = vi.fn(async () => result);
  return query;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: "clerk-user-a", orgId: "org-a" });
  mocks.resolveAuthScope.mockResolvedValue({
    workspaceId: "workspace-a",
    supabaseUserId: "user-a",
  });
  mocks.sendPostmarkEmail.mockResolvedValue({ MessageID: "provider-message-id" });
});

describe("POST /api/settings/auto-reply/test sender resolution", () => {
  it("uses the selected workspace mailbox managed sender and preserves Reply-To", async () => {
    const query = mailboxQuery({
      data: [
        {
          id: "mailbox-a",
          provider_email: "support@merchant.example",
          from_email: null,
          from_name: "Merchant Support",
          metadata: {
            managed_sender: {
              status: "verified",
              domain: "merchant.sona-ai.dk",
              from_email: "support@merchant.sona-ai.dk",
            },
          },
        },
      ],
      error: null,
    });
    mocks.createClient.mockReturnValue({ from: vi.fn(() => query) });

    const response = await POST(new Request("http://localhost/api/settings/auto-reply/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recipient: "test@example.com", mailbox_id: "mailbox-a" }),
    }));

    expect(response.status).toBe(200);
    expect(query.eq).toHaveBeenCalledWith("workspace_id", "workspace-a");
    expect(query.eq).toHaveBeenCalledWith("id", "mailbox-a");
    expect(mocks.sendPostmarkEmail).toHaveBeenCalledWith(expect.objectContaining({
      From: "Merchant Support <support@merchant.sona-ai.dk>",
      ReplyTo: "support@merchant.example",
      Tag: "customer-confirmation-test",
      Subject: expect.stringContaining("[TEST]"),
      TextBody: expect.stringContaining("Test"),
    }));
  });

  it("cannot select a mailbox outside the authenticated workspace", async () => {
    const query = mailboxQuery({ data: [], error: null });
    mocks.createClient.mockReturnValue({ from: vi.fn(() => query) });

    const response = await POST(new Request("http://localhost/api/settings/auto-reply/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recipient: "test@example.com", mailbox_id: "mailbox-other" }),
    }));

    expect(response.status).toBe(400);
    expect(query.eq).toHaveBeenCalledWith("workspace_id", "workspace-a");
    expect(query.eq).toHaveBeenCalledWith("id", "mailbox-other");
    expect(mocks.sendPostmarkEmail).not.toHaveBeenCalled();
  });
});
