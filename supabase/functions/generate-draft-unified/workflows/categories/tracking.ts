import type { EmailCategory } from "../../../_shared/email-category.ts";
import type { WorkflowRoute } from "../types.ts";

export function buildTrackingDraft(category: EmailCategory): WorkflowRoute {
  return {
    category,
    workflow: "tracking",
    promptHint:
      "WORKFLOW: Tracking. Start med leveringsstatus for valgt ordre. Hvis tracking findes i kontekst, brug den konkret; ellers brug Shopify-fallback status og giv næste trin.",
    systemHint:
      "Workflow er Tracking: prioriter lookup_order_status/fetch_tracking og hold actions read-only medmindre kunden eksplicit beder om ændringer.",
    promptBlocks: [
      "TRACKING FOCUS:\n- Start med konkret status for ordren.\n- Hvis trackingdata mangler, brug fallback-status og hold næste trin kort.",
    ],
    systemRules: [
      "Tillad kun read-only tracking/status actions og interne noter/tags.",
      "Forsøg ikke ordre-mutationer i tracking-workflow.",
    ],
    allowedActionTypes: [
      "lookup_order_status",
      "fetch_tracking",
      "add_note",
      "add_tag",
      "add_internal_note_or_tag",
    ],
    forceTrackingIntent: true,
  };
}
