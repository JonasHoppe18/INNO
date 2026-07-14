// Service recovery: when the customer points out that the shop's own
// dispatch promise/expectation has not been met AND the resolved facts
// confirm the order is unshipped, the draft must own the miss — explicit
// acknowledgment, one apology, concrete status, and a committed next step —
// instead of deflecting with template empathy ("Jeg forstår, at det kan være
// frustrerende, men ...") and "hurtigst muligt" process-speak.
//
// Generalises across shops: triggers on the complaint pattern + fact state,
// never on shop-specific wording.
import type { ResolvedFact } from "./fact-resolver.ts";

// The customer cites a shop promise ("på jeres hjemmeside står", "you say",
// "som lovet") in a shipping/dispatch context ...
const PROMISE_CITED_RE =
  /(?:hjemmeside|website|jeres side|på jeres|der står|som lovet|i lover|lovede|you(?:r website)? (?:say|says|state|states|promise|promises|promised)|it says|promised)/i;
const SHIPPING_TERM_RE =
  /(?:send(?:er|es|t)?|afsend|forsend|ship(?:s|ped|ping)?|dispatch)/i;

// ... or complains that shipping/tracking still has not happened.
const NOT_SHIPPED_COMPLAINT_RE =
  /(?:stadig|endnu|still)[^.!?\n]{0,40}(?:ikke|not)[^.!?\n]{0,40}(?:sket noget|sendt|afsendt|shipped|dispatched|opdater|updat)|(?:ikke|not)[^.!?\n]{0,30}(?:blevet |været |been )?(?:sendt|afsendt|shipped|dispatched)|no (?:tracking )?updates?|ingen (?:tracking[- ]?)?opdatering/i;

export function detectsBrokenDispatchComplaint(
  message: string | null | undefined,
): boolean {
  const text = String(message ?? "");
  if (!text.trim()) return false;
  if (PROMISE_CITED_RE.test(text) && SHIPPING_TERM_RE.test(text)) return true;
  return NOT_SHIPPED_COMPLAINT_RE.test(text);
}

// The resolver expresses "unshipped" in two fact shapes:
//   "Ordre fundet" → "... Status: Ikke afsendt endnu ..."
//   "Tracking"     → "Ordren er endnu ikke afsendt"
const UNSHIPPED_FACT_RE =
  /endnu ikke afsendt|ikke afsendt endnu|not shipped yet|unfulfilled/i;

export function factsConfirmUnshipped(facts: ResolvedFact[]): boolean {
  return (facts ?? []).some((fact) => UNSHIPPED_FACT_RE.test(fact.value));
}

export function buildServiceRecoveryDirective(opts: {
  latestCustomerMessage?: string | null;
  facts: ResolvedFact[];
}): string {
  if (!detectsBrokenDispatchComplaint(opts.latestCustomerMessage)) return "";
  if (!factsConfirmUnshipped(opts.facts)) return "";
  return [
    "# Service-recovery: kunden påpeger manglende/forsinket afsendelse — bekræftet af fakta",
    "- Fakta bekræfter at ordren IKKE er afsendt endnu, og kunden påpeger det (evt. med henvisning til butikkens lovede afsendelsestid). Klagen er berettiget — tag ejerskab, gå ikke i forsvar.",
    '- Åbn med at anerkende kundens konkrete observation eksplicit OG beklag én gang, kort og ægte, i samme åbning (fx "Du har helt ret — vi lover afsendelse inden for 24 timer, og din ordre er ikke afsendt endnu. Det beklager jeg."). Beklagelsen må IKKE udelades, og gentag den ikke senere i svaret.',
    '- FORBUDT skabelon-empati med efterfølgende "men": skriv ALDRIG "Jeg forstår, at det kan være frustrerende, men ..." eller tilsvarende — den konstruktion afviser kundens klage i stedet for at anerkende den.',
    "- Forklar kort at tracking først opdaterer, når pakken er scannet hos fragtmanden — kundens tracking er ikke i stykker, og kunden har ikke overset noget.",
    "- Kunden har selv bedt om at få status undersøgt: sig konkret hvad du gør ved det nu (fx følger op på ordren hos lageret) og at kunden hører fra dig, når du ved mere. Dette er svar på kundens egen forespørgsel — ikke et uopfordret opfølgningstilbud.",
    '- "Hurtigst muligt" eller "vi arbejder på det" må ALDRIG stå alene som næste skridt uden en konkret handling.',
    "- Opfind ALDRIG en ny afsendelsesdato eller ETA — lov kun det, fakta dækker.",
  ].join("\n");
}
