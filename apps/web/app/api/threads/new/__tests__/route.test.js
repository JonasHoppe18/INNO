import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createClient: vi.fn(),
  applyScope: vi.fn(),
  resolveAuthScope: vi.fn(),
  isExternalCustomerEmail: vi.fn(),
  loadWorkspaceInternalEmails: vi.fn(),
  normalizeCustomerEmail: vi.fn(),
  resolveWorkspaceCustomer: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/server/workspace-auth", () => ({
  applyScope: mocks.applyScope,
  resolveAuthScope: mocks.resolveAuthScope,
}));
vi.mock("@/lib/server/customer-identity", () => ({
  isExternalCustomerEmail: mocks.isExternalCustomerEmail,
  loadWorkspaceInternalEmails: mocks.loadWorkspaceInternalEmails,
  normalizeCustomerEmail: mocks.normalizeCustomerEmail,
  resolveWorkspaceCustomer: mocks.resolveWorkspaceCustomer,
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://development.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";

const { POST } = await import("../route.js");

function chain({ maybeSingleResult, singleResult } = {}) {
  const builder = {};
  for (const method of ["select", "eq", "is", "limit", "insert"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => maybeSingleResult || { data: null, error: null });
  builder.single = vi.fn(async () => singleResult || { data: null, error: null });
  return builder;
}

const mailbox = {
  id: "mailbox-a",
  user_id: "user-a",
  workspace_id: "workspace-a",
  provider: "gmail",
  provider_email: "support@example.test",
  status: "connected",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: "clerk-user-a", orgId: "clerk-org-a" });
  mocks.resolveAuthScope.mockResolvedValue({ workspaceId: "workspace-a", supabaseUserId: "user-a" });
  mocks.applyScope.mockImplementation((query, scope) => query.eq("workspace_id", scope.workspaceId));
  mocks.normalizeCustomerEmail.mockImplementation((value) => String(value || "").trim().toLowerCase());
  mocks.isExternalCustomerEmail.mockReturnValue(true);
  mocks.loadWorkspaceInternalEmails.mockResolvedValue([mailbox.provider_email]);
  mocks.resolveWorkspaceCustomer.mockResolvedValue({
    id: "customer-a",
    workspace_id: "workspace-a",
    normalized_email: "customer@example.com",
  });
});

describe("POST /api/threads/new customer identity", () => {
  it("attaches a workspace-scoped customer to the new thread", async () => {
    const mailboxQuery = chain({ maybeSingleResult: { data: mailbox, error: null } });
    const threadQuery = chain({
      singleResult: {
        data: {
          id: "thread-a",
          workspace_id: "workspace-a",
          mailbox_id: "mailbox-a",
          customer_id: "customer-a",
          customer_email: "customer@example.com",
        },
        error: null,
      },
    });
    const client = {
      from: vi.fn()
        .mockReturnValueOnce(mailboxQuery)
        .mockReturnValueOnce(threadQuery),
    };
    mocks.createClient.mockReturnValue(client);

    const response = await POST(new Request("http://localhost/api/threads/new", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mailbox_id: "mailbox-a",
        subject: "Question",
        to_emails: [" Customer@Example.com "],
      }),
    }));

    expect(response.status).toBe(201);
    expect(mocks.resolveWorkspaceCustomer).toHaveBeenCalledWith(client, {
      workspaceId: "workspace-a",
      email: "customer@example.com",
    });
    expect(threadQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      workspace_id: "workspace-a",
      customer_id: "customer-a",
      customer_email: "customer@example.com",
    }));
  });

  it("rejects internal recipients before creating a customer or thread", async () => {
    mocks.isExternalCustomerEmail.mockReturnValue(false);
    const mailboxQuery = chain({ maybeSingleResult: { data: mailbox, error: null } });
    const client = { from: vi.fn().mockReturnValue(mailboxQuery) };
    mocks.createClient.mockReturnValue(client);

    const response = await POST(new Request("http://localhost/api/threads/new", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mailbox_id: "mailbox-a",
        subject: "Internal note",
        to_emails: ["teammate@example.com"],
      }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.resolveWorkspaceCustomer).not.toHaveBeenCalled();
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it("keeps mailbox and customer resolution scoped to the authenticated workspace", async () => {
    const mailboxQuery = chain({ maybeSingleResult: { data: mailbox, error: null } });
    const threadQuery = chain({ singleResult: { data: { id: "thread-a" }, error: null } });
    const client = {
      from: vi.fn()
        .mockReturnValueOnce(mailboxQuery)
        .mockReturnValueOnce(threadQuery),
    };
    mocks.createClient.mockReturnValue(client);

    await POST(new Request("http://localhost/api/threads/new", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mailbox_id: "mailbox-a",
        subject: "Question",
        to_emails: ["customer@example.com"],
      }),
    }));

    expect(mailboxQuery.eq).toHaveBeenCalledWith("workspace_id", "workspace-a");
    expect(mocks.resolveWorkspaceCustomer).toHaveBeenCalledWith(client, expect.objectContaining({
      workspaceId: "workspace-a",
    }));
  });
});
