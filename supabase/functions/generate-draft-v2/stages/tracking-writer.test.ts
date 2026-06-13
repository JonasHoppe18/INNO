import { assert, assertStringIncludes } from "jsr:@std/assert@1";
import { buildTrackingDirective } from "./writer.ts";
import type { TrackingFact } from "../../_shared/tracking/normalized-tracking.ts";

function f(p: Partial<TrackingFact>): TrackingFact {
  return {
    tracking_number: "T1",
    carrier: "GLS",
    direction: "outbound",
    verification: "carrier_verified",
    state: "in_transit",
    ...p,
  };
}

// 16, 17, 18 + return semantics: forbidden promises across all states
Deno.test("tracking directive never promises monitoring / notification / auto-refund", () => {
  const states: TrackingFact["state"][] = ["in_transit", "delivered", "lookup_error", "unknown", "returned_to_sender"];
  for (const dir of ["outbound", "return"] as const) {
    for (const state of states) {
      const d = buildTrackingDirective([f({ direction: dir, state, verification: dir === "return" ? "customer_provided" : "carrier_verified" })]).toLowerCase();
      assert(!/holder øje med|keep an eye|overvåg/.test(d), `${dir}/${state} must not promise monitoring`);
      assert(!/(giver|sender) (dig )?besked automatisk|underretter automatisk|notify you automatically/.test(d), `${dir}/${state} no auto-notification`);
      assert(!/refunder(ingen)? (igangsættes|starter) automatisk|automatically (initiate|start) the refund/.test(d), `${dir}/${state} no auto-refund`);
    }
  }
});

// 14. delivered return → does not imply internal processing
Deno.test("return delivered: carrier delivered but not internally processed", () => {
  const d = buildTrackingDirective([f({ direction: "return", verification: "carrier_verified", state: "delivered" })]).toLowerCase();
  assertStringIncludes(d, "leveret");
  assert(/ikke[^.]*behandlet|ikke[^.]*intern/.test(d), "must say not internally processed");
});

// 15. delivered outbound → does not imply customer personally received
Deno.test("outbound delivered: tracking shows delivered, not asserted received", () => {
  const d = buildTrackingDirective([f({ direction: "outbound", verification: "carrier_verified", state: "delivered" })]).toLowerCase();
  assert(/tracking[^.]*leveret|leveret[^.]*ifølge/.test(d), "frames as carrier tracking");
  assert(/ikke[^.]*modtaget|hvis kunden/.test(d), "must not assert customer received");
});

// lookup_error distinct from unknown; never in transit
Deno.test("lookup_error vs unknown distinct, neither says in transit", () => {
  const le = buildTrackingDirective([f({ state: "lookup_error" })]).toLowerCase();
  const uk = buildTrackingDirective([f({ state: "unknown" })]).toLowerCase();
  assert(le !== uk);
  assert(!/på vej|in transit/.test(le));
  assertStringIncludes(le, "ikke verificere");
});

// customer-provided return unverified → no in_transit/delivered claim
Deno.test("return customer_provided unverified → acknowledge only, no status claim", () => {
  const d = buildTrackingDirective([f({ direction: "return", verification: "customer_provided", state: "unknown" })]).toLowerCase();
  assert(!/på vej|leveret|in transit|delivered/.test(d.replace(/ikke[^.]*leveret/g, "")));
});

// multi-parcel directive states multiple shipments, no shared status
Deno.test("multiple outbound parcels → directive notes multiple shipments", () => {
  const d = buildTrackingDirective([
    f({ tracking_number: "A", state: "in_transit" }),
    f({ tracking_number: "B", state: "delivered" }),
  ]).toLowerCase();
  assert(/flere forsendelser|multiple shipments/.test(d));
});

Deno.test("empty facts → empty directive", () => {
  assert(buildTrackingDirective([]) === "");
});
