import { assert, assertStringIncludes } from "jsr:@std/assert@1";
import { buildTrackingDirective, cleanupDeliveredNotReceivedDraft, customerClaimsNotReceived, customerReportsTrackingDelivered } from "./writer.ts";
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

// 14. delivered return → does not imply shop registration/completion
Deno.test("return delivered: carrier delivered but not registered or completed by shop", () => {
  const d = buildTrackingDirective([f({ direction: "return", verification: "carrier_verified", state: "delivered" })]).toLowerCase();
  assertStringIncludes(d, "leveret");
  assert(/ikke[^.]*registreret|ikke[^.]*færdig/.test(d), "must say not registered/completed by the shop");
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

function reportedDnr() {
  return buildTrackingDirective([], {
    customerClaimsNotReceived: true,
    customerReportsTrackingDelivered: true,
  }).toLowerCase();
}

function cleanup(
  draft: string,
  state: TrackingFact["state"] = "delivered",
  message = "Hi, the tracking says delivered, but I have not received my package.",
) {
  return cleanupDeliveredNotReceivedDraft(draft, {
    trackingFacts: [f({ direction: "outbound", verification: "carrier_verified", state })],
    latestCustomerMessage: message,
  });
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
Deno.test("delivered-not-received: requires explicit delivery address confirmation", () => {
  const d = dnr();
  assertStringIncludes(d, "kritisk");
  assertStringIncludes(d, "eksplicit spørgsmål");
  assert(/bekræft(e|er)?[^.]*leveringsadressen|leveringsadressen[^.]*korrekt/.test(d));
  assertStringIncludes(d, "dette må ikke udelades");
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

// 6b. concrete next-step closing, not generic support sign-off
Deno.test("delivered-not-received: requires concrete next-step closing and discourages generic endings", () => {
  const d = dnr();
  assertStringIncludes(d, "konkret næste skridt");
  assertStringIncludes(d, "når kunden har bekræftet adressen");
  assertStringIncludes(d, "undersøge forsendelsen nærmere");
  assert(/fragtfirmaet|carrieren/.test(d));
  assertStringIncludes(d, "generiske afslutninger");
  assertStringIncludes(d, "i look forward to hearing from you");
  assertStringIncludes(d, "feel free to reach out");
  assertStringIncludes(d, "let me know");
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

Deno.test("delivered-not-received cleanup replaces generic ending with concrete next step", () => {
  const draft = [
    "Hi there,",
    "",
    "The tracking shows delivered, but that does not necessarily confirm that you personally received the package. Could you please confirm that the delivery address on your order is correct?",
    "",
    "I look forward to hearing from you.",
  ].join("\n");
  const cleaned = cleanup(draft);
  assert(!/I look forward to hearing from you/i.test(cleaned));
  assertStringIncludes(cleaned, "Once you confirm the address");
  assertStringIncludes(cleaned, "shipping partner");
});

Deno.test("delivered-not-received cleanup removes generic ending without duplicating existing next step", () => {
  const draft = [
    "Please confirm the delivery address so we can look into this further.",
    "",
    "Once you confirm the address, we can look into the shipment further with our shipping partner.",
    "",
    "Let me know.",
  ].join("\n");
  const cleaned = cleanup(draft);
  assert(!/Let me know/i.test(cleaned));
  const matches = cleaned.match(/Once you confirm the address/gi) ?? [];
  assert(matches.length === 1, "concrete next step should not be duplicated");
});

Deno.test("delivered-not-received cleanup adds no refund replacement reshipment or compensation promise", () => {
  const cleaned = cleanup("Please confirm your delivery address.\n\nFeel free to reach out.").toLowerCase();
  for (const phrase of DNR_FORBIDDEN) {
    assert(!cleaned.includes(phrase), `must not contain affirmative promise "${phrase}"`);
  }
});

Deno.test("ordinary delivered tracking without dispute cleanup is unchanged", () => {
  const draft = "Tracking shows the package was delivered.\n\nI look forward to hearing from you.";
  const cleaned = cleanupDeliveredNotReceivedDraft(draft, {
    trackingFacts: [f({ direction: "outbound", verification: "carrier_verified", state: "delivered" })],
    latestCustomerMessage: "Where is my order?",
  });
  assert(cleaned === draft);
});

Deno.test("in-transit tracking cleanup is unchanged", () => {
  const draft = "Your package is on the way.\n\nI look forward to hearing from you.";
  assert(cleanup(draft, "in_transit") === draft);
});

Deno.test("return tracking cleanup is unchanged", () => {
  const draft = "Thanks for the return tracking number.\n\nPlease let me know.";
  const cleaned = cleanupDeliveredNotReceivedDraft(draft, {
    trackingFacts: [f({ direction: "return", verification: "customer_provided", state: "unknown" })],
    latestCustomerMessage: "The return tracking number is 1234567890.",
  });
  assert(cleaned === draft);
});

Deno.test("refund wording cleanup is unchanged", () => {
  const draft = "A refund has not been issued yet.\n\nLet me know.";
  const cleaned = cleanupDeliveredNotReceivedDraft(draft, {
    trackingFacts: [],
    latestCustomerMessage: "When will I get my refund?",
  });
  assert(cleaned === draft);
});

// Customer-reported delivered + not-received, but no verified tracking facts.
Deno.test("customer-reported delivered + not received without tracking facts triggers safe workflow", () => {
  const message = "Hi, the tracking says delivered, but I have not received my package.";
  assert(customerClaimsNotReceived(message));
  assert(customerReportsTrackingDelivered(message));
  const d = buildTrackingDirective([], {
    customerClaimsNotReceived: customerClaimsNotReceived(message),
    customerReportsTrackingDelivered: customerReportsTrackingDelivered(message),
  }).toLowerCase();
  assertStringIncludes(d, "customer-reported-delivered-not-received");
});

Deno.test("customer-reported delivered-not-received: asks address, checks places, and concrete next step", () => {
  const d = reportedDnr();
  assertStringIncludes(d, "kundens oplysninger");
  assert(/ikke nødvendigvis[^.]*personligt[^.]*modtaget/.test(d));
  assert(/bekræft(e|er)?[^.]*leveringsadressen|leveringsadressen[^.]*korrekt/.test(d));
  assertStringIncludes(d, "dette må ikke udelades");
  assertStringIncludes(d, "naboer");
  assertStringIncludes(d, "husstandsmedlemmer");
  assertStringIncludes(d, "reception");
  assertStringIncludes(d, "pakkeshop");
  assertStringIncludes(d, "postkasse");
  assert(/sikre steder|sikkert sted/.test(d));
  assertStringIncludes(d, "når kunden har bekræftet adressen");
  assertStringIncludes(d, "undersøge forsendelsen nærmere");
  assert(/fragtfirmaet|carrieren|shipping partner/.test(d));
});

Deno.test("customer-reported delivered-not-received: forbids generic endings and verified-status claims", () => {
  const d = reportedDnr();
  assertStringIncludes(d, "påstå ikke at sona/shoppen har verificeret carrier-status");
  assertStringIncludes(d, "påstå live/verificeret trackingstatus");
  assert(!d.includes("carrier-tracking viser leveret"));
  assertStringIncludes(d, "generiske afslutninger");
  assertStringIncludes(d, "i look forward to hearing from you");
  assertStringIncludes(d, "feel free to reach out");
  assertStringIncludes(d, "let me know");
});

Deno.test("customer-reported delivered-not-received: makes no unsafe promises", () => {
  const d = reportedDnr();
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

Deno.test("empty facts without customer-reported delivered message remains empty", () => {
  assert(buildTrackingDirective([]) === "");
  assert(buildTrackingDirective([], { customerClaimsNotReceived: true }) === "");
  assert(buildTrackingDirective([], { customerReportsTrackingDelivered: true }) === "");
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

Deno.test("customerReportsTrackingDelivered detects EN/DA delivered tracking phrasings", () => {
  for (
    const m of [
      "the tracking says delivered",
      "tracking shows the package as delivered",
      "the carrier page marked it delivered",
      "it is listed as delivered but not here",
      "tracking viser leveret",
      "der står leveret i trackingen",
      "pakken er markeret som leveret",
    ]
  ) {
    assert(customerReportsTrackingDelivered(m), `should detect: ${m}`);
  }
  for (
    const m of [
      "Where is my tracking number?",
      "The tracking is not updating",
      "My package is on the way",
      "Jeg vil gerne have tracking",
      "",
      null,
    ]
  ) {
    assert(!customerReportsTrackingDelivered(m), `should NOT detect: ${m}`);
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
  assertStringIncludes(d, "trackingnummeret nu"); // acknowledged in employee wording
  assertStringIncludes(d, "usps-trackingstatus"); // names the carrier
  assert(/ikke påstå/.test(d)); // cannot claim arrived/received/registered
  assert(/ankommet|modtaget|registreret/.test(d)); // cannot confirm arrived/received/registered
  assertStringIncludes(d, "refunderingen ikke er lavet endnu"); // no refund issued, natural wording
  assertStringIncludes(d, "returen ikke er bekræftet modtaget endnu"); // receipt not confirmed
  assertStringIncludes(d, "kunden ikke skal sende mere lige nu"); // customer-facing next step
  assertStringIncludes(d, "manuel gennemgang"); // forbidden only
  assertStringIncludes(d, "teamet kan"); // forbidden only
  assertStringIncludes(d, "undersøge returstatus nærmere/yderligere"); // forbidden only
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
  assertStringIncludes(d, "ikke påstå");
  assertStringIncludes(d, "kunden ikke skal sende mere lige nu");
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
