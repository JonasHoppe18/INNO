// deno test --no-check --allow-read --allow-env supabase/functions/generate-draft-v2/draft-generation-trace.test.ts
//
// Verifies the no-write eval/dry-run mode for draft_generations tracing.
//
// These tests exercise the exact gating chain runDraftV2Pipeline uses:
//   isNoWriteDraftRun({ eval_payload, dry_run })  ->  mintGenerationId(isNoWrite)
//   ->  createDraftGenerationTrace / updateDraftGenerationTrace (no-op on dry-run id)
// A spy Supabase client records every write verb so we can assert that NO
// insert/update/upsert/delete reaches `draft_generations` in eval/dry-run mode,
// while production (no eval_payload, no dry_run) still writes exactly as before.
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  createDraftGenerationTrace,
  DRY_RUN_GENERATION_PREFIX,
  isDryRunGenerationId,
  isNoWriteDraftRun,
  mintGenerationId,
  updateDraftGenerationTrace,
} from "./pipeline.ts";

type WriteCalls = {
  insert: Array<{ table: string; row: unknown }>;
  update: Array<{ table: string; patch: unknown }>;
  upsert: Array<{ table: string; row: unknown }>;
  delete: Array<{ table: string }>;
};

function spyClient(): { client: any; calls: WriteCalls } {
  const calls: WriteCalls = { insert: [], update: [], upsert: [], delete: [] };
  const client = {
    from(table: string) {
      return {
        insert(row: unknown) {
          calls.insert.push({ table, row });
          return Promise.resolve({ error: null });
        },
        update(patch: unknown) {
          calls.update.push({ table, patch });
          return { eq: () => Promise.resolve({ error: null }) };
        },
        upsert(row: unknown) {
          calls.upsert.push({ table, row });
          return Promise.resolve({ error: null });
        },
        delete() {
          calls.delete.push({ table });
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
    },
  };
  return { client, calls };
}

// --- detection logic --------------------------------------------------------

Deno.test("isNoWriteDraftRun: eval_payload present => no-write", () => {
  assertEquals(isNoWriteDraftRun({ eval_payload: { subject: "x", body: "y" } }), true);
});

Deno.test("isNoWriteDraftRun: dry_run flag => no-write", () => {
  assertEquals(isNoWriteDraftRun({ dry_run: true }), true);
});

Deno.test("isNoWriteDraftRun: production (neither) => writes (unchanged)", () => {
  assertEquals(isNoWriteDraftRun({}), false);
  assertEquals(isNoWriteDraftRun({ dry_run: false }), false);
  assertEquals(isNoWriteDraftRun({ eval_payload: undefined }), false);
});

Deno.test("mintGenerationId: no-write id carries sentinel prefix; production id does not", () => {
  const dry = mintGenerationId(true);
  const prod = mintGenerationId(false);
  assert(dry.startsWith(DRY_RUN_GENERATION_PREFIX));
  assert(isDryRunGenerationId(dry));
  assert(!isDryRunGenerationId(prod));
});

// --- trace no-op behavior ---------------------------------------------------

Deno.test("eval/dry-run: createDraftGenerationTrace does NOT insert", async () => {
  const { client, calls } = spyClient();
  const id = mintGenerationId(isNoWriteDraftRun({ eval_payload: { subject: "s", body: "b" } }));
  await createDraftGenerationTrace({
    supabase: client,
    id,
    shop_id: "shop-1",
    thread_id: "t-1",
    message_id: "m-1",
    draft_id: "d-1",
  });
  assertEquals(calls.insert.length, 0, "no insert in dry-run");
  assertEquals(calls.update.length + calls.upsert.length + calls.delete.length, 0);
});

Deno.test("dry_run true: createDraftGenerationTrace does NOT insert/update/upsert/delete", async () => {
  const { client, calls } = spyClient();
  const id = mintGenerationId(isNoWriteDraftRun({ dry_run: true }));
  await createDraftGenerationTrace({
    supabase: client,
    id,
    shop_id: "shop-1",
    draft_id: "d-1",
  });
  await updateDraftGenerationTrace(client, id, { completed_at: "now", skip_reason: "x" });
  assertEquals(calls.insert.length, 0);
  assertEquals(calls.update.length, 0);
  assertEquals(calls.upsert.length, 0);
  assertEquals(calls.delete.length, 0);
});

Deno.test("eval/dry-run: updateDraftGenerationTrace does NOT update", async () => {
  const { client, calls } = spyClient();
  const id = mintGenerationId(true);
  await updateDraftGenerationTrace(client, id, { intent: "tracking" });
  assertEquals(calls.update.length, 0, "no update in dry-run");
});

// --- production behavior preserved ------------------------------------------

Deno.test("production: createDraftGenerationTrace inserts exactly one draft_generations row", async () => {
  const { client, calls } = spyClient();
  const id = mintGenerationId(isNoWriteDraftRun({})); // production
  await createDraftGenerationTrace({
    supabase: client,
    id,
    shop_id: "shop-1",
    thread_id: "t-1",
    message_id: "m-1",
    draft_id: "d-1",
  });
  assertEquals(calls.insert.length, 1);
  assertEquals(calls.insert[0].table, "draft_generations");
});

Deno.test("production: updateDraftGenerationTrace updates draft_generations", async () => {
  const { client, calls } = spyClient();
  const id = mintGenerationId(false);
  await updateDraftGenerationTrace(client, id, { completed_at: "now" });
  assertEquals(calls.update.length, 1);
  assertEquals(calls.update[0].table, "draft_generations");
});

Deno.test("production: empty patch is still a no-op (pre-existing guard preserved)", async () => {
  const { client, calls } = spyClient();
  const id = mintGenerationId(false);
  await updateDraftGenerationTrace(client, id, {});
  assertEquals(calls.update.length, 0);
});
