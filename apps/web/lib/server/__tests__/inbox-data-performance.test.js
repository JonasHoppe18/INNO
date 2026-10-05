import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  requests: [],
  rows: {
    mail_accounts: [{ id: "mailbox-a" }],
    mail_threads: [{ id: "thread-a" }],
    mail_messages: [{ id: "message-a" }],
    mail_attachments: [{ id: "attachment-a" }],
    thread_tag_assignments: [{ thread_id: "thread-a", workspace_tags: { id: "tag-a", name: "Support" } }],
    workspace_members: [{ clerk_user_id: "user-a" }],
    profiles: [{ clerk_user_id: "user-a", user_id: "profile-a" }],
  },
  delays: { mail_accounts: 40, mail_threads: 100, mail_messages: 80, mail_attachments: 50, thread_tag_assignments: 60, workspace_members: 90, profiles: 30 },
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/server/workspace-auth", () => ({
  resolveAuthScope: vi.fn(async () => ({ workspaceId: "workspace-a", supabaseUserId: "profile-a" })),
  applyScope: (query, scope, options = {}) => query.eq(options.workspaceColumn === null ? "user_id" : "workspace_id", options.workspaceColumn === null ? scope.supabaseUserId : scope.workspaceId),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from(table) {
      const filters = [];
      const query = {
        select() { return query; }, order() { return query; },
        eq(...args) { filters.push(args); return query; },
        in(...args) { filters.push(args); return query; },
        then(resolve) {
          fixture.requests.push({ table, filters, start: Date.now() });
          return new Promise((done) => setTimeout(() => done({ data: fixture.rows[table], error: null }), fixture.delays[table])).then(resolve);
        },
      };
      return query;
    },
  }),
}));
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

async function run(options) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only");
  vi.useFakeTimers();
  fixture.requests.length = 0;
  const { loadInboxData } = await import("../inbox-data.js");
  const start = Date.now();
  const promise = loadInboxData({ clerkUserId: "user-a", orgId: "org-a", ...options });
  await vi.runAllTimersAsync();
  return { result: await promise, duration: Date.now() - start };
}

describe("inbox data dependency scheduling", () => {
  it("keeps independent reads concurrent and dependent reads scoped", async () => {
    const { result, duration } = await run({ includeMembers: true, includeTags: true });
    console.info(`Inbox fixture: ${duration}ms, ${fixture.requests.length} reads (simulated network)`);
    expect(result.threads).toEqual(fixture.rows.mail_threads);
    expect(result.messages).toEqual(fixture.rows.mail_messages);
    expect(result.attachments).toEqual(fixture.rows.mail_attachments);
    expect(result.members[0].user_id).toBe("profile-a");
    expect(result.threadTags[0].name).toBe("Support");
    expect(fixture.requests.find((r) => r.table === "mail_threads").filters).toContainEqual(["workspace_id", "workspace-a"]);
    expect(fixture.requests.find((r) => r.table === "mail_attachments").filters).toContainEqual(["message_id", ["message-a"]]);
    expect(fixture.requests.find((r) => r.table === "thread_tag_assignments").filters).toContainEqual(["thread_id", ["thread-a"]]);
    expect(duration).toBe(200);
  });
  it("does not fetch message bodies or attachments for list-only navigation", async () => {
    const { result } = await run({ includeMessages: false, includeAttachments: false });
    expect(fixture.requests.map((r) => r.table)).toEqual(["mail_accounts", "mail_threads"]);
    expect(result.messages).toEqual([]);
    expect(result.attachments).toEqual([]);
  });
});
