import type { EmailCategory } from "../../../_shared/email-category.ts";
import type { WorkflowRoute } from "../types.ts";

export function buildReturnDraft(category: EmailCategory): WorkflowRoute {
  return {
    category,
    workflow: "return",
    promptHint:
      "WORKFLOW: Return. Bekræft returbetingelser fra policy og bed kun om manglende retur-oplysninger.",
    systemHint:
      "Workflow er Return: følg retur-policy strikt og opfind ikke labels/portal-trin.",
    promptBlocks: [
      "RETURN FOCUS:\n- Bekræft returvinduet og hvem der betaler returfragt fra policy.\n- Bed kun om manglende retur-oplysninger.",
    ],
    systemRules: [
      "Undgå ordreændringer som adresse/skift af shipping i return-workflow.",
    ],
    blockedActionTypes: [
      "update_shipping_address",
      "change_shipping_method",
      "hold_or_release_fulfillment",
      "edit_line_items",
    ],
    forceReturnDetailsFlow: true,
  };
}

