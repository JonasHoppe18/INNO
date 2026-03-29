import { assertEquals } from "jsr:@std/assert@1";

import {
  evaluateThreadContextGate,
  hasThreadReplyHeaders,
} from "./thread-context-gate.ts";

Deno.test("new ticket with no prior history is allowed", () => {
  const result = evaluateThreadContextGate({
    hasReplyHeaders: false,
    dbHistoryCount: 0,
    quotedFallbackCount: 0,
  });

  assertEquals(result.is_follow_up, false);
  assertEquals(result.has_sufficient_context, false);
  assertEquals(result.should_block_normal_reply, false);
});

Deno.test("existing thread with DB history is allowed", () => {
  const result = evaluateThreadContextGate({
    hasReplyHeaders: false,
    dbHistoryCount: 2,
    quotedFallbackCount: 0,
  });

  assertEquals(result.is_follow_up, true);
  assertEquals(result.has_sufficient_context, true);
  assertEquals(result.should_block_normal_reply, false);
  assertEquals(result.context_source, "db_history");
});

Deno.test("existing thread with no DB history but quoted fallback is allowed", () => {
  const result = evaluateThreadContextGate({
    hasReplyHeaders: true,
    dbHistoryCount: 0,
    quotedFallbackCount: 1,
  });

  assertEquals(result.is_follow_up, true);
  assertEquals(result.has_sufficient_context, true);
  assertEquals(result.should_block_normal_reply, false);
  assertEquals(result.context_source, "quoted_fallback");
});

Deno.test("existing thread with insufficient context is blocked", () => {
  const result = evaluateThreadContextGate({
    hasReplyHeaders: true,
    dbHistoryCount: 0,
    quotedFallbackCount: 0,
  });

  assertEquals(result.is_follow_up, true);
  assertEquals(result.has_sufficient_context, false);
  assertEquals(result.should_block_normal_reply, true);
  assertEquals(result.context_source, "none");
});

Deno.test("non-follow-up tickets are unaffected even with zero context", () => {
  const result = evaluateThreadContextGate({
    hasReplyHeaders: false,
    dbHistoryCount: 0,
    quotedFallbackCount: 0,
  });

  assertEquals(result.is_follow_up, false);
  assertEquals(result.should_block_normal_reply, false);
});

Deno.test("reply header detection finds In-Reply-To or References", () => {
  assertEquals(
    hasThreadReplyHeaders([
      { name: "Subject", value: "Re: Test" },
      { name: "In-Reply-To", value: "<abc@example.com>" },
    ]),
    true,
  );
  assertEquals(
    hasThreadReplyHeaders([
      { name: "References", value: "<abc@example.com> <def@example.com>" },
    ]),
    true,
  );
  assertEquals(
    hasThreadReplyHeaders([
      { name: "Subject", value: "New ticket" },
    ]),
    false,
  );
});

