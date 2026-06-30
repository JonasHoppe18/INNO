// deno test --no-check -A supabase/functions/generate-draft-v2/stages/attachment-loader.test.ts
//
// AZ-1 (Attachment honesty) — RED tests.
//
// loadImageAttachments currently ships EVERY image/* attachment to the model as
// multimodal evidence, including inline signature/logo assets (which carry a
// Postmark Content-ID in provider_attachment_id and are small). The model then
// claims "I can see the image you attached" about a logo. AZ-1 must drop inline
// signature/logo images (ContentID set AND small/logo-like size) while keeping
// real customer evidence (large images, or images with no ContentID).
//
// These tests are written BEFORE the fix. Some are RED (drive the feature),
// some are GREEN guards (pin behavior that must not regress).
import { assert, assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { loadImageAttachments } from "./attachment-loader.ts";

// ── Fake supabase: returns predefined rows for the .from(...).select...limit() chain ──
function fakeSupabaseReturning(rows: unknown[]): SupabaseClient {
  // deno-lint-ignore no-explicit-any
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => Promise.resolve({ data: rows, error: null }),
  };
  return { from: () => builder } as unknown as SupabaseClient;
}

// base64 string whose decoded length ≈ `bytes` (loader derives bytes from b64 length).
function b64OfBytes(bytes: number): string {
  return "A".repeat(Math.ceil((bytes * 4) / 3));
}

function inlineRow(opts: {
  filename?: string;
  mime?: string;
  contentId?: string | null;
  bytes: number;
}) {
  const mime = opts.mime ?? "image/png";
  return {
    filename: opts.filename ?? "file",
    mime_type: mime,
    size_bytes: opts.bytes,
    // Postmark ContentID for inline (cid:) assets; null for true attachments.
    provider_attachment_id: opts.contentId ?? null,
    storage_path: `inline:${mime};base64,${b64OfBytes(opts.bytes)}`,
    created_at: new Date().toISOString(),
  };
}

// ── 1. RED: inline image with ContentID + tiny size is excluded (signature/logo) ──
Deno.test("inline image with ContentID and tiny size is excluded (signature/logo)", async () => {
  const rows = [
    inlineRow({ filename: "logo.png", contentId: "<logo@acezone>", bytes: 1500 }),
  ];
  const out = await loadImageAttachments(fakeSupabaseReturning(rows), "msg-1");
  assertEquals(out.length, 0);
});

// ── 2. GUARD: large customer image with no ContentID is included ──────────────
Deno.test("large customer image with no ContentID is included", async () => {
  const rows = [
    inlineRow({
      filename: "photo.jpg",
      mime: "image/jpeg",
      contentId: null,
      bytes: 200_000,
    }),
  ];
  const out = await loadImageAttachments(fakeSupabaseReturning(rows), "msg-1");
  assertEquals(out.length, 1);
  assertEquals(out[0].filename, "photo.jpg");
});

// ── 3. GUARD (no false-negative): ContentID set but LARGE → still kept ────────
// The filter must be "ContentID AND small/logo-like", never ContentID alone — a
// customer can inline-embed a genuine large screenshot.
Deno.test("inline image with ContentID but large size is still included (not a logo)", async () => {
  const rows = [
    inlineRow({
      filename: "screenshot.png",
      contentId: "<embedded@cid>",
      bytes: 250_000,
    }),
  ];
  const out = await loadImageAttachments(fakeSupabaseReturning(rows), "msg-1");
  assertEquals(out.length, 1);
});

// ── 4. RED: filtering must not remove all legitimate image evidence ──────────
// A batch with one logo + two real photos must keep the two photos, drop the logo.
Deno.test("mixed batch: signature logo dropped but real customer photos kept", async () => {
  const rows = [
    inlineRow({ filename: "logo.png", contentId: "<logo@acezone>", bytes: 1200 }),
    inlineRow({
      filename: "defect1.jpg",
      mime: "image/jpeg",
      contentId: null,
      bytes: 120_000,
    }),
    inlineRow({
      filename: "defect2.jpg",
      mime: "image/jpeg",
      contentId: null,
      bytes: 130_000,
    }),
  ];
  const out = await loadImageAttachments(fakeSupabaseReturning(rows), "msg-1");
  assertEquals(out.length, 2);
  assert(out.every((i) => i.filename !== "logo.png"));
});

// ── 5. GUARD: MAX_IMAGES cap (3) still holds after filtering is added ─────────
Deno.test("MAX_IMAGES cap still holds — at most 3 images returned", async () => {
  const rows = [
    inlineRow({ filename: "a.jpg", mime: "image/jpeg", bytes: 50_000 }),
    inlineRow({ filename: "b.jpg", mime: "image/jpeg", bytes: 50_000 }),
    inlineRow({ filename: "c.jpg", mime: "image/jpeg", bytes: 50_000 }),
    inlineRow({ filename: "d.jpg", mime: "image/jpeg", bytes: 50_000 }),
  ];
  const out = await loadImageAttachments(fakeSupabaseReturning(rows), "msg-1");
  assertEquals(out.length, 3);
});
