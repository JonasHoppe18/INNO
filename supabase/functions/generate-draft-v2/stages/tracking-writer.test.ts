import { assert, assertStringIncludes } from "jsr:@std/assert@1";
import { buildTrackingDirective, customerClaimsNotReceived } from "./writer.ts";
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

// --- Delivered-not-received safe workflow -----------------------------------

// Affirmative PROMISE phrasings only. The directive legitimately *names* these
// actions inside its FORBUDT/prohibition list ("love genfremsendelse", etc.) to
// instruct the model not to promise them — so we must assert the absence of
// affirmative commitments, not the bare nouns.
const DNR_FORBIDDEN = [
  // refund
  "vi refunderer dig", "we will refund", "vil blive refunderet",
  // replacement / reshipment
  "vi sender en ny", "vi sender et nyt", "we will send a new", "send you a new",
  "vi genfremsender", "we will reship", "we will resend",
  // compensation
  "du vil blive kompenseret", "you will be compensated", "vi kompenserer",
  // guaranteed claim / outcome
  "vi opretter en erstatningssag for", "we will file a claim", "vi garanterer at",
];

function dnr(state: TrackingFact["state"] = "delivered") {
  return buildTrackingDirective(
    [f({ direction: "outbound", verification: "carrier_verified", state })],
    { customerClaimsNotReceived: true },
  ).toLowerCase();
}

// 1. delivered + not-received → triggers the workflow block
Deno.test("delivered + not received → triggers delivered-not-received workflow", () => {
  const d = dnr();
  assertStringIncludes(d, "delivered-not-received");
});

// 2. says carrier tracking shows delivered
Deno.test("delivered-not-received: states tracking shows delivered", () => {
  assert(/tracking[^.]*leveret|viser[^.]*leveret/.test(dnr()));
});

// 3. does not claim customer personally received it
Deno.test("delivered-not-received: does not assert personal receipt", () => {
  const d = dnr();
  assert(/ikke nødvendigvis|ikke[^.]*personligt[^.]*modtaget/.test(d));
});

// 4. asks customer to confirm delivery address
Deno.test("delivered-not-received: asks to confirm delivery address", () => {
  assertStringIncludes(dnr(), "leveringsadressen");
});

// 5. suggests checking neighbours / household / reception / safe place / parcel shop
Deno.test("delivered-not-received: suggests nearby places to check", () => {
  const d = dnr();
  assertStringIncludes(d, "naboer");
  assertStringIncludes(d, "husstand");
  assertStringIncludes(d, "reception");
  assertStringIncludes(d, "pakkeshop");
  assert(/sikre steder|sikkert sted|postkasse/.test(d));
});

// 6. says case can be reviewed/investigated further
Deno.test("delivered-not-received: says case can be investigated further", () => {
  assert(/undersøge[^.]*nærmere|undersøge forsendelsen/.test(dnr()));
});

// 7-11. no refund / replacement / reshipment / compensation / unsupported claim promises
Deno.test("delivered-not-received: makes no refund/replacement/reshipment/compensation/claim promises", () => {
  const d = dnr();
  // explicit prohibition section is present
  assertStringIncludes(d, "forbudt");
  // and no affirmative promise is made
  for (const phrase of DNR_FORBIDDEN) {
    assert(!d.includes(phrase), `must not contain affirmative promise "${phrase}"`);
  }
});

// 12. ordinary delivered (no dispute) is unchanged — no workflow block
Deno.test("delivered WITHOUT not-received signal → no workflow block (unchanged)", () => {
  const plain = buildTrackingDirective(
    [f({ direction: "outbound", verification: "carrier_verified", state: "delivered" })],
  ).toLowerCase();
  assert(!plain.includes("delivered-not-received"));
  assert(!plain.includes("leveringsadressen"));
  // stable existing semantics preserved
  assert(/tracking[^.]*leveret|leveret[^.]*ifølge/.test(plain));
});

// 13. in_transit + not-received signal → no workflow block (only delivered triggers)
Deno.test("in_transit + not-received signal → no workflow block", () => {
  const d = dnr("in_transit");
  assert(!d.includes("delivered-not-received"));
  assert(!d.includes("leveringsadressen"));
  assert(/på vej/.test(d));
});

// customerClaimsNotReceived detection — EN + DA phrasings
Deno.test("customerClaimsNotReceived detects EN/DA not-received phrasings", () => {
  for (
    const m of [
      "I did not receive my order",
      "I haven't received the package",
      "It says delivered but I never got it",
      "my package is missing",
      "I can't find the parcel anywhere",
      "tracking says delivered but it's not here",
      "Jeg har ikke modtaget min pakke",
      "Pakken er ikke kommet",
      "der står leveret men jeg har ikke fået den",
      "min pakke mangler",
    ]
  ) {
    assert(customerClaimsNotReceived(m), `should detect: ${m}`);
  }
  for (
    const m of [
      "Thank you, I received my order today",
      "Where is my tracking number?",
      "Jeg vil gerne returnere min ordre",
      "",
      null,
    ]
  ) {
    assert(!customerClaimsNotReceived(m), `should NOT detect: ${m}`);
  }
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

// --- Customer-provided return tracking, carrier status NOT verified ----------

const FORBIDDEN_EN = [
  "refund will be issued",
  "refund will be initiated",
  "once processed",
  "once received",
  "once we receive",
  "keep an eye",
  "monitor",
  "you will be notified",
];

// 1. unsupported / unknown customer-provided return tracking → no unsafe wording
Deno.test("return customer_provided/unknown directive contains no unsafe workflow wording", () => {
  const d = buildTrackingDirective([f({ direction: "return", verification: "customer_provided", state: "unknown", carrier: "USPS" })]).toLowerCase();
  for (const phrase of FORBIDDEN_EN) assert(!d.includes(phrase), `must not contain "${phrase}"`);
  // no refund-timing/notification promise
  assert(!/\d+\s*(?:-\s*\d+\s*)?(?:dage|days|hverdage)/.test(d));
});

// 2. it DOES include the required safe content (+ carrier name when known)
Deno.test("return customer_provided/unknown directive includes required safe content", () => {
  const d = buildTrackingDirective([f({ direction: "return", verification: "customer_provided", state: "unknown", carrier: "USPS" })]).toLowerCase();
  assertStringIncludes(d, "modtaget retur-tracking-nummeret"); // acknowledged
  assertStringIncludes(d, "usps-trackingstatus"); // names the carrier
  assertStringIncludes(d, "ikke kan verificere"); // cannot verify carrier status
  assert(/ankommet|modtaget/.test(d)); // cannot confirm arrived/received
  assertStringIncludes(d, "behandlet internt"); // cannot confirm internally processed
  assertStringIncludes(d, "refunderingen endnu ikke er udstedt"); // no refund issued
  assertStringIncludes(d, "undersøge returstatus nærmere"); // can be reviewed further
});

// unknown carrier (no carrier name) → generic carrier wording
Deno.test("return unverified without carrier name → generic carrier wording", () => {
  const d = buildTrackingDirective([f({ direction: "return", verification: "customer_provided", state: "unknown", carrier: undefined })]).toLowerCase();
  assertStringIncludes(d, "carrier-trackingstatus");
});

// 3. lookup_error return follows the SAME safety rules
Deno.test("return lookup_error directive follows the same safe structure", () => {
  const d = buildTrackingDirective([f({ direction: "return", verification: "customer_provided", state: "lookup_error", carrier: "USPS" })]).toLowerCase();
  for (const phrase of FORBIDDEN_EN) assert(!d.includes(phrase), `lookup_error must not contain "${phrase}"`);
  assertStringIncludes(d, "ikke kan verificere");
  assertStringIncludes(d, "undersøge returstatus nærmere");
});

// 4 & 5. outbound GLS/PostNord delivered directive unchanged + free of return wording
Deno.test("outbound delivered directive unchanged and carries no return-workflow wording", () => {
  const gls = buildTrackingDirective([f({ direction: "outbound", verification: "carrier_verified", state: "delivered", carrier: "GLS" })]).toLowerCase();
  const pn = buildTrackingDirective([f({ direction: "outbound", verification: "carrier_verified", state: "in_transit", carrier: "PostNord" })]).toLowerCase();
  // stable existing outbound semantics
  assert(/tracking[^.]*leveret|leveret[^.]*ifølge/.test(gls));
  assert(/på vej/.test(pn));
  // outbound must not carry the return-specific refund/processing wording
  for (const d of [gls, pn]) {
    assert(!d.includes("retur-tracking-nummeret"));
    assert(!d.includes("refunderingen endnu ikke er udstedt"));
  }
});
