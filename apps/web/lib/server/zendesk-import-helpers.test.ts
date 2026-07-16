// @ts-nocheck
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  anchorFinalAgentReply,
  classifyZendeskAuthor,
  countZendeskRefreshResults,
  estimateImportCost,
  hasResidualZendeskPii,
  hasUnclassifiedZendeskPublicComment,
  importRetryDelayMs,
  isRetryableImportStatus,
  isZendeskAutoReply,
  mergeZendeskImportTags,
  nextCursor,
  nextExportCursor,
  nextZendeskPageCursor,
  parseRetryAfterMs,
  planZendeskRefreshCuration,
  stripZendeskHtml,
  zendeskCommentsToTurns,
} from "./zendesk-import-helpers.ts";

Deno.test("Zendesk HTML normalization preserves paragraphs and short human replies", () => {
  assertEquals(
    stripZendeskHtml(
      "<p>First &amp; useful.</p><p>Second line.<br>Next step.</p>",
    ),
    "First & useful.\nSecond line.\nNext step.",
  );
  assertEquals(isZendeskAutoReply("All fixed for you 🙂"), false);
  assertEquals(isZendeskAutoReply("Thanks!"), false);
  assertEquals(
    isZendeskAutoReply(
      "This is an automated reply. We have received your request.",
    ),
    true,
  );
});

Deno.test("Zendesk comments use author roles and preserve collaborator/CC order", () => {
  const roles = new Map<string, string>([
    ["10", "end-user"],
    ["20", "agent"],
    ["30", "admin"],
    ["40", "end-user"], // collaborator
    ["50", "end-user"], // CC
  ]);

  assertEquals(classifyZendeskAuthor(30, roles), "agent");
  assertEquals(classifyZendeskAuthor(999, roles), null);
  assertEquals(
    zendeskCommentsToTurns([
      { author_id: 10, public: true, body: "Original requester" },
      { author_id: 40, public: true, body: "Collaborator detail" },
      { author_id: 50, public: true, body: "CC detail" },
      { author_id: 30, public: true, html_body: "<p>Admin answer</p>" },
      { author_id: 999, public: true, body: "Unknown author" },
    ], roles),
    [
      { role: "customer", body: "Original requester" },
      { role: "customer", body: "Collaborator detail" },
      { role: "customer", body: "CC detail" },
      { role: "agent", body: "Admin answer" },
    ],
  );
});

Deno.test("Zendesk comments prefer plain text over HTML or fallback bodies", () => {
  assertEquals(
    zendeskCommentsToTurns([
      {
        id: 1,
        author_id: 10,
        public: true,
        plain_body: "Safe plain-text body",
        body: "Different fallback body",
        html_body: "<p>Different HTML body</p>",
      },
    ], { "10": "end-user" }),
    [{ role: "customer", body: "Safe plain-text body", sourceId: "1" }],
  );
});

Deno.test("unknown public authors block anchoring but private and system records do not", () => {
  const roles = { "10": "end-user", "20": "agent" };
  assert(
    hasUnclassifiedZendeskPublicComment([
      { author_id: 10, public: true, body: "Customer question" },
      { author_id: 999, public: true, body: "Unknown public participant" },
      { author_id: 20, public: true, body: "Agent reply" },
    ], roles),
  );
  assertEquals(
    hasUnclassifiedZendeskPublicComment([
      { author_id: 999, public: false, body: "Private note" },
      { author_id: 999, public: true, body: "   " },
      {
        author_id: 999,
        public: true,
        body: "System event",
        metadata: { flags: [4] },
      },
      { author_id: 10, public: true, body: "Customer question" },
      { author_id: 20, public: true, body: "Agent reply" },
    ], roles),
    false,
  );
});

Deno.test("residual PII validation rejects echoes and accepts neutral placeholders", () => {
  const raw = {
    subject: "Order 1234-ABC for John",
    customer_msg:
      "My name is John. Email john@example.com or call +45 12 34 56 78.\n12 Main Street",
    agent_reply: "I found order 1234-ABC.",
    conversation_context: "Tracking number ZXCV123456",
  };

  assert(
    hasResidualZendeskPii(raw, {
      ...raw,
      agent_reply: "I found order 1234-ABC for John.",
    }),
  );
  assertEquals(
    hasResidualZendeskPii(raw, {
      subject: "Order [order number]",
      customer_msg:
        "My name is [redacted]. Email [email] or call [phone].\n[address]",
      agent_reply: "I found order [order number].",
      conversation_context: "Tracking number [tracking number]",
    }),
    false,
  );
  assertEquals(
    hasResidualZendeskPii({
      subject: "A-Spire warranty",
      customer_msg: "Does the A-Spire have a 30 day return window?",
      agent_reply: "Yes, please keep the headset and packaging together.",
      conversation_context: "",
    }, {
      subject: "A-Spire warranty",
      customer_msg: "Does the A-Spire have a 30 day return window?",
      agent_reply: "Yes, please keep the headset and packaging together.",
      conversation_context: "",
    }),
    false,
  );
  assert(
    hasResidualZendeskPii({
      subject: "A-Spire help",
      customer_msg: "Hi Jonas,\nMy headset is noisy.\n2100 Copenhagen",
      agent_reply: "Best regards, Alex",
      conversation_context: "",
    }, {
      subject: "A-Spire help",
      customer_msg: "Hi Jonas,\nMy headset is noisy.\n2100 Copenhagen",
      agent_reply: "Best regards, Alex",
      conversation_context: "",
    }),
  );
  assert(
    hasResidualZendeskPii({
      subject: "A-Spire help",
      customer_msg: "Hi Jonas 👋\nMy headset is noisy.",
      agent_reply: "Best regards, Alex 🙂",
      conversation_context: "",
    }, {
      subject: "A-Spire help",
      customer_msg: "Hi Jonas 👋\nMy headset is noisy.",
      agent_reply: "Best regards, Alex 🙂",
      conversation_context: "",
    }),
  );
  assert(
    hasResidualZendeskPii({
      subject: "A-Spire help",
      customer_msg: "Hi José,\nMy headset is noisy.",
      agent_reply: "Best regards,\n[Agent]",
      conversation_context: "",
    }, {
      subject: "A-Spire help",
      customer_msg: "Hi José,\nMy headset is noisy.",
      agent_reply: "Best regards,\n[Agent]",
      conversation_context: "",
    }),
  );
  assertEquals(
    hasResidualZendeskPii({
      subject: "A-Spire help 2026-07-15",
      customer_msg: "Hi there,\nMy headset is noisy.",
      agent_reply: "Best regards,\n[Agent]",
      conversation_context: "Warranty began on 2026-07-15.",
    }, {
      subject: "A-Spire help 2026-07-15",
      customer_msg: "Hi there,\nMy headset is noisy.",
      agent_reply: "Best regards,\n[Agent]",
      conversation_context: "Warranty began on 2026-07-15.",
    }),
    false,
  );
});

Deno.test("Zendesk comments exclude unsafe records and filter auto-replies only for agents", () => {
  const roles = { "10": "end-user", "20": "agent" };
  assertEquals(
    zendeskCommentsToTurns([
      { author_id: 10, public: false, body: "Private note" },
      { author_id: 10, public: true, body: "   " },
      {
        author_id: 10,
        public: true,
        body: "Numeric system event",
        metadata: { flags: [4] },
      },
      {
        author_id: 20,
        public: true,
        body: "String system event",
        metadata: { flags: ["4"] },
      },
      {
        author_id: 20,
        public: true,
        body: "This is an automated reply. We have received your request.",
      },
      {
        author_id: 10,
        public: true,
        body: "Out of office — please contact my colleague.",
      },
      { author_id: 20, public: true, body: "A short human answer." },
    ], roles),
    [
      {
        role: "customer",
        body: "Out of office — please contact my colleague.",
      },
      { role: "agent", body: "A short human answer." },
    ],
  );
});

Deno.test("Zendesk page cursor advances safely and stops at the final page", () => {
  assertEquals(
    nextZendeskPageCursor({
      meta: { has_more: true, after_cursor: "opaque-next-page" },
    }),
    "opaque-next-page",
  );
  assertEquals(
    nextZendeskPageCursor({
      meta: { has_more: false, after_cursor: "ignored" },
    }),
    null,
  );
  assertEquals(
    nextZendeskPageCursor({ meta: { has_more: true, after_cursor: null } }),
    null,
  );
});

Deno.test("refresh helpers preserve tags and distinguish inserts from corrected rows", () => {
  assertEquals(
    mergeZendeskImportTags(["human_reviewed", "pii_scrubbed"]),
    ["human_reviewed", "pii_scrubbed", "final_agent_anchor_v1"],
  );
  assertEquals(
    countZendeskRefreshResults(["10", "11", "12", "12"], ["10", "12"]),
    { inserted: 1, updated: 2 },
  );
});

Deno.test("refresh curation resets stale legacy labels and preserves stable reviewed anchors", () => {
  const legacy = planZendeskRefreshCuration({
    existing: {
      tags: ["pii_scrubbed", "human_reviewed"],
      intent: "old_intent",
      language: "en",
      csat_score: 99,
    },
    anchorTag: "zendesk_anchor_v1:20:21",
    jobId: "job-a",
  });
  assertEquals(legacy, {
    tags: [
      "pii_scrubbed",
      "final_agent_anchor_v1",
      "zendesk_anchor_v1:20:21",
      "pair_labels_reset_v1",
    ],
    intent: null,
    language: null,
    csat_score: null,
    outcome: "refreshed",
  });

  const stable = planZendeskRefreshCuration({
    existing: {
      tags: [
        "pii_scrubbed",
        "final_agent_anchor_v1",
        "zendesk_anchor_v1:20:21",
        "human_reviewed",
      ],
      intent: "technical_support",
      language: "en",
      csat_score: 100,
    },
    anchorTag: "zendesk_anchor_v1:20:21",
    jobId: "job-b",
  });
  assertEquals(stable.intent, "technical_support");
  assertEquals(stable.language, "en");
  assertEquals(stable.csat_score, 100);
  assertEquals(stable.outcome, "refreshed");
  assert(stable.tags.includes("human_reviewed"));
});

Deno.test("refresh curation keeps insert outcome stable across a same-job retry", () => {
  const first = planZendeskRefreshCuration({
    existing: null,
    anchorTag: "zendesk_anchor_v1:30:31",
    jobId: "job-c",
  });
  assertEquals(first.outcome, "inserted");
  assert(first.tags.includes("zendesk_import_job:job-c"));

  const retried = planZendeskRefreshCuration({
    existing: { tags: first.tags },
    anchorTag: "zendesk_anchor_v1:30:31",
    jobId: "job-c",
  });
  assertEquals(retried.outcome, "inserted");
});

Deno.test("anchorFinalAgentReply pairs the final agent reply with its customer turn and prior context", () => {
  const anchored = anchorFinalAgentReply([
    { role: "customer", body: "My headset will not connect." },
    { role: "agent", body: "Please reset the dongle and try again." },
    { role: "customer", body: "I reset it, but the issue remains." },
    {
      role: "agent",
      body: "Thanks. I have a second troubleshooting step for you.",
    },
  ]);

  assertEquals(anchored, {
    customerBody: "I reset it, but the issue remains.",
    agentReply: "Thanks. I have a second troubleshooting step for you.",
    conversationContext:
      "Customer: My headset will not connect.\n\nAgent: Please reset the dongle and try again.",
    multiTurn: true,
  });
});

Deno.test("anchorFinalAgentReply handles single exchanges and rejects incomplete conversations", () => {
  assertEquals(
    anchorFinalAgentReply([
      { role: "customer", body: "Where is my order?" },
      { role: "agent", body: "It is due tomorrow." },
    ]),
    {
      customerBody: "Where is my order?",
      agentReply: "It is due tomorrow.",
      conversationContext: null,
      multiTurn: false,
    },
  );
  assertEquals(
    anchorFinalAgentReply([{ role: "customer", body: "Hello?" }]),
    null,
  );
  assertEquals(
    anchorFinalAgentReply([{ role: "agent", body: "Hello." }]),
    null,
  );
});

Deno.test("anchorFinalAgentReply retains stable Zendesk comment ids for curation invalidation", () => {
  assertEquals(
    anchorFinalAgentReply([
      { role: "customer", body: "Question", sourceId: "comment-10" },
      { role: "agent", body: "Answer", sourceId: "comment-11" },
    ]),
    {
      customerBody: "Question",
      agentReply: "Answer",
      conversationContext: null,
      multiTurn: false,
      customerTurnId: "comment-10",
      agentTurnId: "comment-11",
    },
  );
});

Deno.test("estimateImportCost scales linearly and reports both currencies", () => {
  const e1 = estimateImportCost({ ticketCount: 1000 });
  const e2 = estimateImportCost({ ticketCount: 2000 });
  assertEquals(e1.ticketCount, 1000);
  assert(e1.usd > 0 && e1.dkk > e1.usd); // DKK-tal er større end USD-tal
  assert(Math.abs(e2.usd - 2 * e1.usd) < 0.01);
  assertEquals(estimateImportCost({ ticketCount: 0 }).usd, 0);
});

Deno.test("nextCursor walks pages then statuses then finishes", () => {
  const statuses = ["solved", "closed"];
  // start
  assertEquals(nextCursor({ statuses, cursor: null, pageHadFullBatch: true }), {
    status: "solved",
    page: 1,
  });
  // full batch -> next page, same status
  assertEquals(
    nextCursor({
      statuses,
      cursor: { status: "solved", page: 3 },
      pageHadFullBatch: true,
    }),
    { status: "solved", page: 4 },
  );
  // short batch -> first page of next status
  assertEquals(
    nextCursor({
      statuses,
      cursor: { status: "solved", page: 3 },
      pageHadFullBatch: false,
    }),
    { status: "closed", page: 1 },
  );
  // short batch on last status -> done
  assertEquals(
    nextCursor({
      statuses,
      cursor: { status: "closed", page: 9 },
      pageHadFullBatch: false,
    }),
    null,
  );
});

Deno.test("import retry helpers respect transient statuses and retry-after", () => {
  assert(isRetryableImportStatus(408));
  assert(isRetryableImportStatus(429));
  assert(isRetryableImportStatus(503));
  assertEquals(isRetryableImportStatus(400), false);
  assertEquals(parseRetryAfterMs("2"), 2000);
  assertEquals(
    parseRetryAfterMs(
      "Thu, 01 Jan 2026 00:00:05 GMT",
      Date.parse("2026-01-01T00:00:00Z"),
    ),
    5000,
  );
  assertEquals(importRetryDelayMs({ attempt: 0 }), 750);
  assertEquals(importRetryDelayMs({ attempt: 2, retryAfterMs: 5000 }), 5000);
  assertEquals(importRetryDelayMs({ attempt: 9 }), 12000);
});

Deno.test("nextExportCursor advances opaque cursors and status segments", () => {
  const now = "2026-07-11T18:00:00.000Z";
  assertEquals(
    nextExportCursor({
      statuses: ["solved", "closed"],
      cursor: { status: "solved", after: null },
      hasMore: true,
      afterCursor: "opaque-cursor",
      now,
    }),
    {
      status: "solved",
      after: "opaque-cursor",
      after_created_at: now,
    },
  );
  assertEquals(
    nextExportCursor({
      statuses: ["solved", "closed"],
      cursor: { status: "solved", after: "opaque-cursor" },
      hasMore: false,
      afterCursor: null,
    }),
    { status: "closed", after: null },
  );
  assertEquals(
    nextExportCursor({
      statuses: ["solved", "closed"],
      cursor: { status: "closed", after: null },
      hasMore: false,
      afterCursor: null,
    }),
    null,
  );
  let missingCursorError: Error | null = null;
  try {
    nextExportCursor({
      statuses: ["solved", "closed"],
      cursor: { status: "solved", after: null },
      hasMore: true,
      afterCursor: null,
    });
  } catch (error) {
    missingCursorError = error as Error;
  }
  assert(missingCursorError);
  assert(missingCursorError.message.includes("without a cursor"));
});
