// @ts-nocheck
import { assertEquals } from "jsr:@std/assert@1";
import { assessConversationClosing } from "./conversation-closing.ts";

const base = { intent: "thanks", latestCustomerText: "Yes thanks", priorAgentResolution: true, openAsksCount: 0 };

Deno.test("pure thanks on a handled thread suggests close", () => {
  const r = assessConversationClosing(base);
  assertEquals(r.suggestClose, true);
});

Deno.test("thanks with a new problem does NOT close", () => {
  assertEquals(assessConversationClosing({ ...base, latestCustomerText: "Thanks, but the address is still wrong" }).suggestClose, false);
});

Deno.test("thanks with a question does NOT close", () => {
  assertEquals(assessConversationClosing({ ...base, latestCustomerText: "Thanks! When will it ship?" }).suggestClose, false);
});

Deno.test("no prior agent resolution does NOT close", () => {
  assertEquals(assessConversationClosing({ ...base, priorAgentResolution: false }).suggestClose, false);
});

Deno.test("open asks present does NOT close", () => {
  assertEquals(assessConversationClosing({ ...base, openAsksCount: 1 }).suggestClose, false);
});

Deno.test("negative 'thanks for nothing' does NOT close", () => {
  assertEquals(assessConversationClosing({ ...base, latestCustomerText: "thanks for nothing, this is terrible" }).suggestClose, false);
});

Deno.test("non-thanks intent does NOT close", () => {
  assertEquals(assessConversationClosing({ ...base, intent: "refund" }).suggestClose, false);
});

Deno.test("Danish pure tak suggests close", () => {
  assertEquals(assessConversationClosing({ ...base, latestCustomerText: "Perfekt, mange tak!" }).suggestClose, true);
});
