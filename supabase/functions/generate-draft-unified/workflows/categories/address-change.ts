import type { EmailCategory } from "../../../_shared/email-category.ts";
import type { WorkflowRoute } from "../types.ts";

export function buildAddressChangeDraft(category: EmailCategory): WorkflowRoute {
  return {
    category,
    workflow: "address_change",
    promptHint:
      "WORKFLOW: Address change. Bekræft ny adresse direkte, gentag kun den nye værdi, og vurder om ordren stadig kan opdateres ud fra status.",
    systemHint:
      "Workflow er Address change: prioriter update_shipping_address når ordren ikke er annulleret/fuldt sendt.",
    promptBlocks: [
      "ADDRESS CHANGE FOCUS:\n- Bekræft kun den nye adresseværdi.\n- Hvis status blokerer ændring, sig det tydeligt og giv næste trin.",
    ],
    systemRules: [
      "Prioriter update_shipping_address eller update_customer_contact; undgå refund/cancel medmindre kunden beder om det.",
    ],
    allowedActionTypes: [
      "update_shipping_address",
      "update_customer_contact",
      "change_shipping_method",
      "hold_or_release_fulfillment",
      "lookup_order_status",
      "fetch_tracking",
      "add_note",
      "add_tag",
      "add_internal_note_or_tag",
    ],
  };
}

