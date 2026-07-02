// deno test --no-check -A supabase/functions/generate-draft-v2/stages/image-evidence-claim-check.test.ts
//
// AZ-1b — RED tests for the deterministic image-evidence claim guard.
//
// AZ-1's prompt-only image-honesty guidance is overridden by the customer's
// textual claim of attaching images. Production smoke (v296) reproduced:
//   "Jeg har set de vedhæftede billeder, og det ser ud til at være en fysisk skade."
// with ZERO real images reaching the model. This guard is the deterministic
// backstop (P1-style): when the count of real, vision-capable images passed to
// the writer is 0, the draft must not claim to have seen/assessed an image.
//
// Contract (mirrors checkLiveFactAndActionClaims):
//   checkImageEvidenceClaims({ draft_text, image_evidence_count, language? })
//     => { compliant, violations: [{ type, excerpt }], requires_review }
//
// Written BEFORE the module exists — every test is expected to FAIL RED
// (module resolution error: ./image-evidence-claim-check.ts not found).
import { assert, assertEquals } from "jsr:@std/assert@1";
import { checkImageEvidenceClaims } from "./image-evidence-claim-check.ts";

const VIOLATION = "image_claim/no_image_evidence";

// ── 1. Danish unsupported image claim, no evidence → violation ───────────────
Deno.test("DA image-seen claim with no evidence → no_image_evidence", () => {
  const r = checkImageEvidenceClaims({
    draft_text:
      "Jeg har set de vedhæftede billeder, og det ser ud til at være en fysisk skade.",
    image_evidence_count: 0,
  });
  assertEquals(r.compliant, false);
  assertEquals(r.requires_review, true);
  assert(r.violations.some((v) => v.type === VIOLATION));
});

// ── 2. Same Danish claim WITH real image evidence → compliant ───────────────
Deno.test("DA image-seen claim with 2 real images → compliant", () => {
  const r = checkImageEvidenceClaims({
    draft_text:
      "Jeg har set de vedhæftede billeder, og det ser ud til at være en fysisk skade.",
    image_evidence_count: 2,
  });
  assertEquals(r.compliant, true);
  assertEquals(r.violations.length, 0);
});

// ── 3. English unsupported image claim, no evidence → violation ─────────────
Deno.test("EN image-seen claim with no evidence → no_image_evidence", () => {
  const r = checkImageEvidenceClaims({
    draft_text: "I've seen the attached images. The photo shows a crack.",
    image_evidence_count: 0,
  });
  assertEquals(r.compliant, false);
  assert(r.violations.some((v) => v.type === VIOLATION));
});

// ── 4. Same English claim WITH real image evidence → compliant ──────────────
Deno.test("EN image-seen claim with 1 real image → compliant", () => {
  const r = checkImageEvidenceClaims({
    draft_text: "I've seen the attached images. The photo shows a crack.",
    image_evidence_count: 1,
  });
  assertEquals(r.compliant, true);
  assertEquals(r.violations.length, 0);
});

// ── 5. "From the image it looks like..." with no evidence → violation ───────
Deno.test("EN 'from the image' assessment with no evidence → no_image_evidence", () => {
  const r = checkImageEvidenceClaims({
    draft_text: "From the image it looks like the hinge is broken.",
    image_evidence_count: 0,
  });
  assertEquals(r.compliant, false);
  assert(r.violations.some((v) => v.type === VIOLATION));
});

// ── 6. False-positive guard: bare "det ser ud til" must NOT trigger ─────────
Deno.test("bare 'det ser ud til' (no image anchor) → compliant", () => {
  const r = checkImageEvidenceClaims({
    draft_text: "Det ser ud til at din ordre er forsinket.",
    image_evidence_count: 0,
  });
  assertEquals(r.compliant, true);
  assertEquals(r.violations.length, 0);
});

// ── 7. False-positive guard: bare "jeg kan se" must NOT trigger ─────────────
Deno.test("bare 'jeg kan se' (no image anchor) → compliant", () => {
  const r = checkImageEvidenceClaims({
    draft_text: "Jeg kan se din ordre i systemet.",
    image_evidence_count: 0,
  });
  assertEquals(r.compliant, true);
  assertEquals(r.violations.length, 0);
});

// ── 8. Neutral image request (offer to receive) → compliant ─────────────────
Deno.test("neutral image request 'hvis du har billeder' → compliant", () => {
  const r = checkImageEvidenceClaims({
    draft_text: "Hvis du har billeder af problemet, må du gerne sende dem.",
    image_evidence_count: 0,
  });
  assertEquals(r.compliant, true);
  assertEquals(r.violations.length, 0);
});

// ── 9. Neutral photo request → compliant ────────────────────────────────────
Deno.test("neutral photo request 'send gerne tydelige billeder' → compliant", () => {
  const r = checkImageEvidenceClaims({
    draft_text: "Send gerne tydelige billeder af skaden.",
    image_evidence_count: 0,
  });
  assertEquals(r.compliant, true);
  assertEquals(r.violations.length, 0);
});

// ── 10. Quoted customer line must be ignored (not the assistant's claim) ────
Deno.test("quoted customer image claim is stripped → compliant", () => {
  const r = checkImageEvidenceClaims({
    draft_text:
      "Tak for din besked.\n> billedet viser tydeligt skaden\nKan du sende dit ordrenummer, så vi kan hjælpe dig videre?",
    image_evidence_count: 0,
  });
  assertEquals(r.compliant, true);
  assertEquals(r.violations.length, 0);
});

// ── 11. Empty draft is trivially compliant ──────────────────────────────────
Deno.test("empty draft → compliant", () => {
  const r = checkImageEvidenceClaims({ draft_text: "", image_evidence_count: 0 });
  assertEquals(r.compliant, true);
  assertEquals(r.requires_review, false);
});

// ── 12. Regression replay: exact deployed smoke-D failure string ────────────
Deno.test("regression: deployed smoke-D failure string with no evidence → violation", () => {
  const r = checkImageEvidenceClaims({
    draft_text:
      "Hej Smoke,\n\nDet er ærgerligt at høre, at dit headset er gået i stykker. Jeg har set de vedhæftede billeder, og det ser ud til at være en fysisk skade.",
    image_evidence_count: 0,
  });
  assertEquals(r.compliant, false);
  assert(r.violations.some((v) => v.type === VIOLATION));
});

// ── AZ-1b.1: preposition variants the v297 guard misses ─────────────────────

// ── 13. "set PÅ de vedhæftede billeder" (v297 smoke-A2 miss) → violation ─────
Deno.test("DA 'har set på de vedhæftede billeder' with no evidence → no_image_evidence", () => {
  const r = checkImageEvidenceClaims({
    draft_text:
      "Jeg har set på de vedhæftede billeder, og det ser ud til at være en fysisk skade.",
    image_evidence_count: 0,
  });
  assertEquals(r.compliant, false);
  assertEquals(r.requires_review, true);
  assert(r.violations.some((v) => v.type === VIOLATION));
});

// ── 14. Same "set på" variant WITH real image evidence → compliant ──────────
Deno.test("DA 'har set på de vedhæftede billeder' with 1 real image → compliant", () => {
  const r = checkImageEvidenceClaims({
    draft_text:
      "Jeg har set på de vedhæftede billeder, og det ser ud til at være en fysisk skade.",
    image_evidence_count: 1,
  });
  assertEquals(r.compliant, true);
  assertEquals(r.violations.length, 0);
});

// ── 15. "kigget på billederne" with no evidence → violation ─────────────────
Deno.test("DA 'har kigget på billederne' with no evidence → no_image_evidence", () => {
  const r = checkImageEvidenceClaims({
    draft_text: "Jeg har kigget på billederne, og det ligner en fysisk skade.",
    image_evidence_count: 0,
  });
  assertEquals(r.compliant, false);
  assert(r.violations.some((v) => v.type === VIOLATION));
});

// ── 16. Same "kigget på billederne" WITH real image evidence → compliant ────
Deno.test("DA 'har kigget på billederne' with 1 real image → compliant", () => {
  const r = checkImageEvidenceClaims({
    draft_text: "Jeg har kigget på billederne, og det ligner en fysisk skade.",
    image_evidence_count: 1,
  });
  assertEquals(r.compliant, true);
  assertEquals(r.violations.length, 0);
});

// ── 17. False-positive guard: "kigget på" without an image noun → compliant ─
Deno.test("DA 'har kigget på din ordre' (no image noun) → compliant", () => {
  const r = checkImageEvidenceClaims({
    draft_text: "Jeg har kigget på din ordre.",
    image_evidence_count: 0,
  });
  assertEquals(r.compliant, true);
  assertEquals(r.violations.length, 0);
});

// ── READINESS-6e: thanking for images is a receipt claim ────────────────────
// Night-probe B14: "Tak for billederne, de hjælper os med at forstå problemet
// bedre." with image_evidence_count=0. Thanking for images asserts we received
// and can use them — a false statement when no vision-capable image reached
// the model. With real images present it stays compliant as before.

Deno.test("READINESS-6e: DA 'Tak for billederne' with no evidence → no_image_evidence", () => {
  const r = checkImageEvidenceClaims({
    draft_text:
      "Tak for billederne, de hjælper os med at forstå problemet bedre.",
    image_evidence_count: 0,
  });
  assertEquals(r.compliant, false);
  assert(r.violations.some((v) => v.type === "image_claim/no_image_evidence"));
});

Deno.test("READINESS-6e: DA 'Tak for billederne' with 1 real image → compliant", () => {
  const r = checkImageEvidenceClaims({
    draft_text:
      "Tak for billederne, de hjælper os med at forstå problemet bedre.",
    image_evidence_count: 1,
  });
  assertEquals(r.compliant, true);
});

Deno.test("READINESS-6e: EN 'Thanks for the photos' with no evidence → no_image_evidence", () => {
  const r = checkImageEvidenceClaims({
    draft_text: "Thanks for the photos, they help us understand the issue.",
    image_evidence_count: 0,
  });
  assertEquals(r.compliant, false);
  assert(r.violations.some((v) => v.type === "image_claim/no_image_evidence"));
});

Deno.test("READINESS-6e: 'tak for din besked' (no image noun) stays compliant", () => {
  const r = checkImageEvidenceClaims({
    draft_text: "Tak for din besked, vi vender tilbage hurtigst muligt.",
    image_evidence_count: 0,
  });
  assertEquals(r.compliant, true);
});

Deno.test("READINESS-6e: request to send images stays compliant", () => {
  const r = checkImageEvidenceClaims({
    draft_text: "Kan du sende billeder af fejlen? Tak for hjælpen.",
    image_evidence_count: 0,
  });
  assertEquals(r.compliant, true);
});
