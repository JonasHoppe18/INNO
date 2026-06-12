// Product Support PREVIEW — completed-troubleshooting detector + writer block.
//
// Problem this solves (observed in manual A-Blaze UI verification): the section
// selector scores completed-step vocabulary ("reinstalled the USB driver",
// "updated the dongle firmware") as POSITIVE relevance, so it keeps proposing a
// guide whose steps the customer has already exhausted. There is no per-turn
// state telling the writer "this was already tried".
//
// This is a deterministic, structured scan of the VISIBLE customer turns. It
// extracts the concrete steps the customer says they already completed and
// renders a short preview-only writer block that:
//   - lists the completed steps so the writer acknowledges them,
//   - forbids repeating them or proposing equivalent variants,
//   - routes an exhausted troubleshooting path to "ask for order number first",
//   - forbids unrelated extra steps and unverified promises.
//
// Preview/test only. No DB writes, no LLM, no shop/product hardcoding — the
// patterns are generic support-troubleshooting vocabulary (EN + DA).

type CompletedStepRule = {
  // Canonical, product-agnostic label injected into the writer block.
  label: string;
  // Any pattern matching the visible customer text marks the step completed.
  patterns: RegExp[];
};

// Ordered so the rendered list reads in a natural troubleshooting order. Each
// rule pairs an ACTION/STATE word with the component, so a mere mention of the
// component ("I use the dongle") does not count as a completed step.
const COMPLETED_STEP_RULES: CompletedStepRule[] = [
  {
    label: "updated the headset firmware",
    patterns: [
      /\bheadset\b[^.]{0,40}\bfirmware\b/i,
      /\bfirmware\b[^.]{0,40}\bheadset\b/i,
    ],
  },
  {
    label: "updated the dongle firmware",
    patterns: [
      /\bdongle\b[^.]{0,40}\bfirmware\b/i,
      /\bfirmware\b[^.]{0,40}\bdongle\b/i,
    ],
  },
  {
    label: "reinstalled the USB driver",
    patterns: [
      /\breinstall\w*\b[^.]{0,40}\b(usb\s+)?driver\b/i,
      /\b(usb\s+)?driver\b[^.]{0,40}\breinstall\w*\b/i,
      /\bgeninstaller\w*\b[^.]{0,40}\bdriver\b/i,
    ],
  },
  {
    label: "completed a factory reset",
    patterns: [/\bfactory reset\b/i, /\bfabriksnulstil\w*/i],
  },
  {
    label: "disabled Bluetooth",
    patterns: [
      /\bbluetooth\b[^.]{0,30}\b(disabled|off|turned off|deaktiveret|slået fra)\b/i,
      /\b(disabled|turned off|no)\b[^.]{0,10}\bbluetooth\b/i,
    ],
  },
  {
    label: "tested on another device/computer",
    patterns: [
      /\b(another|different|other|second)\b[^.]{0,15}\b(computer|pc|device|laptop|mac|enhed)\b/i,
      /\b(anden|en anden)\b[^.]{0,15}\b(computer|pc|enhed)\b/i,
    ],
  },
  {
    label: "disabled the standby timer",
    patterns: [
      /\bstandby\s*timer\b[^.]{0,30}\b(disabled|off|already|deaktiveret|slået fra)\b/i,
      /\b(disabled|turned off|deaktiveret)\b[^.]{0,15}\bstandby\b/i,
    ],
  },
  {
    label: "confirmed the issue is isolated to the dongle",
    patterns: [
      /\bonly\b[^.]{0,30}\bdongle\b/i,
      /\bisolated to\b[^.]{0,15}\bdongle\b/i,
      /\bkun\b[^.]{0,30}\bdongle\b/i,
    ],
  },
  {
    label: "confirmed the issue does not occur over the cable",
    patterns: [
      /\b(not|n't|never|does not|doesn't)\b[^.]{0,30}\b(usb-?c\s+)?cable\b/i,
      /\b(usb-?c\s+)?cable\b[^.]{0,25}\b(works|fine|no issue|ingen problemer|virker)\b/i,
      /\bikke\b[^.]{0,30}\bkabel\b/i,
    ],
  },
];

// Scan the visible customer text and return the ordered, de-duplicated list of
// completed-step labels. Deterministic; product/shop-agnostic; empty input → [].
export function detectCompletedTroubleshooting(text: string): string[] {
  const haystack = String(text || "");
  if (!haystack.trim()) return [];
  const steps: string[] = [];
  for (const rule of COMPLETED_STEP_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(haystack))) {
      steps.push(rule.label);
    }
  }
  return steps;
}

// Build the preview-only writer block from detected steps. Returns null when no
// step was completed so callers can skip injection. Language-agnostic
// instruction (reply language is handled by the existing resolver); no canned
// per-language reply text and no shop/product names.
export function buildCompletedTroubleshootingBlock(
  steps: string[],
): string | null {
  const completed = Array.isArray(steps) ? steps.filter(Boolean) : [];
  if (completed.length === 0) return null;
  return [
    "# PRODUCT SUPPORT PREVIEW — COMPLETED TROUBLESHOOTING (explicit test/simulation run only)",
    `The customer has already completed: ${completed.join("; ")}.`,
    "Do not repeat these steps, and do not suggest equivalent variants (e.g. reinstalling or updating the same component through a slightly different flow) unless the selected guide explicitly requires a genuinely different action.",
    "If the relevant troubleshooting path is exhausted, stop troubleshooting. First ask for the customer's order number so the case can be reviewed further. Only if the customer cannot provide an order number, ask for proof of purchase and where the product was purchased.",
    "Do not propose additional unrelated troubleshooting steps.",
    "Do not promise or commit to warranty repair, replacement, refund, or approval — say only that the case can be reviewed further to assess the appropriate next step.",
  ].join("\n");
}
