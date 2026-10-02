import { describe, expect, it } from "vitest";
import { buildCustomerDirectory, loadCustomerDirectory } from "../customers";

const mailboxes = [
  { id: "inbox-a", shop_id: "shop-a", from_email: "support@example.com" },
  { id: "inbox-b", shop_id: "shop-b" },
];
const shops = [
  { id: "shop-a", shop_name: "Store A" },
  { id: "shop-b", shop_name: "Store B" },
];
const threads = [
  {
    id: "one",
    mailbox_id: "inbox-a",
    status: "needs_attention",
    classification_key: "support",
    ticket_number: 12,
  },
  {
    id: "two",
    mailbox_id: "inbox-a",
    classification_key: "support",
    status: "Solved",
  },
  {
    id: "three",
    mailbox_id: "inbox-b",
    classification_key: "support",
    status: "waiting_customer",
  },
];
const message = (overrides = {}) => ({
  id: "m",
  thread_id: "one",
  mailbox_id: "inbox-a",
  from_email: "Ada@Example.com",
  from_name: "Ada",
  created_at: "2026-10-01T10:00:00Z",
  ...overrides,
});
function directory(messages) {
  return buildCustomerDirectory({ messages, threads, mailboxes, shops });
}

describe("customer directory identity", () => {
  it.each([
    { classification_key: "spam" },
    { classification_key: null },
    {
      classification_key: "support",
      classification_reason: "fallback:no_active_categories",
    },
    { classification_key: "notification" },
    { classification_key: "support", status: "Spam" },
  ])("excludes non-support and spam conversations: %j", (overrides) => {
    expect(
      buildCustomerDirectory({
        messages: [message()],
        threads: [{ ...threads[0], ...overrides }],
        mailboxes,
        shops,
      }),
    ).toEqual([]);
  });
  it("keeps support history when a customer also has spam tickets", () => {
    const [customer] = buildCustomerDirectory({
      messages: [message(), message({ thread_id: "two" })],
      threads: [threads[0], { ...threads[1], classification_key: "spam" }],
      mailboxes,
      shops,
    });
    expect(customer.ticketCount).toBe(1);
    expect(customer.tickets[0].id).toBe("one");
  });

  it("excludes system notifications from customer contacts", () => {
    const result = buildCustomerDirectory({
      messages: [message()],
      threads: [{ ...threads[0], classification_key: "notification" }],
      mailboxes,
      shops,
    });
    expect(result).toEqual([]);
  });
  it("deduplicates messages, collects all tickets and counts unresolved tickets", () => {
    const [customer] = directory([
      message(),
      message({ id: "m2" }),
      message({ id: "m3", thread_id: "two" }),
    ]);
    expect(customer).toMatchObject({
      email: "ada@example.com",
      ticketCount: 2,
      openTicketCount: 1,
      shopId: "shop-a",
    });
    expect(customer.tickets.map((t) => t.id)).toEqual(["one", "two"]);
  });
  it("keeps the same email in different stores separate", () => {
    const result = directory([
      message(),
      message({ mailbox_id: "inbox-b", thread_id: "three" }),
    ]);
    expect(result).toHaveLength(2);
    expect(new Set(result.map((c) => c.shopId))).toEqual(
      new Set(["shop-a", "shop-b"]),
    );
  });
  it("uses extracted contact form identity and excludes outgoing, drafts and mailbox senders", () => {
    const result = directory([
      message({
        extracted_customer_email: "bea@example.com",
        extracted_customer_name: "Bea",
      }),
      message({ from_me: true }),
      message({ is_draft: true }),
      message({ from_email: "support@example.com" }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ email: "bea@example.com", name: "Bea" });
  });
  it("does not attach messages from a different mailbox or unknown thread", () => {
    expect(
      directory([
        message({ thread_id: "unknown" }),
        message({ mailbox_id: "inbox-b" }),
      ]),
    ).toEqual([]);
  });
  it("requires workspace tenancy before making a database query", async () => {
    await expect(
      loadCustomerDirectory({}, { supabaseUserId: "owner" }),
    ).rejects.toThrow("Select a workspace");
  });
});
