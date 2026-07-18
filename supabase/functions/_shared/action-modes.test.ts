import { assertEquals } from "jsr:@std/assert@1";
import {
  canAutoExecuteAction,
  normalizeActionModes,
  normalizeCoreActionType,
  resolveActionMode,
} from "./action-modes.ts";

Deno.test("action modes use safe defaults for newly exposed actions", () => {
  assertEquals(resolveActionMode("update_shipping_address"), "approve");
  assertEquals(resolveActionMode("cancel_order"), "approve");
  assertEquals(resolveActionMode("refund_order"), "off");
  assertEquals(resolveActionMode("initiate_return"), "off");
  assertEquals(resolveActionMode("create_exchange_request"), "off");
});

Deno.test("explicit core action modes override legacy flags", () => {
  assertEquals(
    resolveActionMode(
      "cancel_order",
      { action_modes: { cancel_order: "off" } },
      { cancel_orders: true },
    ),
    "off",
  );
  assertEquals(
    resolveActionMode(
      "update_shipping_address",
      { action_modes: { update_shipping_address: "approve" } },
      { order_updates: true },
    ),
    "approve",
  );
  assertEquals(
    resolveActionMode("cancel_order", {}, { cancel_orders: true }),
    "approve",
  );
});

Deno.test("unsupported auto modes fail safe to approve", () => {
  assertEquals(
    normalizeActionModes({
      refund_order: "auto",
      initiate_return: "auto",
      create_exchange_request: "auto",
    }),
    {
      update_shipping_address: "approve",
      cancel_order: "approve",
      refund_order: "approve",
      initiate_return: "approve",
      create_exchange_request: "approve",
    },
  );
  assertEquals(canAutoExecuteAction("refund_order"), false);
  assertEquals(canAutoExecuteAction("cancel_order"), true);
});

Deno.test("return approval action aliases share the return policy", () => {
  assertEquals(
    normalizeCoreActionType("send_return_instructions"),
    "initiate_return",
  );
  assertEquals(
    resolveActionMode("send_return_instructions", {
      action_modes: { initiate_return: "approve" },
    }),
    "approve",
  );
});

Deno.test("disabled_actions remains an emergency off override", () => {
  assertEquals(
    resolveActionMode("cancel_order", {
      action_modes: { cancel_order: "auto" },
      disabled_actions: ["cancel_order"],
    }),
    "off",
  );
});
