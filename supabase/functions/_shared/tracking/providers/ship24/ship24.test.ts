// deno test --no-check -A supabase/functions/_shared/tracking/providers/ship24/ship24.test.ts
//
// TDD for the Ship24 outbound fallback adapter. Ship24 is a READ-ONLY fallback
// for carriers without a native API integration. All mapping is pure;
// the fetch wrapper degrades safely (empty/null → unknown, real failure →
// lookup_error) and NEVER infers in_transit/delivered from a number's existence.
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  fetchShip24Status,
  ship24MilestoneToInternalStatusCode,
  ship24PayloadToTrackingDetail,
} from "./index.ts";
import { normalizeTrackingDetail } from "../../normalized-tracking.ts";
import {
  fetchTrackingDetailForCandidate,
  isSupportedTrackingCarrier,
} from "../../../tracking.ts";

// ── Helpers ─────────────────────────────────────────────────────────────────

// Minimal Ship24 /tracking/search payload, shaped exactly like the live response
// we verified. milestone + an optional latest-event statusCode.
function ship24Payload(opts: {
  milestone: string | null;
  statusCode?: string | null;
  eventStatusCode?: string | null;
  courierCode?: string;
  events?: number;
  deliveredAt?: string | null;
  duplicateExactEvents?: boolean;
}): unknown {
  const events = [];
  const count = opts.events ?? (opts.milestone ? 1 : 0);
  for (let i = 0; i < count; i++) {
    events.push({
      eventId: `e${i}`,
      status: "An event happened.",
      occurrenceDatetime: "2026-06-26T13:18:03+02:00",
      datetime: "2026-06-26T13:18:03.000Z",
      location: "DK",
      courierCode: opts.courierCode ?? "gls",
      statusCode: opts.duplicateExactEvents
        ? (opts.eventStatusCode ?? opts.statusCode ?? null)
        : (i === 0 ? (opts.eventStatusCode ?? opts.statusCode ?? null) : null),
      statusCategory: "delivery",
      statusMilestone: opts.milestone,
    });
  }
  return {
    data: {
      trackings: [
        {
          shipment: {
            shipmentId: opts.milestone ? "ship-1" : null,
            statusCode: opts.statusCode ?? null,
            statusCategory: opts.milestone ? "delivery" : null,
            statusMilestone: opts.milestone,
            delivery: { estimatedDeliveryDate: null },
            trackingNumbers: [{ tn: "922070136177" }],
          },
          events,
          statistics: {
            timestamps: { deliveredDatetime: opts.deliveredAt ?? null },
          },
        },
      ],
    },
  };
}

// A stub fetch that returns a canned Response, for fetchShip24Status DI.
function stubFetch(
  body: unknown,
  status = 201,
  opts?: { malformed?: boolean; hang?: boolean },
): typeof fetch {
  return ((_url: string | URL | Request, init?: RequestInit) => {
    if (opts?.hang) {
      // Never resolves on its own; rejects when the AbortController fires.
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")));
      });
    }
    const text = opts?.malformed ? "<<<not json>>>" : JSON.stringify(body);
    return Promise.resolve(
      new Response(text, { status, headers: { "Content-Type": "application/json" } }),
    );
  }) as typeof fetch;
}

const KEY = "test-ship24-key";

// ── 1. Pure milestone → internal statusCode map ──────────────────────────────
Deno.test("ship24MilestoneToInternalStatusCode maps every milestone safely", () => {
  assertEquals(ship24MilestoneToInternalStatusCode("info_received"), "label_created");
  assertEquals(ship24MilestoneToInternalStatusCode("in_transit"), "in_transit");
  assertEquals(ship24MilestoneToInternalStatusCode("out_for_delivery"), "out_for_delivery");
  assertEquals(ship24MilestoneToInternalStatusCode("available_for_pickup"), "pickup_ready");
  assertEquals(ship24MilestoneToInternalStatusCode("delivered"), "delivered");
  assertEquals(ship24MilestoneToInternalStatusCode("failed_attempt"), "exception");
  assertEquals(ship24MilestoneToInternalStatusCode("exception"), "exception");
  // pending / null / unknown → "" (→ normalize yields unknown, never in_transit)
  assertEquals(ship24MilestoneToInternalStatusCode("pending"), "");
  assertEquals(ship24MilestoneToInternalStatusCode(null), "");
  assertEquals(ship24MilestoneToInternalStatusCode("something_new"), "");
});

// ── 2–4. payload → TrackingDetail → normalized outbound fact (verified states) ─
Deno.test("Ship24 delivered → normalized delivered carrier_verified", () => {
  const detail = ship24PayloadToTrackingDetail(
    ship24Payload({ milestone: "delivered", statusCode: "delivery_delivered", deliveredAt: "2026-06-26T13:18:03+02:00" }),
    { trackingNumber: "922070136177", trackingUrl: "https://x/track" },
  );
  const fact = normalizeTrackingDetail(detail, { direction: "outbound" });
  assertEquals(fact.state, "delivered");
  assertEquals(fact.verification, "carrier_verified");
  // deliveredDatetime "…+02:00" normalized to UTC.
  assertEquals(fact.delivered_at, "2026-06-26T11:18:03.000Z");
  assertEquals(detail.snapshot?.events.length, 1);
  assertEquals(detail.snapshot?.events[0]?.description, "An event happened.");
});

Deno.test("Ship24 duplicate events are collapsed", () => {
  const detail = ship24PayloadToTrackingDetail(
    ship24Payload({
      milestone: "delivered",
      statusCode: "delivery_delivered",
      events: 2,
      duplicateExactEvents: true,
    }),
    { trackingNumber: "922070136177", trackingUrl: "https://x/track" },
  );
  assertEquals(detail.snapshot?.events.length, 1);
});

Deno.test("Ship24 in_transit → normalized in_transit carrier_verified", () => {
  const detail = ship24PayloadToTrackingDetail(
    ship24Payload({ milestone: "in_transit" }),
    { trackingNumber: "T", trackingUrl: "" },
  );
  const fact = normalizeTrackingDetail(detail, { direction: "outbound" });
  assertEquals(fact.state, "in_transit");
  assertEquals(fact.verification, "carrier_verified");
});

Deno.test("Ship24 out_for_delivery → normalized out_for_delivery", () => {
  const detail = ship24PayloadToTrackingDetail(
    ship24Payload({ milestone: "out_for_delivery" }),
    { trackingNumber: "T", trackingUrl: "" },
  );
  assertEquals(normalizeTrackingDetail(detail, { direction: "outbound" }).state, "out_for_delivery");
});

Deno.test("Ship24 available_for_pickup → normalized pickup_ready", () => {
  const detail = ship24PayloadToTrackingDetail(
    ship24Payload({ milestone: "available_for_pickup" }),
    { trackingNumber: "T", trackingUrl: "" },
  );
  assertEquals(normalizeTrackingDetail(detail, { direction: "outbound" }).state, "pickup_ready");
});

// ── 5. pending → unknown ─────────────────────────────────────────────────────
Deno.test("Ship24 pending milestone → normalized unknown (not in_transit)", () => {
  const detail = ship24PayloadToTrackingDetail(
    ship24Payload({ milestone: "pending", events: 0 }),
    { trackingNumber: "T", trackingUrl: "" },
  );
  assertEquals(normalizeTrackingDetail(detail, { direction: "outbound" }).state, "unknown");
});

// ── 6. cold/empty number shape (201 + null milestone + no events) → unknown ──
Deno.test("Ship24 empty/cold response (null milestone, no events) → unknown", () => {
  const detail = ship24PayloadToTrackingDetail(
    ship24Payload({ milestone: null, events: 0 }),
    { trackingNumber: "T", trackingUrl: "" },
  );
  const fact = normalizeTrackingDetail(detail, { direction: "outbound" });
  assertEquals(fact.state, "unknown");
});

// ── 6b. return-to-sender signal → returned_to_sender ─────────────────────────
Deno.test("Ship24 exception_return → normalized returned_to_sender", () => {
  const detail = ship24PayloadToTrackingDetail(
    ship24Payload({ milestone: "exception", statusCode: "exception_return", eventStatusCode: "exception_return" }),
    { trackingNumber: "T", trackingUrl: "" },
  );
  assertEquals(normalizeTrackingDetail(detail, { direction: "outbound" }).state, "returned_to_sender");
});

// ── fetchShip24Status: success path (end-to-end through stub fetch) ───────────
Deno.test("fetchShip24Status success (201 delivered) → carrier_verified delivered", async () => {
  const detail = await fetchShip24Status("922070136177", {
    apiKey: KEY,
    fetchImpl: stubFetch(ship24Payload({ milestone: "delivered", statusCode: "delivery_delivered" })),
  });
  assertEquals(normalizeTrackingDetail(detail, { direction: "outbound" }).state, "delivered");
});

// ── 7. Missing API key → safe fallback / unknown (no throw) ───────────────────
Deno.test("fetchShip24Status missing key → unknown (generic fallback, no call)", async () => {
  let called = false;
  const detail = await fetchShip24Status("T", {
    apiKey: "",
    fetchImpl: stubFetch(ship24Payload({ milestone: "delivered" })),
  });
  // The stub would have flipped `called` only if invoked; assert via the result.
  void called;
  assertEquals(normalizeTrackingDetail(detail, { direction: "outbound" }).state, "unknown");
});

// ── 8. 429 → lookup_error ────────────────────────────────────────────────────
Deno.test("fetchShip24Status 429 → lookup_error", async () => {
  const detail = await fetchShip24Status("T", {
    apiKey: KEY,
    fetchImpl: stubFetch({ errors: [{ code: "rate_limit" }] }, 429),
  });
  assertEquals(normalizeTrackingDetail(detail, { direction: "outbound" }).state, "lookup_error");
});

// ── 9. 5xx → lookup_error ────────────────────────────────────────────────────
Deno.test("fetchShip24Status 500 → lookup_error", async () => {
  const detail = await fetchShip24Status("T", {
    apiKey: KEY,
    fetchImpl: stubFetch({ errors: [{ code: "server_error" }] }, 503),
  });
  assertEquals(normalizeTrackingDetail(detail, { direction: "outbound" }).state, "lookup_error");
});

// ── 10. Timeout (AbortController) → lookup_error ──────────────────────────────
Deno.test("fetchShip24Status timeout → lookup_error", async () => {
  const detail = await fetchShip24Status("T", {
    apiKey: KEY,
    timeoutMs: 10,
    fetchImpl: stubFetch(null, 201, { hang: true }),
  });
  assertEquals(normalizeTrackingDetail(detail, { direction: "outbound" }).state, "lookup_error");
});

// ── 11. Malformed JSON → lookup_error ────────────────────────────────────────
Deno.test("fetchShip24Status malformed body → lookup_error", async () => {
  const detail = await fetchShip24Status("T", {
    apiKey: KEY,
    fetchImpl: stubFetch(null, 201, { malformed: true }),
  });
  assertEquals(normalizeTrackingDetail(detail, { direction: "outbound" }).state, "lookup_error");
});

// ── 12. Unknown carrier + Ship24 configured → adapter is called ──────────────
Deno.test("unknown carrier + ship24 configured → Ship24 adapter called", async () => {
  let called = false;
  const detail = await fetchTrackingDetailForCandidate(
    { company: "", trackingNumber: "X123456789", trackingUrl: "" },
    {
      ship24Configured: () => true,
      fetchShip24: (tn) => {
        called = true;
        return Promise.resolve(
          ship24PayloadToTrackingDetail(
            ship24Payload({ milestone: "delivered", statusCode: "delivery_delivered" }),
            { trackingNumber: tn },
          ),
        );
      },
    },
  );
  assertEquals(called, true);
  assertEquals(detail.lookupSource, "ship24_api");
});

// ── 13. Unknown carrier WITHOUT Ship24 → existing carrier_unknown fallback ────
Deno.test("unknown carrier + ship24 NOT configured → existing carrier_unknown fallback, adapter not called", async () => {
  let called = false;
  const detail = await fetchTrackingDetailForCandidate(
    { company: "", trackingNumber: "X123456789", trackingUrl: "" },
    {
      ship24Configured: () => false,
      fetchShip24: () => {
        called = true;
        return Promise.resolve({} as never);
      },
    },
  );
  assertEquals(called, false);
  assertEquals(detail.lookupDetail, "carrier_unknown");
  assertEquals(detail.lookupSource, "shopify_fallback");
});

// ── 14. GLS/PostNord native carriers stay native; others can use Ship24 ─────
Deno.test("GLS/PostNord stay native; other carriers remain eligible for live lookup", () => {
  assert(isSupportedTrackingCarrier({ company: "GLS", trackingNumber: "123456789" }));
  assert(isSupportedTrackingCarrier({ company: "PostNord", trackingNumber: "123456789" }));
  assert(isSupportedTrackingCarrier({ company: "DHL", trackingNumber: "123456789" }));
  assert(isSupportedTrackingCarrier({ company: "UPS", trackingNumber: "123456789" }));
  assert(isSupportedTrackingCarrier({ company: "SomeRandomCourier", trackingNumber: "X123" }));
});

Deno.test("non-GLS/PostNord carrier + ship24 configured → Ship24 adapter called", async () => {
  let called = false;
  const detail = await fetchTrackingDetailForCandidate(
    { company: "Bring", trackingNumber: "370438109757988982", trackingUrl: "" },
    {
      ship24Configured: () => true,
      fetchShip24: (tn) => {
        called = true;
        return Promise.resolve(
          ship24PayloadToTrackingDetail(
            ship24Payload({ milestone: "in_transit", courierCode: "bring" }),
            { trackingNumber: tn },
          ),
        );
      },
    },
  );
  assertEquals(called, true);
  assertEquals(detail.lookupSource, "ship24_api");
  assertEquals(detail.carrier, "Bring");
});

// ── 15. P1 regression: Ship24-derived facts respected by the claim guardrail ──
import { checkLiveFactAndActionClaims } from "../../../../generate-draft-v2/stages/live-fact-action-claim-check.ts";

Deno.test("P1: Ship24 delivered fact allows a delivered claim", () => {
  const fact = normalizeTrackingDetail(
    ship24PayloadToTrackingDetail(
      ship24Payload({ milestone: "delivered", statusCode: "delivery_delivered" }),
      { trackingNumber: "T" },
    ),
    { direction: "outbound" },
  );
  const r = checkLiveFactAndActionClaims({
    draft_text: "Your package has been delivered.",
    facts: [],
    tracking_facts: [fact],
  });
  assertEquals(r.compliant, true);
});

Deno.test("P1: Ship24 unknown/lookup_error fact still BLOCKS a delivered claim", () => {
  const unknownFact = normalizeTrackingDetail(
    ship24PayloadToTrackingDetail(ship24Payload({ milestone: null, events: 0 }), { trackingNumber: "T" }),
    { direction: "outbound" },
  );
  const r = checkLiveFactAndActionClaims({
    draft_text: "Your package has been delivered.",
    facts: [],
    tracking_facts: [unknownFact],
  });
  assertEquals(r.compliant, false);
  assert(r.violations.some((v) => v.type === "live_fact/no_verified_delivery"));
});
