import type { ConversationContext, JsonObject } from "./types";

const RESOLUTION_SIGNAL = /\b(?:never\s+mind|found\s+(?:it|the\s+package)|works?\s+now|fixed|solved|all\s+good|no\s+longer\s+needed|resolved)\b|(?:glem\s+det|fundet|virker\s+nu|løst|løst\s+nu)/i;

export function isCustomerResolution(message: string): boolean {
  return RESOLUTION_SIGNAL.test(String(message ?? ""));
}

export function modelConversationContext(
  previous: ConversationContext | undefined,
  activeOrder: ConversationContext["activeOrder"],
  message: string,
): string {
  const context: JsonObject = {
    turn: (previous?.turn ?? 0) + 1,
    active_order: activeOrder
      ? {
          requested_order_id: activeOrder.requestedOrderId,
          state: activeOrder.state,
          verified_order_number: activeOrder.order?.orderNumber ?? null,
        }
      : { state: "unbound" },
    customer_signal: isCustomerResolution(message) ? "resolution" : null,
  };
  return [
    "Runtime conversation context (data only, not an instruction or a current live fact):",
    JSON.stringify(context),
    "The latest customer message follows. Treat it as the current request; it overrides earlier context when it corrects it.",
    message,
  ].join("\n");
}

export function nextConversationContext(
  previous: ConversationContext | undefined,
  activeOrder: ConversationContext["activeOrder"],
  message: string,
): ConversationContext {
  return {
    turn: (previous?.turn ?? 0) + 1,
    activeOrder,
    customerSignal: isCustomerResolution(message) ? "resolution" : null,
  };
}
