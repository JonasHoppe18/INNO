import { beforeEach, describe, expect, it, vi } from "vitest";
const sent = vi.hoisted(() =>
  vi.fn(async () => ({ MessageID: "provider-id" })),
);
vi.mock("../csat-response.js", () => ({ sendPublishedCsatSurveyEmail: sent }));
vi.mock("../customer-satisfaction.js", () => ({
  loadCustomerSatisfactionSettings: async () => ({ enabled: true }),
}));
import { dispatchDueCustomerSatisfactionSurveys } from "../customer-satisfaction-surveys.js";

function fixture() {
  const rows = [
    {
      id: "older",
      workspace_id: "workspace-a",
      thread_id: "thread-old",
      status: "pending",
      attempt_count: 0,
    },
    {
      id: "target",
      workspace_id: "workspace-a",
      thread_id: "thread-target",
      status: "pending",
      attempt_count: 0,
    },
    {
      id: "foreign",
      workspace_id: "workspace-b",
      thread_id: "thread-foreign",
      status: "pending",
      attempt_count: 0,
    },
  ];
  const changes = [];
  const client = {
    from(table) {
      const filters = [];
      let patch = null,
        single = false,
        limit = 100;
      const query = {
        select: () => query,
        eq: (key, value) => {
          filters.push([key, value]);
          return query;
        },
        in: () => query,
        lte: () => query,
        lt: () => query,
        not: () => query,
        order: () => query,
        limit: (value) => {
          limit = value;
          return query;
        },
        update: (value) => {
          patch = value;
          return query;
        },
        maybeSingle: () => {
          single = true;
          return query;
        },
        then: (resolve) => {
          let data;
          if (table === "csat_survey_requests") {
            data = rows
              .filter((row) =>
                filters.every(([key, value]) => row[key] === value),
              )
              .slice(0, limit);
            if (patch)
              changes.push(...data.map((row) => ({ id: row.id, ...patch })));
            if (single) data = data[0] || null;
          } else if (table === "mail_threads") {
            data = {
              id: filters.find(([key]) => key === "id")?.[1],
              workspace_id: "workspace-a",
              status: "resolved",
              customer_email: "customer@example.com",
              customer_name: "Alex",
            };
          } else if (table === "mail_accounts")
            data = { id: "mail-a", from_name: "Demo store" };
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return query;
    },
  };
  return { client, changes };
}
beforeEach(() => sent.mockClear());
describe("immediate CSAT dispatch", () => {
  it("sends the ticket being resolved even when an older survey is ahead in the queue", async () => {
    const { client, changes } = fixture();
    const result = await dispatchDueCustomerSatisfactionSurveys(client, {
      workspaceId: "workspace-a",
      threadId: "thread-target",
      limit: 1,
      origin: "https://dev.sona-ai.dk",
    });
    expect(result.results).toEqual([
      { id: "target", status: "sent", reason: null },
    ]);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent.mock.calls[0][1]).toMatchObject({
      workspaceId: "workspace-a",
      threadId: "thread-target",
    });
    expect(changes.every((change) => change.id === "target")).toBe(true);
    expect(changes.at(-1)).toMatchObject({
      status: "sent",
      provider_message_id: "provider-id",
    });
  });
  it("keeps the worker's existing queue behavior when no thread is specified", async () => {
    const { client } = fixture();
    const result = await dispatchDueCustomerSatisfactionSurveys(client, {
      workspaceId: "workspace-a",
      limit: 1,
    });
    expect(result.results[0].id).toBe("older");
  });
  it("never sends a ticket from another workspace", async () => {
    const { client } = fixture();
    const result = await dispatchDueCustomerSatisfactionSurveys(client, {
      workspaceId: "workspace-a",
      threadId: "thread-foreign",
      limit: 1,
    });
    expect(result.processed).toBe(0);
    expect(sent).not.toHaveBeenCalled();
  });
});
