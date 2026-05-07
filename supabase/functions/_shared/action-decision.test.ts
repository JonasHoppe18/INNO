import { assertEquals } from "jsr:@std/assert@1";

import { decideActions } from "./action-decision.ts";

Deno.test("decideActions includes structured shipping address for deterministic address update", async () => {
  const decision = await decideActions({
    customerMessage: "Ny adresse til ordre #1048",
    workflow: "address_change",
    workflowCategory: "Address change",
    automationGuidance: "Manual approval required.",
    orderSummary: "Order #1048 is paid and unfulfilled.",
    factSummary: "Address issue context detected.",
    policyRules: "",
    policySummary: "",
    policyExcerpt: "",
    productSummary: "",
    matchedSubjectNumber: "1048",
    selectedOrderId: 123456,
    selectedOrderShippingAddress: {
      name: "Jonashoppe8 Test",
      address1: "Testvej 1",
      city: "København Ø",
      zip: "2100",
      country: "Denmark",
      phone: "+4512345678",
    },
    addressIssueContext: true,
    addressCandidate: {
      name: "Jonas Hoppe",
      address1: "Gammel Kongevej 74, 3. th.",
      address2: "",
      city: "Frederiksberg C",
      zip: "1850",
      country: "Danmark",
      phone: "",
    },
    troubleshootingExhausted: false,
    technicalIssueStrong: false,
    technicalExchangeCandidate: null,
  });

  assertEquals(decision.actions.length, 1);
  assertEquals(decision.actions[0].type, "update_shipping_address");
  assertEquals(decision.actions[0].payload?.shipping_address, {
    name: "Jonas Hoppe",
    address1: "Gammel Kongevej 74, 3. th.",
    address2: null,
    zip: "1850",
    city: "Frederiksberg C",
    country: "Danmark",
    phone: "+4512345678",
  });
});
