// deno test --no-check -A supabase/functions/generate-draft-v2/stages/writer-prompt-shape.test.ts
//
// AZ-1 (Attachment honesty + invoice action-claim) — RED tests on the writer
// system-prompt SOURCE.
//
// The system prompt is built inline inside runWriter (writer.ts) and is not
// exported, so these tests assert on the prompt source text. They pin three
// contracts from the AceZone review fixes:
//   1. The prompt must NOT unconditionally tell the model it can "see" an
//      attachment (the "Anerkend at du kan se det" instruction).
//   2. The invoice "write as if attached now (past tense)" instruction must NOT
//      be unconditional — it must be gated on a confirmed executed invoice action.
//   3. The prompt must carry positive image-honesty guidance (never describe an
//      image unless evidence is actually available; never treat a signature/logo
//      as evidence; ask for clear photos when evidence is required but missing).
//
// Written BEFORE the fix — all assertions below are expected to FAIL now.
import { assert, assertEquals } from "jsr:@std/assert@1";

const src = await Deno.readTextFile(new URL("./writer.ts", import.meta.url));

// ── 1. RED: no unconditional "you can see the attachment" instruction ────────
Deno.test("writer prompt does not unconditionally tell the model it can see the attachment", () => {
  assert(
    !/Anerkend at du kan se det/i.test(src),
    "writer.ts still contains the unconditional 'Anerkend at du kan se det' attachment instruction",
  );
});

// ── 2. RED: invoice 'as if attached now (past tense)' is not unconditional ────
Deno.test("writer prompt has no unconditional 'invoice as if attached now (datid)' phrasing", () => {
  assert(
    !/skriv som om (?:den|fakturaen) er vedhæftet nu/i.test(src),
    "writer.ts still contains an unconditional invoice past-tense ('vedhæftet nu (datid)') instruction",
  );
});

// ── 3. RED: any invoice past-tense rule must be gated on a confirmed action ───
// Scan line-by-line: any line that instructs invoice ("faktura") in past tense
// ("datid") must also reference a confirmation gate (actionResult / executed /
// "er udført" / "bekræft"). Ungated lines are violations.
Deno.test("any invoice past-tense rule is gated on a confirmed executed invoice action", () => {
  const offenders = src.split("\n").filter((line) => {
    const low = line.toLowerCase();
    const invoicePastTense = low.includes("faktura") && low.includes("datid");
    if (!invoicePastTense) return false;
    const hasGate = /actionresult|er udført|bekræft|executed/.test(low);
    return !hasGate;
  });
  assertEquals(
    offenders,
    [],
    `Invoice past-tense instructions must reference a confirmed executed action. Ungated lines:\n${
      offenders.join("\n")
    }`,
  );
});

// ── 4. RED: positive image-honesty guidance is present ───────────────────────
Deno.test("writer prompt includes image-honesty guidance", () => {
  const low = src.toLowerCase();

  assert(
    /beskriv aldrig hvad et billede/.test(low),
    "missing rule: never describe what an image shows unless image evidence is actually available",
  );

  assert(
    /(signatur|logo)[\s\S]{0,160}(bevis|evidens)|(bevis|evidens)[\s\S]{0,160}(signatur|logo)/i
      .test(src),
    "missing rule: do not treat an email signature/logo as customer evidence",
  );

  assert(
    /(tydelige|klare) (fotos|billeder)/.test(low),
    "missing rule: ask for clear photos when image evidence is required but unavailable",
  );
});

import { computeWriterCostUsd } from "./writer.ts";

Deno.test("computeWriterCostUsd: known models, snapshot ids, unknowns", () => {
  // gpt-4o: 8500 in × $2.5/M + 130 out × $10/M = 0.02125 + 0.0013
  const c = computeWriterCostUsd("gpt-4o", 8500, 130);
  if (Math.abs((c ?? 0) - 0.02255) > 1e-9) throw new Error(`gpt-4o cost ${c}`);
  // Snapshot id maps to base price; nano must not match the gpt-5.4 row.
  if (computeWriterCostUsd("gpt-5.4-nano-2026-03-17", 1_000_000, 0) !== 0.2) {
    throw new Error("nano snapshot mapping");
  }
  if (computeWriterCostUsd("unknown-model", 100, 10) !== null) {
    throw new Error("unknown model must be null");
  }
  if (computeWriterCostUsd("gpt-4o", null, 10) !== null) {
    throw new Error("missing tokens must be null");
  }
});
