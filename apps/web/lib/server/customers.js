import {
  getEffectiveSenderEmail,
  getEffectiveSenderName,
  normalizeEmailAddress,
} from "@/lib/inbox/sender";

const PAGE_SIZE = 1000;
const CLOSED_STATUSES = new Set([
  "solved",
  "resolved",
  "closed",
  "spam",
  "trash",
  "deleted",
]);

export function isOpenCustomerTicket(status) {
  return !CLOSED_STATUSES.has(String(status || "").toLowerCase());
}

export function buildCustomerDirectory({
  messages,
  threads,
  mailboxes,
  shops,
}) {
  const mailboxMap = new Map(mailboxes.map((row) => [row.id, row]));
  const shopMap = new Map(shops.map((row) => [row.id, row]));
  const threadMap = new Map(threads.map((row) => [row.id, row]));
  const ownEmails = new Set(
    mailboxes
      .flatMap((row) => [row.provider_email, row.from_email])
      .filter(Boolean)
      .map(normalizeEmailAddress),
  );
  const customers = new Map();

  for (const message of messages) {
    if (message.from_me || message.is_draft) continue;
    const thread = threadMap.get(message.thread_id);
    const mailbox = mailboxMap.get(message.mailbox_id);
    if (!thread || !mailbox || thread.mailbox_id !== mailbox.id) continue;
    // Missing or fallback classification is not evidence of spam.
    const classification = String(thread.classification_key || "")
      .trim()
      .toLowerCase();
    if (["spam", "notification"].includes(classification)) continue;
    if (
      String(thread.status || "")
        .trim()
        .toLowerCase() === "spam"
    )
      continue;
    const email = normalizeEmailAddress(getEffectiveSenderEmail(message));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || ownEmails.has(email))
      continue;
    const shop = shopMap.get(mailbox.shop_id);
    // Unlinked inboxes retain their own identity until a shop is connected.
    const shopId = shop?.id || null;
    const id = `${shopId || mailbox.id}:${email}`;
    const timestamp =
      message.received_at || message.sent_at || message.created_at;
    const name = getEffectiveSenderName(message) || email;
    let customer = customers.get(id);
    if (!customer) {
      customer = {
        id,
        email,
        name,
        shopId,
        shopName: shop?.shop_name || shop?.shop_domain || null,
        firstContactAt: timestamp,
        lastContactAt: timestamp,
        tickets: new Map(),
      };
      customers.set(id, customer);
    }
    if (timestamp > customer.lastContactAt) {
      customer.lastContactAt = timestamp;
      if (name !== email) customer.name = name;
    }
    if (customer.name === email && name !== email) customer.name = name;
    if (timestamp < customer.firstContactAt)
      customer.firstContactAt = timestamp;
    customer.tickets.set(thread.id, {
      id: thread.id,
      ticketNumber: thread.ticket_number,
      subject: thread.subject || "No subject",
      status: thread.status || "needs_attention",
      lastMessageAt: thread.last_message_at || timestamp,
    });
  }

  return [...customers.values()]
    .map((customer) => {
      const tickets = [...customer.tickets.values()].sort((a, b) =>
        String(b.lastMessageAt).localeCompare(String(a.lastMessageAt)),
      );
      return {
        ...customer,
        tickets,
        ticketCount: tickets.length,
        openTicketCount: tickets.filter((ticket) =>
          isOpenCustomerTicket(ticket.status),
        ).length,
      };
    })
    .sort((a, b) =>
      String(b.lastContactAt).localeCompare(String(a.lastContactAt)),
    );
}

async function readAll(buildQuery) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(
      offset,
      offset + PAGE_SIZE - 1,
    );
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

export async function loadCustomerDirectory(client, scope) {
  if (!scope?.workspaceId)
    throw new Error("Select a workspace to view customers.");
  const workspaceId = scope.workspaceId;
  const [mailboxes, shops] = await Promise.all([
    readAll(() =>
      client
        .from("mail_accounts")
        .select("id, shop_id, provider_email, from_email")
        .eq("workspace_id", workspaceId)
        .order("id"),
    ),
    readAll(() =>
      client
        .from("shops")
        .select("id, shop_name, shop_domain")
        .eq("workspace_id", workspaceId)
        .is("uninstalled_at", null)
        .order("id"),
    ),
  ]);
  if (!mailboxes.length) return { customers: [], shops };
  const [threads, messages] = await Promise.all([
    readAll(() =>
      client
        .from("mail_threads")
        .select(
          "id, mailbox_id, subject, status, ticket_number, last_message_at, classification_key",
        )
        .eq("workspace_id", workspaceId)
        .order("id"),
    ),
    readAll(() =>
      client
        .from("mail_messages")
        .select(
          "id, thread_id, mailbox_id, from_email, from_name, extracted_customer_email, extracted_customer_name, from_me, is_draft, received_at, sent_at, created_at",
        )
        .eq("workspace_id", workspaceId)
        .or("from_me.is.null,from_me.eq.false")
        .or("is_draft.is.null,is_draft.eq.false")
        .order("id"),
    ),
  ]);
  return {
    customers: buildCustomerDirectory({ messages, threads, mailboxes, shops }),
    shops,
  };
}
