import { assertEquals } from "jsr:@std/assert@1";

import {
  deriveTrackingStatus,
  isTrackingCacheFresh,
  normalizeTrackingNumber,
  trackingCacheRowToDetail,
  ttlForTrackingStatus,
} from "./tracking-cache.js";

Deno.test("normalizeTrackingNumber strips spaces and hyphens", () => {
  assertEquals(normalizeTrackingNumber(" ab-123 45 "), "AB12345");
});

Deno.test("deriveTrackingStatus treats parcel-box delivery text as delivered", () => {
  assertEquals(
    deriveTrackingStatus({
      carrier: "NO-POST",
      statusText: "Delivered from a parcel box.",
      snapshot: { statusText: "Delivered from a parcel box." },
    }),
    "delivered",
  );
});

Deno.test("delivered cache has longer TTL than in-transit cache", () => {
  assertEquals(ttlForTrackingStatus("delivered") > ttlForTrackingStatus("in_transit"), true);
});

Deno.test("isTrackingCacheFresh respects status-specific TTL", () => {
  const now = new Date("2026-07-05T10:00:00.000Z");
  assertEquals(
    isTrackingCacheFresh(
      { status: "in_transit", last_checked_at: "2026-07-05T09:30:00.000Z" },
      now,
    ),
    true,
  );
  assertEquals(
    isTrackingCacheFresh(
      { status: "in_transit", last_checked_at: "2026-07-05T08:30:00.000Z" },
      now,
    ),
    false,
  );
  assertEquals(
    isTrackingCacheFresh(
      { status: "delivered", last_checked_at: "2026-07-01T10:00:00.000Z" },
      now,
    ),
    true,
  );
});

Deno.test("trackingCacheRowToDetail rebuilds TrackingDetail shape", () => {
  const detail = trackingCacheRowToDetail({
    carrier: "NO-POST",
    status_text: "Delivered",
    tracking_number: "370438109757988982",
    tracking_url: "https://sporing.bring.no/sporing/370438109757988982",
    lookup_source: "ship24_api",
    lookup_detail: "ok",
    tracking_snapshot: {
      statusCode: "delivered",
      events: [{ description: "Delivered", occurredAt: "2026-05-28T19:18:00.000Z" }],
    },
  });
  assertEquals(detail.carrier, "NO-POST");
  assertEquals(detail.statusText, "Delivered");
  assertEquals(detail.lookupSource, "ship24_api");
  assertEquals(detail.snapshot.events.length, 1);
});
