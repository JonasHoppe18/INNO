import type { EmailCategory } from "../../../_shared/email-category.ts";
import type { WorkflowRoute } from "../types.ts";

export function buildReturnDraft(category: EmailCategory): WorkflowRoute {
  return {
    category,
    workflow: "return",
    promptHint:
      "WORKFLOW: Return / cancellation request. The customer wants to return a product. " +
      "Follow the STRUCTURED RETURN SETTINGS exactly — all shipping, label, and address details come from there. " +
      "Do NOT invent return portals, labels, or processes not described in the settings.",
    systemHint:
      "Workflow er Return: følg STRUCTURED RETURN SETTINGS strikt. Opfind aldrig labels, portaler eller processer.",
    promptBlocks: [
      "RETURN WORKFLOW RULES:\n" +
      "- All return process details (who pays shipping, label method, return address, return window) come exclusively from STRUCTURED RETURN SETTINGS. Never invent or assume these details.\n" +
      "- If the customer makes a claim about your return policy (e.g. 'your terms say you cover return shipping') that contradicts STRUCTURED RETURN SETTINGS, politely and clearly correct the misunderstanding with what the settings actually say.\n" +
      "- NEVER use a delivery tracking URL from order data as a return shipping label. Tracking URLs show delivery status — they are not return labels.\n" +
      "- Ask only for information not already provided by the customer.",
    ],
    systemRules: [
      "Follow STRUCTURED RETURN SETTINGS exactly. If return_shipping_mode is customer_paid: never promise a prepaid return label or say we cover return shipping costs.",
      "NEVER present an order delivery tracking URL as a return label URL. These are entirely different things.",
      "Do not suggest order changes (address update, shipping method) in return workflow.",
      "NEVER propose a refund_order action during a return request. Refunds are processed AFTER the item is physically received back — not at the time the return is initiated.",
    ],
    blockedActionTypes: [
      "update_shipping_address",
      "change_shipping_method",
      "hold_or_release_fulfillment",
      "edit_line_items",
      "refund_order",
    ],
    forceReturnDetailsFlow: true,
  };
}
