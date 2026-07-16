// Flags eval cases whose ground-truth human reply depends on LIVE order / shipping
// / refund data that the AI cannot resolve during eval because the identifier was
// redacted (e.g. "[order number]").
//
// Why this matters: Sona answers live-commerce questions using CURRENT order/
// shipping/refund data. The historical human reply reflects the state at that
// exact past moment. Even when Sona is correct today, it may not match the old
// human reply — so judging these by similarity to the human reply is invalid.
// When the eval input has only a redacted identifier, Sona also cannot perform
// the lookup at all. Such cases must be reported separately, not in the headline.
//
// These cases should instead be assessed (separately, qualitatively) on:
//   - whether Sona used the available live facts correctly,
//   - whether its claims are grounded,
//   - whether it avoided unsupported status/stock/refund claims,
//   - whether it asked for the right missing identifier when live facts were
//     unavailable,
//   - whether it gave a useful next step.
//
// Conservative by design: comparable is the default. A case is only flagged when
// it is clearly a live-commerce topic, the human reply demonstrably used live
// data, AND no resolvable identifier is present in the eval payload. The latter
// includes both redacted and entirely omitted ids: eval requests use a synthetic
// sender address, so production's email lookup is unavailable too.

const LIVE_INTENTS = new Set([
  "tracking",
  "shipping",
  "order_status",
  "invoice",
  "refund",
  "cancel",
  "return|refund",
]);
const LIVE_BODY_CUE =
  /\b(shipping status|tracking|where is my order|when will|delivery|deliver|levering|forsendelse|fragt|sendt|afsendt|refund|refunder|tilbagebetal|cancel|annull|invoice|faktura|order ?status|ordrestatus)\b/i;
// Agent reply shows it consulted live order/shipment/refund data.
const HUMAN_LIVE_LOOKUP =
  /\b(i (just )?checked|i can see|i see (your|the) order|your (order|shipment|parcel|package) (has|is|was|will|been)|forwarded to (our|the) warehouse|tracking (shows|number)|has (shipped|been dispatched|been refunded)|will ship|dispatched|refunded|jeg har (lige )?(været inde og )?tjekke|din (ordre|forsendelse|pakke)|sendt afsted|afsendt|oprettet (i dag|i systemet)|lager(et)?|refunder|tilbagebetal|annulleret)\b/i;
const REDACTED_LIVE_ID = /\[(order number|tracking number)\]/i;

// A historical reply can also depend on a temporary operational fact that no
// current model run can reproduce, such as the repair technician being away.
// Require both a repair/service topic and an explicit staff-availability cue;
// ordinary repair guidance and stable turnaround estimates remain comparable.
const TEMPORAL_SERVICE_INTENTS = new Set(["repair", "warranty"]);
const TEMPORAL_SERVICE_BODY_CUE =
  /\b(repairs?|repaired|repairing|technician|service estimate|reparation|reparer(?:e|et|es)?|tekniker|reparatør|værksted)\b/i;
const SERVICE_STAFF =
  "(?:repair technician|service technician|technician|repair team|(?:person|guy|colleague) (?:who )?handl(?:es|ing) repairs?|tekniker(?:en)?|reparatør(?:en)?|værksted(?:et)?)";
const HUMAN_TEMPORAL_STAFF_AVAILABILITY = [
  new RegExp(
    `\\b${SERVICE_STAFF}\\b[\\s\\S]{0,120}\\b(on (?:holiday|vacation|leave)|away|out of (?:the )?office|back (?:on|after|from)|return(?:s|ing)? (?:on|after|from)|på ferie|ferie til|tilbage (?:den|d\\.?))\\b`,
    "i",
  ),
  new RegExp(
    `\\b(until|when|once|når)\\s+(?:our|the|vores)?\\s*${SERVICE_STAFF}\\s+(?:(?:is|er)\\s+)?(?:back|returns?|tilbage)\\b`,
    "i",
  ),
];

// A real, resolvable identifier in the body keeps the case comparable: if Sona
// CAN look it up and still fails, that is a genuine failure, not an eval artifact.
function isResolvable(body) {
  const b = String(body || "").replace(
    /\[(order number|tracking number|email)\]/gi,
    "",
  );
  return (
    /#\s?\d{3,8}\b/.test(b) ||
    /\border\s*(number|#|no\.?)\s*[:#]?\s*\d{3,8}/i.test(b) ||
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(b) ||
    /\b\d{8,}\b/.test(b)
  );
}

/**
 * @param {{ body?: string, humanReply?: string, intent?: string }} input
 * @returns {{ live_fact_dependent: boolean, reason: string|null }}
 */
export function classifyLiveFactDependency({
  body = "",
  humanReply = "",
  intent = "",
} = {}) {
  const temporalServiceTopic =
    TEMPORAL_SERVICE_INTENTS.has(String(intent || "").toLowerCase()) ||
    TEMPORAL_SERVICE_BODY_CUE.test(`${body}\n${humanReply}`);
  const historicalStaffAvailability = HUMAN_TEMPORAL_STAFF_AVAILABILITY.some(
    (pattern) => pattern.test(humanReply),
  );
  if (temporalServiceTopic && historicalStaffAvailability) {
    return {
      live_fact_dependent: true,
      reason: "service_topic + historical_staff_availability",
    };
  }

  const liveTopic =
    LIVE_INTENTS.has(String(intent || "").toLowerCase()) ||
    LIVE_BODY_CUE.test(body);
  const humanUsedLiveData = HUMAN_LIVE_LOOKUP.test(humanReply);
  const redactedId = REDACTED_LIVE_ID.test(body);
  if (liveTopic && humanUsedLiveData && !isResolvable(body)) {
    return {
      live_fact_dependent: true,
      reason: redactedId
        ? "live_topic + human_used_live_data + redacted_identifier + unresolvable"
        : "live_topic + human_used_live_data + missing_identifier + unresolvable",
    };
  }
  return { live_fact_dependent: false, reason: null };
}
