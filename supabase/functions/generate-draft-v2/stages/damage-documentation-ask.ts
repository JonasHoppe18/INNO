// Deterministic backstop: physical-damage warranty flows must ask for
// photo/video documentation before (or while) arranging a replacement/repair,
// unless the customer already attached images. The writer directive
// prioritises documentation, but the model skips it in a share of runs
// (observed live on T-051002). Pure module: no I/O, no LLM.

// Same physical-damage vocabulary as the action-decision troubleshooting
// exception (action-decision.ts) — physical damage is the class where
// troubleshooting is pointless and documentation is what a human asks for.
const PHYSICAL_DAMAGE_RE =
  /\b(broken|broke|crack(?:ed)?|fallen\s+off|fell\s+off|snapped|bent|ødelagt|knækket|revne(?:t)?|knæk|bøjet|faldet\s+af|beskadiget|i\s+stykker)\b/i;

// The draft commits to a replacement/repair/swap path.
const REPLACEMENT_OFFER_RE =
  /\b(replacement|replace|repair(?:ed)?|swap|erstatning|ombytning|ombytte|reparation|reparere|ny\s+enhed)\b/i;

// The draft already asks for (or references sending) visual documentation.
const DOCUMENTATION_RE =
  /\b(photo|photos|picture|pictures|image|images|video|foto|fotos|billede|billeder|optagelse)\b/i;

export function isPhysicalDamageMessage(
  text: string | null | undefined,
): boolean {
  return PHYSICAL_DAMAGE_RE.test(String(text || ""));
}

export function detectMissingDamageDocumentationAsk(input: {
  draftText: string | null | undefined;
  customerMessage: string | null | undefined;
  imageAttachmentCount: number;
}): string[] {
  const draft = String(input.draftText || "");
  if (!draft.trim()) return [];
  if (input.imageAttachmentCount > 0) return [];
  if (!isPhysicalDamageMessage(input.customerMessage)) return [];
  if (!REPLACEMENT_OFFER_RE.test(draft)) return [];
  if (DOCUMENTATION_RE.test(draft)) return [];
  return [
    "replacement/repair offered for physical damage without asking for photo/video documentation",
  ];
}
