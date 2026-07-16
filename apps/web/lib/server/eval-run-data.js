/**
 * Pure data helpers shared by the eval API routes. Keeping these transformations
 * outside route handlers makes the leak-prevention and aggregate rules directly
 * testable without auth, network or database mocks.
 */

export function normalizeEvalItems({ emails, thread_ids, zendesk_tickets } = {}) {
  const hasEmails = Array.isArray(emails) && emails.length > 0;
  const hasThreads = Array.isArray(thread_ids) && thread_ids.length > 0;
  const hasZendesk = Array.isArray(zendesk_tickets) && zendesk_tickets.length > 0;

  if (hasEmails) {
    const items = emails
      .map((email) => ({
        subject: String(email?.subject || "").trim(),
        body: String(email?.body || "").trim(),
      }))
      .filter((email) => email.body);
    return { mode: "manual", items };
  }

  if (hasThreads) {
    const items = thread_ids
      .map((id) => String(id || "").trim())
      .filter(Boolean);
    return { mode: "threads", items };
  }

  if (hasZendesk) {
    const items = zendesk_tickets
      .map((ticket) => ({
        id: String(ticket?.id || "").trim(),
        // UI-imported ticket examples have a synthetic `id`; the external id
        // is the only value that can exclude their own retrieval row.
        external_ticket_id: String(ticket?.external_ticket_id || "").trim(),
        subject: String(ticket?.subject || "").trim(),
        body: ticket?.body ?? ticket?.customer_body ?? "",
        customer_body: ticket?.customer_body ?? ticket?.body ?? "",
        human_reply: ticket?.human_reply ?? "",
        conversation_history: ticket?.conversation_history ?? "",
        anchor_class: ticket?.anchor_class ?? "comparable",
        anchor_signals: Array.isArray(ticket?.anchor_signals) ? ticket.anchor_signals : [],
        multi_turn: ticket?.multi_turn === true,
      }))
      .filter((ticket) => String(ticket.customer_body || ticket.body || "").trim());
    return { mode: "zendesk", items };
  }

  return { mode: null, items: [] };
}

export function evalSourceThreadId(ticket = {}) {
  const value =
    ticket?.external_ticket_id ||
    ticket?.source_thread_id ||
    ticket?.id ||
    "";
  return String(value).trim() || undefined;
}

export function summarizeEvalResults(results = []) {
  const allResults = Array.isArray(results) ? results : [];
  const aggregateResults = allResults.filter(
    (row) => row?.excluded_from_aggregate !== true,
  );
  const count = aggregateResults.length;
  const average = (key) => {
    if (count === 0) return null;
    const total = aggregateResults.reduce(
      (sum, row) => sum + (Number(row?.[key]) || 0),
      0,
    );
    return Math.round((total / count) * 10) / 10;
  };
  const rootCauses = aggregateResults.reduce((acc, row) => {
    const key = String(row?.likely_root_cause || "unknown");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return {
    count,
    total_count: allResults.length,
    excluded_count: allResults.length - count,
    send_ready_count: aggregateResults.filter((row) => row?.send_ready === true).length,
    root_causes: rootCauses,
    averages: {
      correctness: average("correctness"),
      completeness: average("completeness"),
      tone: average("tone"),
      actionability: average("actionability"),
      overall: average("overall"),
      overall_10: average("overall_10"),
    },
  };
}
