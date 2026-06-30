// deno test --no-check --allow-read --allow-env supabase/functions/_shared/draft-feedback-emit.test.ts
//
// Feedback-1c-1: draft_generated emit into draft_feedback_events.
//
// Pins: row mapping, dedup_key, payload whitelist (no bodies), no-write/eval/
// dry-run suppression, 23505-as-success, error-without-throw, null-safe
// metadata, and routing/block mapping. Uses a spy Supabase client (no DB).

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  buildDraftGeneratedRow,
  emitDraftGeneratedEvent,
  DRAFT_GENERATED_ALLOWED_PAYLOAD_KEYS,
} from "./draft-feedback-emit.ts";

function spyClient(insertResult: { error: unknown } = { error: null }) {
  const calls: Array<{ table: string; row: any }> = [];
  const client = {
    from(table: string) {
      return {
        insert(row: unknown) {
          calls.push({ table, row });
          return Promise.resolve(insertResult);
        },
      };
    },
  };
  return { client, calls };
}

function makeLogger() {
  const warns: string[] = [];
  return { logger: { warn: (...a: unknown[]) => warns.push(a.join(" ")) }, warns };
}

const BASE = {
  generationId: "gen_1",
  draftId: "draft_uuid_1",
  threadId: "thread_1",
  messageId: "msg_1",
  shopId: "shop_1",
  workspaceId: "ws_1",
  routingHint: "review",
  blockSendRecommended: false,
  payload: { intent: "return", language: "da", pipeline_version: "v2", verifier_block_send: false },
};

Deno.test("builds a correct draft_generated row", () => {
  const row = buildDraftGeneratedRow(BASE) as Record<string, unknown>;
  assertEquals(row.event_type, "draft_generated");
  assertEquals(row.generation_id, "gen_1");
  assertEquals(row.draft_id, "draft_uuid_1");
  assertEquals(row.thread_id, "thread_1");
  assertEquals(row.message_id, "msg_1");
  assertEquals(row.shop_id, "shop_1");
  assertEquals(row.workspace_id, "ws_1");
  assertEquals(row.routing_hint, "review");
  assertEquals(row.block_send_recommended, false);
  assertEquals(row.dedup_key, "gen:gen_1");
  assertEquals(row.payload_json, {
    intent: "return", language: "da", pipeline_version: "v2", verifier_block_send: false,
  });
});

Deno.test("dedup_key is gen:{generationId}", () => {
  const row = buildDraftGeneratedRow({ ...BASE, generationId: "abc" }) as Record<string, unknown>;
  assertEquals(row.dedup_key, "gen:abc");
});

Deno.test("payload_json whitelist strips raw body / unknown keys", () => {
  const row = buildDraftGeneratedRow({
    ...BASE,
    payload: {
      intent: "return",
      final_draft_text: "AI draft body with 499kr refund",
      customer_text: "secret",
      body_text: "x",
      ai_draft: "y",
      surprise: "z",
    },
  }) as Record<string, unknown>;
  assertEquals(row.payload_json, { intent: "return" });
  const serialized = JSON.stringify(row);
  assert(!serialized.includes("499"), "no body content in row");
  assert(!serialized.includes("secret"), "no customer content in row");
  // every allowed key is one of the documented metadata keys
  for (const k of Object.keys(row.payload_json as object)) {
    assert(DRAFT_GENERATED_ALLOWED_PAYLOAD_KEYS.has(k), `${k} must be whitelisted`);
  }
});

Deno.test("routing_hint + block_send_recommended mapped; invalid routing -> null", () => {
  const ok = buildDraftGeneratedRow({ ...BASE, routingHint: "block", blockSendRecommended: true }) as Record<string, unknown>;
  assertEquals(ok.routing_hint, "block");
  assertEquals(ok.block_send_recommended, true);
  const bad = buildDraftGeneratedRow({ ...BASE, routingHint: "weird", blockSendRecommended: "yes" as unknown }) as Record<string, unknown>;
  assertEquals(bad.routing_hint, null);
  assertEquals(bad.block_send_recommended, null);
});

Deno.test("null-safe metadata: missing intent/language/product does not fail", () => {
  const row = buildDraftGeneratedRow({
    ...BASE,
    messageId: undefined,
    payload: { pipeline_version: "v2" },
  }) as Record<string, unknown>;
  assertEquals(row.message_id, null);
  assertEquals(row.payload_json, { pipeline_version: "v2" });
});

// --- emit behavior -------------------------------------------------------------

Deno.test("emit inserts into draft_feedback_events (production run)", async () => {
  const { client, calls } = spyClient();
  const res = await emitDraftGeneratedEvent({ ...BASE, supabase: client, isNoWrite: false });
  assertEquals(res.ok, true);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].table, "draft_feedback_events");
  assertEquals(calls[0].row.event_type, "draft_generated");
  assertEquals(calls[0].row.dedup_key, "gen:gen_1");
});

Deno.test("no-write / eval / dry-run emits nothing", async () => {
  const { client, calls } = spyClient();
  const res = await emitDraftGeneratedEvent({ ...BASE, supabase: client, isNoWrite: true });
  assertEquals(res.ok, false);
  assertEquals(res.skipped, "no_write");
  assertEquals(calls.length, 0);
});

Deno.test("missing shop/workspace skips (no insert)", async () => {
  const { client, calls } = spyClient();
  const a = await emitDraftGeneratedEvent({ ...BASE, shopId: "", supabase: client, isNoWrite: false });
  const b = await emitDraftGeneratedEvent({ ...BASE, workspaceId: undefined, supabase: client, isNoWrite: false });
  assertEquals(a.skipped, "missing_scope");
  assertEquals(b.skipped, "missing_scope");
  assertEquals(calls.length, 0);
});

Deno.test("duplicate 23505 is treated as success (deduped)", async () => {
  const { client, calls } = spyClient({ error: { code: "23505", message: "duplicate key" } });
  const { logger, warns } = makeLogger();
  const res = await emitDraftGeneratedEvent({ ...BASE, supabase: client, isNoWrite: false, logger });
  assertEquals(res.ok, true);
  assertEquals(res.deduped, true);
  assertEquals(calls.length, 1);
  assertEquals(warns.length, 0, "dedup is not a warning");
});

Deno.test("DB error is logged but does not throw into the pipeline", async () => {
  const { client } = spyClient({ error: { code: "42P01", message: "relation does not exist" } });
  const { logger, warns } = makeLogger();
  const res = await emitDraftGeneratedEvent({ ...BASE, supabase: client, isNoWrite: false, logger });
  assertEquals(res.ok, false);
  assert(warns.some((w) => w.includes("relation does not exist")), "error logged");
});

Deno.test("a throwing client never throws into the caller", async () => {
  const client = { from() { throw new Error("connection exploded"); } };
  const { logger } = makeLogger();
  const res = await emitDraftGeneratedEvent({ ...BASE, supabase: client, isNoWrite: false, logger });
  assertEquals(res.ok, false);
});

Deno.test("no serviceClient -> skip, no throw", async () => {
  const res = await emitDraftGeneratedEvent({ ...BASE, supabase: null, isNoWrite: false });
  assertEquals(res.ok, false);
});
