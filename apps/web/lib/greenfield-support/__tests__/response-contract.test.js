import { describe, expect, it } from "vitest";
import { createCapabilityRegistry } from "../capabilities";
import { createDemoDependencies } from "../demo-fixtures";
import { ensureAnswerCompleteness, inferResponseLocale, inspectTimingCandidateDiagnostics, shouldPreferAuthoritativeEvidenceFallback, StructuredResponseSchema, renderResponseSegments, validateStructuredResponse } from "../response-contract";

function validate(registry, ...segments) {
  return validateStructuredResponse({ segments }, registry);
}

function deliveredTrackingProvider(options = {}) {
  const { location = "Copenhagen", estimatedDelivery = null } = options;
  return {
    providerName: "test_ship24",
    lookup: async (input) => ({
      status: "ok",
      data: {
        trackingNumber: input.trackingNumber,
        carrier: "Bring",
        status: "delivered",
        subStatus: "delivered",
        latestEvent: {
          description: "The parcel has been delivered.",
          timestamp: "2026-09-03T12:00:00.000Z",
          location,
          status: "delivered",
          subStatus: "delivered",
        },
        estimatedDelivery,
        checkpoints: [],
        exception: null,
        observedAt: "2026-09-03T12:00:00.000Z",
        provider: "test_ship24",
        source: "test",
      },
    }),
  };
}

describe("structured response contract", () => {
  it("accepts a pure acknowledgement without tool evidence", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const result = validate(registry, { type: "acknowledgement", kind: "resolution" });

    expect(result.allValid).toBe(true);
    expect(renderResponseSegments(result.approvedSegments, registry)).toBe("Glad to hear that’s sorted.");
  });

  it("does not re-ask an explicit unresolved order number", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({ ...dependencies, orderReferences: ["9999"] });
    const lookup = await registry.execute("get_order", JSON.stringify({ order_id: "9999" }));
    expect(lookup.status).toBe("not_found");

    const responseContext = { ...registry, activeOrder: registry.getActiveOrderFocus() };
    const result = validateStructuredResponse({
      segments: [{ type: "question", purpose: "enable_capability", text: null, capability: "get_order", missing_arguments: ["order_id"] }],
    }, responseContext);

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, responseContext);
    expect(rendered).toContain("couldn’t verify order #9999");
    expect(rendered).toContain("different valid order number or order identifier");
    expect(rendered).not.toContain("couldn’t find an order with number #9999");
    expect(rendered).not.toContain("send the order number from your order confirmation");
  });

  it("allows product clarification before any lookup when the product is missing", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const result = validateStructuredResponse({
      segments: [{
        type: "question",
        purpose: "clarify_task",
        text: "Which product or model are you having trouble with, and what is happening?",
        capability: null,
        missing_arguments: [],
      }],
    }, {
      ...registry,
      customerMessage: "My headset is broken. What can you help with?",
      customerProvidedContext: { issue: "My headset is broken" },
    });

    expect(result.allValid).toBe(true);
    expect(renderResponseSegments(result.approvedSegments, {
      ...registry,
      customerMessage: "My headset is broken. What can you help with?",
      customerProvidedContext: { issue: "My headset is broken" },
    })).toContain("Which product or model");
  });

  it("allows task clarification when the product is known but the issue is broad", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const result = validateStructuredResponse({
      segments: [{
        type: "question",
        purpose: "clarify_task",
        text: "What problem are you experiencing with it?",
        capability: null,
        missing_arguments: [],
      }],
    }, {
      ...registry,
      customerMessage: "My A-Spire Wireless is broken.",
      customerProvidedContext: { product: "A-Spire Wireless", issue: "My A-Spire Wireless is broken" },
    });

    expect(result.allValid).toBe(true);
  });

  it("allows a clarification for missing context without fabricating a tool result", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const result = validateStructuredResponse({
      segments: [{
        type: "question",
        purpose: "clarify_task",
        text: "Which product are you using, and what would you like help with?",
        capability: null,
        missing_arguments: [],
      }],
    }, { ...registry, customerMessage: "I need help with my headset." });

    expect(result.allValid).toBe(true);
  });

  it("uses a trusted first-name greeting only on the first substantive response", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const knowledge = await registry.execute("search_policy", JSON.stringify({ query: "return window" }));
    const result = validate(registry, {
      type: "knowledge_guidance",
      text: "ignored",
      basis: { result_id: knowledge.resultId, field_paths: ["results"] },
    });

    expect(renderResponseSegments(result.approvedSegments, {
      ...registry,
      customerName: "Jonas Hoppe",
      trustedCustomerIdentity: { verified: true, hasName: true, hasEmail: true },
      firstResponse: true,
    })).toMatch(/^Hi Jonas,\n\n/);
    expect(renderResponseSegments(result.approvedSegments, {
      ...registry,
      customerName: "Jonas Hoppe",
      trustedCustomerIdentity: { verified: true, hasName: true, hasEmail: true },
      firstResponse: false,
    })).not.toContain("Hi Jonas,");
  });

  it("does not personalize from an unverified customer name", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const knowledge = await registry.execute("search_policy", JSON.stringify({ query: "return window" }));
    const result = validate(registry, {
      type: "knowledge_guidance",
      text: "Returns are accepted within 30 days of delivery.",
      basis: { result_id: knowledge.resultId, field_paths: ["results"] },
    });

    const rendered = renderResponseSegments(result.approvedSegments, {
      ...registry,
      customerName: "Jonas Hoppe",
      trustedCustomerIdentity: { verified: false, hasName: false, hasEmail: true },
      firstResponse: true,
    });

    expect(rendered).not.toMatch(/^Hi Jonas,/);
    expect(rendered).not.toContain("Jonas");
  });

  it("uses a sender display name for greeting without making it a trusted identity", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const knowledge = await registry.execute("search_policy", JSON.stringify({ query: "return window" }));
    const result = validate(registry, {
      type: "knowledge_guidance",
      text: "Returns are accepted within 30 days of delivery.",
      basis: { result_id: knowledge.resultId, field_paths: ["results"] },
    });

    const rendered = renderResponseSegments(result.approvedSegments, {
      ...registry,
      customerDisplayName: "Jonas Hoppe",
      trustedCustomerIdentity: { verified: false, hasName: false, hasEmail: true },
      firstResponse: true,
    });

    expect(rendered).toMatch(/^Hi Jonas,\n\n/);
    expect(result.allValid).toBe(true);
  });

  it("keeps a dense knowledge answer readable without changing its content", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const knowledge = await registry.execute("search_policy", JSON.stringify({ query: "return window" }));
    const text = "You can request a return within 30 days. The item must be unused and in its original packaging. If the seal is broken, a deduction may apply. Return shipping is your responsibility. The refund starts after the return is processed.";
    const result = validate(registry, {
      type: "knowledge_guidance",
      text,
      basis: { result_id: knowledge.resultId, field_paths: ["results"] },
    });

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, registry);
    expect(rendered).toContain("You can request a return within 30 days. The item must be unused and in its original packaging.");
    expect(rendered).toContain("If the seal is broken, a deduction may apply. Return shipping is your responsibility.");
    expect(rendered).toContain("The refund starts after the return is processed.");
    expect(rendered.split("\n\n")).toHaveLength(3);
  });

  it("puts the return process first and omits secondary policy details when they were not asked for", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const policy = await registry.execute("search_policy", JSON.stringify({ query: "return policy" }));
    const context = { ...registry, customerMessage: "I found the package, but I want to return it. How do I do that?" };
    const result = validateStructuredResponse({ segments: [{
      type: "knowledge_guidance",
      text: "Returns are accepted within 30 days. Start the return through the returns portal. Opened products may incur a EUR 50 deduction. Return shipping is your responsibility. Refunds are processed after receipt.",
      basis: { result_id: policy.resultId, field_paths: ["results"] },
    }] }, context);

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, context);
    expect(rendered.indexOf("Start the return through the returns portal.")).toBeLessThan(rendered.indexOf("Returns are accepted within 30 days."));
    expect(rendered).not.toContain("EUR 50");
    expect(rendered).not.toContain("Return shipping is your responsibility");
    expect(rendered).not.toContain("Refunds are processed");
  });

  it("keeps an opened-package consequence when the customer asks about the condition", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const policy = await registry.execute("search_policy", JSON.stringify({ query: "return policy" }));
    const context = { ...registry, customerMessage: "I opened the package, can I still return it?" };
    const result = validateStructuredResponse({ segments: [{
      type: "knowledge_guidance",
      text: "Returns are accepted within 30 days. Opened products may incur a EUR 50 deduction. Return shipping is your responsibility. Refunds are processed after receipt.",
      basis: { result_id: policy.resultId, field_paths: ["results"] },
    }] }, context);

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, context);
    expect(rendered).toContain("EUR 50 deduction");
    expect(rendered).not.toContain("Return shipping is your responsibility");
    expect(rendered).not.toContain("Refunds are processed");
  });

  it("prioritizes the return destination and keeps its line-oriented address", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const policy = await registry.execute("search_policy", JSON.stringify({ query: "return policy" }));
    const context = { ...registry, customerMessage: "Where do I send my return?" };
    const result = validateStructuredResponse({ segments: [{
      type: "knowledge_guidance",
      text: "Returns are accepted within 30 days. Send the return to:\n\nAceZone International ApS\nReturn Street 10\n2000 Frederiksberg\nUse tracked shipping. Opened products may incur a EUR 50 deduction. Refunds are processed after receipt.",
      basis: { result_id: policy.resultId, field_paths: ["results"] },
    }] }, context);

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, context);
    expect(rendered).toContain("Send the return to:\nAceZone International ApS\nReturn Street 10\n2000 Frederiksberg");
    expect(rendered).not.toContain("Returns are accepted within 30 days");
    expect(rendered).not.toContain("Use tracked shipping");
    expect(rendered).not.toContain("EUR 50");
    expect(rendered).not.toContain("Refunds are processed");
  });

  it("keeps each merchant's grounded return destination flow distinct", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const policy = await registry.execute("search_policy", JSON.stringify({ query: "return destination" }));
    const renderPolicy = (customerMessage, text) => {
      const context = { ...registry, customerMessage };
      const result = validateStructuredResponse({ segments: [{
        type: "knowledge_guidance",
        text,
        basis: { result_id: policy.resultId, field_paths: ["results"] },
      }] }, context);
      expect(result.allValid).toBe(true);
      return renderResponseSegments(result.approvedSegments, context);
    };

    const physical = renderPolicy(
      "Where do I send my return?",
      "Returns are accepted within 30 days. Send the return to:\nMerchant Returns\nReturn Street 10\n2000 Frederiksberg\nYou pay return shipping. Tracking is recommended. COD is not accepted. Refunds are processed after receipt.",
    );
    expect(physical).toContain("Merchant Returns\nReturn Street 10\n2000 Frederiksberg");
    expect(physical).toContain("You pay return shipping.");
    expect(physical).not.toContain("Tracking is recommended");
    expect(physical).not.toContain("COD is not accepted");
    expect(physical).not.toContain("Refunds are processed");

    const danishPhysical = renderPolicy(
      "Hvor skal jeg sende min retur?",
      "Når din retur er blevet accepteret, skal den sendes til:\nMerchant Returns\nReturgade 10\n2000 Frederiksberg\nKontakt os først via kontaktformularen med årsagen til returen. Du skal selv betale returportoen. Vi anbefaler tracking. Refunderingen igangsættes efter modtagelsen.",
    );
    expect(danishPhysical).toContain("Merchant Returns\nReturgade 10\n2000 Frederiksberg");
    expect(danishPhysical).toContain("Du skal selv betale returportoen.");
    expect(danishPhysical).not.toContain("kontaktformularen");
    expect(danishPhysical).not.toContain("efterkrav");
    expect(danishPhysical).not.toContain("tracking");
    expect(danishPhysical).not.toContain("Refunderingen");

    const portal = renderPolicy(
      "Where do I send my return?",
      "Start your return through the returns portal. The portal will provide the shipping instructions. Refunds are processed after receipt.",
    );
    expect(portal).toContain("Start your return through the returns portal.");
    expect(portal).toContain("The portal will provide the shipping instructions.");
    expect(portal).not.toContain("Refunds are processed");
    expect(portal).not.toContain("Merchant Returns");

    const approvalFirst = renderPolicy(
      "Where do I send my return?",
      "Request return approval through support before sending the product. After approval, follow the instructions provided. Refunds are processed after receipt.",
    );
    expect(approvalFirst).toContain("Request return approval through support before sending the product.");
    expect(approvalFirst).toContain("After approval, follow the instructions provided.");
    expect(approvalFirst).not.toContain("Refunds are processed");
    expect(approvalFirst).not.toContain("Merchant Returns");
  });

  it("preserves answer-bearing values across prose paragraphs", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const policy = await registry.execute("search_policy", JSON.stringify({ query: "return policy" }));
    const renderPolicy = (customerMessage, text) => {
      const context = { ...registry, customerMessage };
      const result = validateStructuredResponse({ segments: [{
        type: "knowledge_guidance",
        text,
        basis: { result_id: policy.resultId, field_paths: ["results"] },
      }] }, context);
      expect(result.allValid).toBe(true);
      return renderResponseSegments(result.approvedSegments, context);
    };

    expect(renderPolicy(
      "Where do I send my return?",
      "Send the return to:\n\nMerchant Returns\nReturn Street 10\n2000 Frederiksberg\nDenmark",
    )).toContain("Send the return to:\nMerchant Returns\nReturn Street 10\n2000 Frederiksberg\nDenmark");
    expect(renderPolicy(
      "Where do I send my return?",
      "Use the returns portal here:\n\nhttps://returns.example.test/start",
    )).toContain("https://returns.example.test/start");
    expect(renderPolicy(
      "Where can I contact support?",
      "Contact support at:\n\nsupport@example.test",
    )).toContain("support@example.test");
    expect(renderPolicy(
      "What is my tracking link?",
      "Your tracking link is:\n\nhttps://tracking.example.test/parcel-1",
    )).toContain("https://tracking.example.test/parcel-1");
    expect(renderPolicy(
      "When will I get my refund?",
      "The refund will be processed within:\n\n5 business days after receipt.",
    )).toContain("5 business days after receipt.");
    expect(renderPolicy(
      "Who pays return shipping?",
      "The payer is:\n\nYou pay the return shipping.",
    )).toContain("You pay the return shipping.");
    expect(renderPolicy(
      "Where do I send my return?",
      "Send the return to:\n\nReturns are accepted within 30 days.",
    )).not.toContain("Send the return to:");
  });

  it("returns refund timing without dumping unrelated return conditions", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const policy = await registry.execute("search_policy", JSON.stringify({ query: "refund timing" }));
    const context = { ...registry, customerMessage: "When will I get my refund?" };
    const result = validateStructuredResponse({ segments: [{
      type: "knowledge_guidance",
      text: "Returns are accepted within 30 days. Opened products may incur a EUR 50 deduction. The refund is normally processed within 5 business days. Your bank may take additional time to display the funds.",
      basis: { result_id: policy.resultId, field_paths: ["results"] },
    }] }, context);

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, context);
    expect(rendered).toContain("refund is normally processed within 5 business days");
    expect(rendered).toContain("bank may take additional time");
    expect(rendered).not.toContain("30 days");
    expect(rendered).not.toContain("EUR 50");
  });

  it("does not ask for an order number when general refund timing already answers the question", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const policy = await registry.execute("search_policy", JSON.stringify({ query: "refund timing" }));
    const context = { ...registry, customerMessage: "When will I get my refund?" };
    const result = validateStructuredResponse({ segments: [
      {
        type: "knowledge_guidance",
        text: "The refund is normally processed within 5 business days after receipt.",
        basis: { result_id: policy.resultId, field_paths: ["results"] },
      },
      {
        type: "question",
        purpose: "enable_capability",
        text: null,
        capability: "get_order",
        missing_arguments: ["order_id"],
      },
    ] }, context);

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, context);
    expect(rendered).toContain("refund is normally processed within 5 business days");
    expect(rendered).not.toContain("order number");
  });

  it("keeps a Danish return-process answer focused on the primary question", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const policy = await registry.execute("search_policy", JSON.stringify({ query: "return policy" }));
    const context = {
      ...registry,
      locale: "da",
      customerMessage: "Jeg fandt pakken, men jeg vil gerne returnere den, hvordan gør jeg?",
    };
    const result = validateStructuredResponse({ segments: [{
      type: "knowledge_guidance",
      text: "Du kan returnere varen inden for 30 dage efter modtagelsen. Udfyld kontaktformularen med årsagen til returneringen, navnet på ordren og ordrenummeret. Hvis forseglingen er brudt, kan der fratrækkes 50 EUR. Du betaler selv returfragten. Refunderingen igangsættes, når returneringen er modtaget og behandlet.",
      basis: { result_id: policy.resultId, field_paths: ["results"] },
    }] }, context);

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, context);
    expect(rendered.indexOf("Udfyld kontaktformularen")).toBeLessThan(rendered.indexOf("Du kan returnere varen"));
    expect(rendered).not.toContain("50 EUR");
    expect(rendered).not.toContain("returfragten");
    expect(rendered).not.toContain("Refunderingen igangsættes");
  });

  it("keeps a Danish opened-package answer on the condition asked about", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const policy = await registry.execute("search_policy", JSON.stringify({ query: "return policy" }));
    const context = {
      ...registry,
      locale: "da",
      customerMessage: "Jeg har åbnet pakken, kan jeg stadig returnere den?",
    };
    const result = validateStructuredResponse({ segments: [{
      type: "knowledge_guidance",
      text: "Du kan stadig returnere varen, selv om forseglingen er brudt. Hvis emballagen ikke er komplet, kan der trækkes 50 EUR. Du betaler selv returfragten. Refunderingen behandles efter modtagelsen.",
      basis: { result_id: policy.resultId, field_paths: ["results"] },
    }] }, context);

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, context);
    expect(rendered).toContain("Du kan stadig returnere varen, selv om forseglingen er brudt.");
    expect(rendered).toContain("50 EUR");
    expect(rendered).not.toContain("returfragten");
    expect(rendered).not.toContain("Refunderingen behandles");
  });

  it("translates proposal-only cancellation questions into customer language", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const context = {
      ...registry,
      locale: "da",
      customerMessage: "Kan du annullere min ordre?",
    };
    const result = validateStructuredResponse({ segments: [{
      type: "question",
      purpose: "enable_capability",
      text: null,
      capability: "cancel_order",
      missing_arguments: ["order_id", "reason"],
    }] }, context);

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, context);
    expect(rendered).toContain("hjælpe dig med at anmode om at få ordren annulleret");
    expect(rendered).not.toContain("forslag");
    expect(rendered).not.toContain("cancellation of an order");
    expect(rendered).toContain("Der bliver ikke ændret noget, før du bekræfter");
  });

  it("preserves explicit address and step line breaks", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const knowledge = await registry.execute("search_policy", JSON.stringify({ query: "return window" }));
    const result = validate(registry, {
      type: "knowledge_guidance",
      text: "Once the return is accepted, send it to:\nAceZone International ApS\nNordre Fasanvej 113\n2000 Frederiksberg\nDenmark\nUse tracked shipping.",
      basis: { result_id: knowledge.resultId, field_paths: ["results"] },
    });

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, registry);
    expect(rendered).toContain("send it to:\nAceZone International ApS\nNordre Fasanvej 113\n2000 Frederiksberg\nDenmark\nUse tracked shipping.");
  });

  it("adapts website contact instructions when the customer is already in support", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const policy = await registry.execute("search_policy", JSON.stringify({ query: "return policy" }));
    const result = validateStructuredResponse({ segments: [{
      type: "knowledge_guidance",
      text: "Returns can be requested within 30 days. To start the return, contact returns@example.test with the reason for return, the name used at purchase, and the order number.",
      basis: { result_id: policy.resultId, field_paths: ["results"] },
    }] }, {
      ...registry,
      interactionChannel: "playground",
      activeOrder: { requestedOrderId: "1063", state: "unresolved", order: null },
      trustedCustomerIdentity: { verified: false, hasName: false, hasEmail: false },
    });

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, {
      ...registry,
      interactionChannel: "playground",
      activeOrder: { requestedOrderId: "1063", state: "unresolved", order: null },
      trustedCustomerIdentity: { verified: false, hasName: false, hasEmail: false },
    });
    expect(rendered).toContain("30 days");
    expect(rendered).toContain("reason for return");
    expect(rendered).not.toContain("returns@example.test");
    expect(rendered).not.toMatch(/contact\s+(?:us|support)/i);
    expect(rendered).not.toContain("order number");
    expect(rendered).not.toMatch(/[,;:]\s*[.!?]/);
    expect(rendered).not.toMatch(/\b(?:with|and|or|provide)\s*[.!?]/i);
  });

  it("turns a filtered requirement list into a natural question for the remaining field", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const policy = await registry.execute("search_policy", JSON.stringify({ query: "return policy" }));
    const context = {
      ...registry,
      interactionChannel: "playground",
      activeOrder: { requestedOrderId: "1063", state: "unresolved", order: null },
      trustedCustomerIdentity: { verified: true, hasName: true, hasEmail: true },
    };
    const result = validateStructuredResponse({ segments: [{
      type: "knowledge_guidance",
      text: "To start the return, contact returns@example.test with the reason for return, the name used at purchase, and the order number.",
      basis: { result_id: policy.resultId, field_paths: ["results"] },
    }] }, context);

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, context);
    expect(rendered).toContain("What’s the reason for return?");
    expect(rendered).not.toContain("name used at purchase");
    expect(rendered).not.toContain("order number");
    expect(rendered).not.toMatch(/[,;:]\s*[.!?]/);
  });

  it("removes a fully satisfied requirement sentence without leaving a fragment", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const policy = await registry.execute("search_policy", JSON.stringify({ query: "return policy" }));
    const context = {
      ...registry,
      interactionChannel: "playground",
      activeOrder: { requestedOrderId: "1063", state: "verified", order: null },
      trustedCustomerIdentity: { verified: true, hasName: true, hasEmail: true },
    };
    const result = validateStructuredResponse({ segments: [{
      type: "knowledge_guidance",
      text: "To start the return, contact returns@example.test with the name used at purchase and the order number. Refunds are initiated after processing.",
      basis: { result_id: policy.resultId, field_paths: ["results"] },
    }] }, context);

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, context);
    expect(rendered).toBe("Refunds are initiated after processing.");
    expect(rendered).not.toMatch(/[,;:]\s*[.!?]/);
  });

  it("keeps a contact instruction in a non-support context", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const policy = await registry.execute("search_policy", JSON.stringify({ query: "return policy" }));
    const result = validateStructuredResponse({ segments: [{
      type: "knowledge_guidance",
      text: "To start the return, contact returns@example.test with the reason for return.",
      basis: { result_id: policy.resultId, field_paths: ["results"] },
    }] }, { ...registry, interactionChannel: undefined });

    expect(result.allValid).toBe(true);
    expect(renderResponseSegments(result.approvedSegments, { ...registry, interactionChannel: undefined })).toContain("returns@example.test");
  });

  it("does not repeat verified customer identity requirements", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const policy = await registry.execute("search_policy", JSON.stringify({ query: "return policy" }));
    const context = {
      ...registry,
      interactionChannel: "playground",
      trustedCustomerIdentity: { verified: true, hasName: true, hasEmail: true },
    };
    const result = validateStructuredResponse({ segments: [{
      type: "knowledge_guidance",
      text: "Returns can be requested within 30 days. Please provide the name used at purchase and the email address used at checkout.",
      basis: { result_id: policy.resultId, field_paths: ["results"] },
    }] }, context);

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, context);
    expect(rendered).toContain("30 days");
    expect(rendered).not.toMatch(/provide|name used at purchase|email address used at checkout/i);
  });

  it("keeps identity verification requests when no trusted identity exists", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const policy = await registry.execute("search_policy", JSON.stringify({ query: "return policy" }));
    const context = {
      ...registry,
      interactionChannel: "playground",
      trustedCustomerIdentity: { verified: false, hasName: false, hasEmail: false },
    };
    const result = validateStructuredResponse({ segments: [{
      type: "knowledge_guidance",
      text: "To continue safely, please provide the email address used at checkout.",
      basis: { result_id: policy.resultId, field_paths: ["results"] },
    }] }, context);

    expect(result.allValid).toBe(true);
    expect(renderResponseSegments(result.approvedSegments, context)).toContain("email address used at checkout");
  });

  it("preserves material policy action details and a condition clarification", async () => {
    const dependencies = await createDemoDependencies();
    await dependencies.knowledge.ingest(dependencies.tenant.workspaceId, {
      sourceKind: "merchant_policy",
      sourceId: "actionable-return-policy",
      title: "Refund policy",
      content: "RETURN PROCESS\nThe return must be accepted before shipment to Example Returns, Return Street 10. Return shipping is your responsibility.\nREFUNDS\nOpened products may still be accepted with a EUR 50 deduction. The refund starts after receipt and processing.",
      knowledgeType: "policy",
      authority: "authoritative",
      metadata: { lifecycle_status: "published" },
    });
    const registry = createCapabilityRegistry(dependencies);
    const policy = await registry.execute("search_policy", JSON.stringify({ query: "I want to return this order" }));
    const result = validateStructuredResponse({ segments: [
      {
        type: "knowledge_guidance",
        text: "The return must be accepted before shipment to Example Returns, Return Street 10. Return shipping is your responsibility, and opened products may be accepted with a EUR 50 deduction. The refund starts after receipt and processing.",
        basis: { result_id: policy.resultId, field_paths: ["results"] },
      },
      {
        type: "question",
        purpose: "pure_clarification",
        text: "Has the product been opened or used?",
        capability: null,
        missing_arguments: [],
      },
    ] }, registry);

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, registry);
    expect(rendered).toContain("Return Street 10");
    expect(rendered).toContain("EUR 50 deduction");
    expect(rendered).toContain("Has the product been opened or used?");
  });

  it("preserves a source-bound procedure contact step until that step is relevant", async () => {
    const dependencies = await createDemoDependencies();
    await dependencies.knowledge.ingest(dependencies.tenant.workspaceId, {
      sourceKind: "merchant_procedure",
      sourceId: "procedure-contact-if-fails",
      title: "Connection failure escalation",
      content: "Try the documented connection steps. If this fails, contact support.",
      knowledgeType: "procedural",
      authority: "authoritative",
      sourceLabel: "Merchant support procedure",
    });
    const registry = createCapabilityRegistry(dependencies);
    const procedure = await registry.execute("search_procedures", JSON.stringify({ query: "connection failure" }));
    const result = validateStructuredResponse({ segments: [{
      type: "procedure_guidance",
      text: "Follow the relevant procedure.",
      basis: { result_id: procedure.resultId, field_paths: ["data.results[0].structured_data.procedure_steps"] },
      step_paths: ["data.results[0].structured_data.procedure_steps[0].text"],
    }] }, { ...registry, interactionChannel: "playground" });

    expect(result.allValid).toBe(true);
    expect(renderResponseSegments(result.approvedSegments, { ...registry, interactionChannel: "playground" })).toContain("contact support");
  });

  it("keeps acknowledgement structurally unable to carry claims or promises", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const operationalClaim = validateStructuredResponse({
      segments: [{
        type: "acknowledgement",
        kind: "resolution",
        text: "The carrier delivered it correctly.",
        evidence: [{ result_id: "tool_result_1", field_paths: ["status"] }],
      }],
    }, registry);
    const actionPromise = validateStructuredResponse({
      segments: [{
        type: "acknowledgement",
        kind: "closure",
        capability: "create_refund",
        promise: "I will refund it now.",
      }],
    }, registry);

    expect(operationalClaim.schemaValid).toBe(false);
    expect(actionPromise.schemaValid).toBe(false);
  });

  it("combines an acknowledgement with evidence-backed knowledge without weakening the factual segment", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const knowledge = await registry.execute("search_policy", JSON.stringify({ query: "return window" }));
    const result = validate(registry,
      { type: "acknowledgement", kind: "transition" },
      {
        type: "knowledge_guidance",
        text: "Returns are accepted within 30 days of delivery.",
        basis: { result_id: knowledge.resultId, field_paths: ["results"] },
      },
    );
    const unsupportedFact = validate(registry,
      { type: "acknowledgement", kind: "transition" },
      {
        type: "knowledge_guidance",
        text: "This is not supported by a current tool result.",
        basis: { result_id: "outside-run", field_paths: ["results"] },
      },
    );

    expect(result.allValid).toBe(true);
    expect(renderResponseSegments(result.approvedSegments, registry)).toContain("Got it.");
    expect(renderResponseSegments(result.approvedSegments, registry)).toContain("30 days");
    expect(unsupportedFact.approvedSegments).toEqual([{ type: "acknowledgement", kind: "transition" }]);
    expect(unsupportedFact.issues[0].code).toBe("unknown_result_id");
  });

  it("accepts a verified fact that cites a returned field", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const order = await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));

    const result = validate(registry, {
      type: "fact",
      fact_kind: "order_fulfillment_status",
      evidence: [{ result_id: order.resultId, field_paths: ["fulfillmentStatus", "status"] }],
    });

    expect(result.allValid).toBe(true);
    expect(result.approvedSegments).toHaveLength(1);
    const rendered = renderResponseSegments(result.approvedSegments, registry);
    expect(rendered).toContain("has shipped");
    expect(rendered).not.toContain("delivered");
  });

  it("renders the verified financial status value", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const order = await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const result = validate(registry, {
      type: "fact",
      fact_kind: "order_financial_status",
      evidence: [{ result_id: order.resultId, field_paths: ["financialStatus"] }],
    });

    expect(result.allValid).toBe(true);
    expect(renderResponseSegments(result.approvedSegments, registry)).toContain("paid");
  });

  it("renders the verified carrier value", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const order = await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const result = validate(registry, {
      type: "fact",
      fact_kind: "shipment_carrier",
      evidence: [{ result_id: order.resultId, field_paths: ["fulfillments[0].carrier"] }],
    });

    expect(result.allValid).toBe(true);
    expect(renderResponseSegments(result.approvedSegments, registry)).toContain("ParcelCo");
  });

  it("rejects a field path that the tool did not return", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const order = await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));

    const result = validate(registry, {
      type: "fact",
      fact_kind: "order_fulfillment_status",
      evidence: [{ result_id: order.resultId, field_paths: ["delivery_address"] }],
    });

    expect(result.allValid).toBe(false);
    expect(result.approvedSegments).toEqual([]);
    expect(result.issues[0].code).toBe("unknown_field_path");
  });

  it("rejects a fact based on a null returned field", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const tracking = await registry.execute("get_tracking", JSON.stringify({ tracking_number: "PC10231" }));

    const result = validate(registry, {
      type: "fact",
      fact_kind: "shipment_eta",
      evidence: [{ result_id: tracking.resultId, field_paths: ["live_tracking.estimatedDelivery"] }],
    });

    expect(result.allValid).toBe(false);
    expect(result.issues[0].code).toBe("empty_field");
    expect(renderResponseSegments(result.approvedSegments, registry)).not.toContain("Estimated delivery");
  });

  it("accepts a proposal mode but fails closed for an executed mode", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const proposal = validate(registry, {
      type: "action_offer",
      capability: "cancel_order",
      mode: "proposal",
      missing_arguments: [],
    });
    const executed = validateStructuredResponse({
      segments: [{
        type: "action_offer",
        capability: "cancel_order",
        mode: "executed",
        missing_arguments: [],
      }],
    }, registry);

    expect(proposal.allValid).toBe(true);
    expect(StructuredResponseSchema.safeParse(executed.parsed).success).toBe(false);
    expect(executed.schemaValid).toBe(false);
  });

  it("rejects an action that is not in the current manifest", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const result = validate(registry, {
      type: "action_offer",
      capability: "open_carrier_case",
      mode: "proposal",
      missing_arguments: [],
    });

    expect(result.allValid).toBe(false);
    expect(result.issues[0].code).toBe("unknown_action_capability");
  });

  it("requires an action offer to be backed by a proposal tool result", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const result = validateStructuredResponse({
      segments: [{ type: "action_offer", capability: "cancel_order", mode: "proposal", missing_arguments: [] }],
    }, { ...registry, proposedActions: [] });

    expect(result.allValid).toBe(false);
    expect(result.issues[0].code).toBe("action_not_proposed");
  });

  it("rejects unsupported operational commitments in free-form segments", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const knowledge = await registry.execute("search_policy", JSON.stringify({ query: "shipping" }));
    const result = validate(registry, {
      type: "knowledge_guidance",
      text: "I can get the team to put the order on hold while you are away.",
      basis: { result_id: knowledge.resultId, field_paths: ["results"] },
    });

    expect(result.allValid).toBe(false);
    expect(result.issues[0].code).toBe("unsupported_operational_commitment");
  });

  it("does not mistake a tracking limitation for an operational promise", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const order = await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const result = validate(registry, {
      type: "limitation",
      text: "I can see the tracking number, but the provider returned no live record. I can advise on the next step.",
      basis: { result_id: order.resultId, field_paths: ["fulfillments[0].trackingNumber"] },
    });

    expect(result.allValid).toBe(true);
  });

  it("rejects free-form proposal language when no action offer exists", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const knowledge = await registry.execute("search_policy", JSON.stringify({ query: "shipping" }));
    const result = validate(registry, {
      type: "knowledge_guidance",
      text: "I can prepare a proposal for cancellation.",
      basis: { result_id: knowledge.resultId, field_paths: ["results"] },
    });

    expect(result.allValid).toBe(false);
    expect(result.issues[0].code).toBe("unsupported_operational_commitment");
  });

  it("does not let a free-form question smuggle an unsupported action offer", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const result = validate(registry, {
      type: "question",
      purpose: "pure_clarification",
      text: "Do you want us to cancel the order instead?",
      capability: null,
      missing_arguments: [],
    });

    expect(result.allValid).toBe(false);
    expect(result.issues[0].code).toBe("unsupported_operational_commitment");
  });

  it("rejects operational alternatives hidden inside a clarification question", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const result = validate(registry, {
      type: "question",
      purpose: "pure_clarification",
      text: "Do you mean delay the unshipped items, or cancel them and reorder on Friday?",
      capability: null,
      missing_arguments: [],
    });

    expect(result.allValid).toBe(false);
    expect(result.issues[0].code).toBe("unsupported_operational_commitment");
  });

  it("rejects preference questions that smuggle unsupported operational alternatives", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const result = validate(registry, {
      type: "question",
      purpose: "pure_clarification",
      text: "Which option do you prefer: cancel and re-order on Friday, or keep it as-is?",
      capability: null,
      missing_arguments: [],
    });

    expect(result.allValid).toBe(false);
    expect(result.issues[0].code).toBe("unsupported_operational_commitment");
  });

  it("rejects a future proposal promise separated from its setup by supporting context", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const knowledge = await registry.execute("search_policy", JSON.stringify({ query: "shipping" }));
    const result = validate(registry, {
      type: "knowledge_guidance",
      text: "I cannot verify the carrier from here. Could you share the new address so I can prepare a proposal for an address update?",
      basis: { result_id: knowledge.resultId, field_paths: ["results"] },
    });

    expect(result.allValid).toBe(false);
    expect(result.issues[0].code).toBe("unsupported_operational_commitment");
  });

  it("allows authoritative knowledge guidance but does not turn it into execution", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const knowledge = await registry.execute("search_policy", JSON.stringify({ query: "return window" }));
    const guidance = validate(registry, {
      type: "knowledge_guidance",
      text: "Returns are accepted within 30 days.",
      basis: { result_id: knowledge.resultId, field_paths: ["results"] },
    });
    const executed = validateStructuredResponse({
      segments: [{ type: "action_offer", capability: "create_refund", mode: "executed", missing_arguments: [] }],
    }, registry);

    expect(guidance.allValid).toBe(true);
    expect(executed.schemaValid).toBe(false);
  });

  it("accepts reference product knowledge as product guidance", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const knowledge = await registry.execute("search_product_knowledge", JSON.stringify({ query: "wireless receiver" }));
    const guidance = validate(registry, {
      type: "knowledge_guidance",
      text: "The Orion Wireless uses Bluetooth and the included USB receiver.",
      basis: { result_id: knowledge.resultId, field_paths: ["results"] },
    });

    expect(guidance.allValid).toBe(true);
  });

  it("does not let reference product knowledge authorize policy or procedure guidance", async () => {
    const dependencies = await createDemoDependencies();
    const productOnlyKnowledge = {
      ingest: (...args) => dependencies.knowledge.ingest(...args),
      search: async (request) => dependencies.knowledge.search({ ...request, knowledgeTypes: ["product"] }),
    };
    const registry = createCapabilityRegistry({ ...dependencies, knowledge: productOnlyKnowledge });
    const policyResult = await registry.execute("search_policy", JSON.stringify({ query: "wireless" }));
    const procedureResult = await registry.execute("search_procedures", JSON.stringify({ query: "wireless" }));
    const policyGuidance = validate(registry, {
      type: "knowledge_guidance",
      text: "Returns are accepted within 30 days.",
      basis: { result_id: policyResult.resultId, field_paths: ["results"] },
    });
    const procedureGuidance = validate(registry, {
      type: "knowledge_guidance",
      text: "Reset the headset and pair it again.",
      basis: { result_id: procedureResult.resultId, field_paths: ["results"] },
    });

    expect(policyGuidance.allValid).toBe(false);
    expect(policyGuidance.issues[0].code).toBe("knowledge_authority_insufficient");
    expect(procedureGuidance.allValid).toBe(false);
    expect(procedureGuidance.issues[0].code).toBe("knowledge_authority_insufficient");
  });

  it("represents live product values without using order-item semantics", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({
      ...dependencies,
      commerce: {
        ...dependencies.commerce,
        async getProduct() {
          return {
            status: "ok",
            products: [{ title: "Aurora Headset", handle: "aurora-headset", variants: [{ title: "Black", sku: "AUR-BLK" }] }],
          };
        },
      },
    });
    const product = await registry.execute("get_product", JSON.stringify({ query: "Aurora Headset" }));
    const title = validate(registry, {
      type: "fact",
      fact_kind: "product_value",
      evidence: [{ result_id: product.resultId, field_paths: ["products[0].title"] }],
    });
    const orderItem = validate(registry, {
      type: "fact",
      fact_kind: "order_item",
      evidence: [{ result_id: product.resultId, field_paths: ["products[0].title"] }],
    });
    const sku = validate(registry, {
      type: "fact",
      fact_kind: "product_value",
      evidence: [{ result_id: product.resultId, field_paths: ["products[0].variants[0].sku"] }],
    });

    expect(title.allValid).toBe(true);
    expect(renderResponseSegments(title.approvedSegments, registry)).toBe("The product is Aurora Headset.");
    expect(orderItem.allValid).toBe(false);
    expect(orderItem.issues[0].code).toBe("fact_field_kind_mismatch");
    expect(sku.allValid).toBe(true);
    expect(renderResponseSegments(sku.approvedSegments, registry)).toBe("The product SKU is AUR-BLK.");
  });

  it("fails closed for inventory, unknown, and null product fields", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({
      ...dependencies,
      commerce: {
        ...dependencies.commerce,
        async getProduct() {
          return {
            status: "ok",
            products: [{ title: "Aurora Headset", variants: [{ title: "Black", sku: null, inventory_quantity: 7 }] }],
          };
        },
      },
    });
    const product = await registry.execute("get_product", JSON.stringify({ query: "Aurora Headset" }));
    expect(product.data.products[0].variants[0]).not.toHaveProperty("inventory_quantity");
    const inventory = validate(registry, {
      type: "fact",
      fact_kind: "product_value",
      evidence: [{ result_id: product.resultId, field_paths: ["products[0].variants[0].inventory_quantity"] }],
    });
    const unknown = validate(registry, {
      type: "fact",
      fact_kind: "product_value",
      evidence: [{ result_id: product.resultId, field_paths: ["products[0].variants[0].made_up_field"] }],
    });
    const nullSku = validate(registry, {
      type: "fact",
      fact_kind: "product_value",
      evidence: [{ result_id: product.resultId, field_paths: ["products[0].variants[0].sku"] }],
    });

    expect(inventory.allValid).toBe(false);
    expect(inventory.issues[0].code).toBe("unknown_field_path");
    expect(unknown.allValid).toBe(false);
    expect(unknown.issues[0].code).toBe("unknown_field_path");
    expect(nullSku.allValid).toBe(false);
    expect(nullSku.issues[0].code).toBe("empty_field");
  });

  it("allows a limitation for Ship24 not_found but rejects an unsupported cause fact", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({
      ...dependencies,
      tracking: {
        providerName: "test_ship24",
        lookup: async (input) => ({
          status: "not_found",
          trackingNumber: input.trackingNumber,
          provider: "test_ship24",
          observedAt: "2026-09-03T12:00:00.000Z",
          error: { code: "tracking_not_found", message: "No live record was returned." },
        }),
      },
    });
    await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const tracking = await registry.execute("get_tracking", JSON.stringify({ tracking_number: "PC10231" }));
    const limitation = validate(registry, {
      type: "limitation",
      text: "I could not retrieve a live tracking event.",
      basis: { result_id: tracking.resultId, field_paths: [] },
    });
    const unsupportedCause = validate(registry, {
      type: "fact",
      fact_kind: "shipment_event",
      evidence: [{ result_id: tracking.resultId, field_paths: ["cause"] }],
    });

    expect(limitation.allValid).toBe(true);
    expect(unsupportedCause.allValid).toBe(false);
    expect(unsupportedCause.issues[0].code).toBe("result_not_verified");
  });

  it("accepts a delivered fact when Ship24 returned a delivered event", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({ ...dependencies, tracking: deliveredTrackingProvider() });
    await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const tracking = await registry.execute("get_tracking", JSON.stringify({ tracking_number: "PC10231" }));
    const result = validate(registry, {
      type: "fact",
      fact_kind: "shipment_status",
      evidence: [{ result_id: tracking.resultId, field_paths: ["live_tracking.status"] }],
    });

    expect(result.allValid).toBe(true);
    expect(renderResponseSegments(result.approvedSegments, registry)).toContain("delivered");
  });

  it("does not render a location fact when the verified location is null", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({ ...dependencies, tracking: deliveredTrackingProvider({ location: null }) });
    await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const tracking = await registry.execute("get_tracking", JSON.stringify({ tracking_number: "PC10231" }));
    const result = validate(registry, {
      type: "fact",
      fact_kind: "shipment_location",
      evidence: [{ result_id: tracking.resultId, field_paths: ["live_tracking.latestEvent.location"] }],
    });

    expect(result.allValid).toBe(false);
    expect(result.issues[0].code).toBe("empty_field");
    expect(renderResponseSegments(result.approvedSegments, registry)).not.toContain("Tracking location");
  });

  it("renders an order item from the verified title and quantity", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const order = await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const result = validate(registry, {
      type: "fact",
      fact_kind: "order_item",
      evidence: [{ result_id: order.resultId, field_paths: ["items[0].title", "items[0].quantity"] }],
    });

    expect(result.allValid).toBe(true);
    expect(renderResponseSegments(result.approvedSegments, registry)).toContain("1 × Orion Wireless");
  });

  it("fails closed for an unknown operational field", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const order = await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const result = validate(registry, {
      type: "fact",
      fact_kind: "order_fulfillment_status",
      evidence: [{ result_id: order.resultId, field_paths: ["inventedFulfillmentStatus"] }],
    });

    expect(result.allValid).toBe(false);
    expect(result.approvedSegments).toEqual([]);
    expect(result.issues[0].code).toBe("unknown_field_path");
  });

  it("never lets a model value replace the returned operational value", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const order = await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const inventedValue = validateStructuredResponse({
      segments: [{
        type: "fact",
        fact_kind: "order_fulfillment_status",
        evidence: [{ result_id: order.resultId, field_paths: ["fulfillmentStatus"] }],
        value: "delivered",
      }],
    }, registry);
    const verified = validate(registry, {
      type: "fact",
      fact_kind: "order_fulfillment_status",
      evidence: [{ result_id: order.resultId, field_paths: ["fulfillmentStatus"] }],
    });

    expect(inventedValue.schemaValid).toBe(false);
    expect(renderResponseSegments(verified.approvedSegments, registry)).toContain("has shipped");
    expect(renderResponseSegments(verified.approvedSegments, registry)).not.toContain("delivered");
  });

  it("validates capability-enabling questions against the existing tool schema", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const valid = validate(registry, {
      type: "question",
      purpose: "enable_capability",
      text: "Send the order number.",
      capability: "get_order",
      missing_arguments: ["order_id"],
    });
    const unknownCapability = validate(registry, {
      type: "question",
      purpose: "enable_capability",
      text: "Send the details.",
      capability: "get_order/get_order_history",
      missing_arguments: ["order_id"],
    });
    const unknownArgument = validate(registry, {
      type: "question",
      purpose: "enable_capability",
      text: "Send the address.",
      capability: "get_order",
      missing_arguments: ["delivery_address"],
    });

    expect(valid.allValid).toBe(true);
    expect(unknownCapability.allValid).toBe(false);
    expect(unknownCapability.issues[0].code).toBe("unknown_question_capability");
    expect(unknownArgument.allValid).toBe(false);
    expect(unknownArgument.issues[0].code).toBe("question_argument_not_in_schema");
  });

  it("does not turn a shipping destination question into an address action", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const policyQuestion = validateStructuredResponse({
      segments: [{
        type: "question",
        purpose: "enable_capability",
        text: "Send the order number and new address.",
        capability: "update_address",
        missing_arguments: ["order_id", "address"],
      }],
    }, { ...registry, customerMessage: "Can you ship my order to Japan?" });
    const explicitChange = validateStructuredResponse({
      segments: [{
        type: "question",
        purpose: "enable_capability",
        text: "Send the order number and new address.",
        capability: "update_address",
        missing_arguments: ["order_id", "address"],
      }],
    }, { ...registry, customerMessage: "Please change the shipping address on order #10232." });

    expect(policyQuestion.allValid).toBe(false);
    expect(policyQuestion.issues[0].code).toBe("address_change_request_required");
    expect(explicitChange.allValid).toBe(true);
  });

  it("keeps pure clarification separate from capability commitments", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const pure = validate(registry, {
      type: "question",
      purpose: "pure_clarification",
      text: "Do you mean the wireless or wired version?",
      capability: null,
      missing_arguments: [],
    });
    const smuggled = validate(registry, {
      type: "question",
      purpose: "pure_clarification",
      text: "Send your address and I will change it.",
      capability: "update_address",
      missing_arguments: ["address"],
    });

    expect(pure.allValid).toBe(true);
    expect(smuggled.allValid).toBe(false);
    expect(smuggled.issues[0].code).toBe("pure_question_has_capability");
  });

  it("renders action wording from the validated capability, not model prose", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const action = validate(registry, {
      type: "action_offer",
      capability: "update_address",
      mode: "proposal",
      missing_arguments: ["order_id", "address", "reason"],
    });

    expect(action.allValid).toBe(true);
    const { renderResponseSegments } = await import("../response-contract");
    const rendered = renderResponseSegments(action.approvedSegments, registry);
    expect(rendered).toContain("help you request an address change");
    expect(rendered).toContain("Nothing will be changed until you confirm");
    expect(rendered).not.toContain("prepare a proposal");
    expect(rendered).not.toContain("hold");
    expect(rendered).not.toContain("carrier");
  });

  it("renders a valid read follow-up from the capability schema", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const question = validate(registry, {
      type: "question",
      purpose: "enable_capability",
      text: "This text is not used to authorize the next operation.",
      capability: "get_order",
      missing_arguments: ["order_id"],
    });

    const { renderResponseSegments } = await import("../response-contract");
    const rendered = renderResponseSegments(question.approvedSegments, registry);
    expect(rendered).toContain("order number from your order confirmation");
    expect(rendered).not.toContain("Please provide");
    expect(rendered).not.toContain("not used to authorize");
  });

  it("renders safe choices when trusted history finds multiple orders", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({
      ...dependencies,
      customerMessage: "Where is my order?",
    });
    await registry.resolveCustomerOrderContext();
    const result = validateStructuredResponse({
      segments: [{
        type: "question",
        purpose: "enable_capability",
        text: "Which order do you mean?",
        capability: "get_order",
        missing_arguments: ["order_id"],
      }],
    }, registry);

    expect(result.allValid).toBe(true);
    expect(renderResponseSegments(result.approvedSegments, registry)).toBe(
      "Which order would you like help with — #10231 — Orion Wireless, #10232 — Orion Wired, #10233 — Orion Wireless, and #10234 — Orion replacement ear pads?",
    );

    const genericQuestion = validateStructuredResponse({
      segments: [{
        type: "question",
        purpose: "pure_clarification",
        text: "Do you mean your most recent order, #10231?",
        capability: null,
        missing_arguments: [],
      }],
    }, registry);
    expect(genericQuestion.allValid).toBe(true);
    expect(renderResponseSegments(genericQuestion.approvedSegments, registry)).toBe(
      "Which order would you like help with — #10231 — Orion Wireless, #10232 — Orion Wired, #10233 — Orion Wireless, and #10234 — Orion replacement ear pads?",
    );
  });

  it("composes related order facts into a concise customer sentence", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const order = await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const result = validate(registry,
      { type: "fact", fact_kind: "order_reference", evidence: [{ result_id: order.resultId, field_paths: ["orderNumber"] }] },
      { type: "fact", fact_kind: "order_item", evidence: [{ result_id: order.resultId, field_paths: ["items"] }] },
      { type: "fact", fact_kind: "order_financial_status", evidence: [{ result_id: order.resultId, field_paths: ["financialStatus"] }] },
      { type: "fact", fact_kind: "order_fulfillment_status", evidence: [{ result_id: order.resultId, field_paths: ["fulfillmentStatus"] }] },
    );

    expect(result.allValid).toBe(true);
    expect(renderResponseSegments(result.approvedSegments, registry)).toBe(
      "I’ve checked order #10231, and it is paid, has shipped, and includes 1 × Orion Wireless.",
    );
  });

  it("keeps fulfillment distinct from a delivered tracking status", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const order = await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const fulfilled = validate(registry, {
      type: "fact",
      fact_kind: "order_fulfillment_status",
      evidence: [{ result_id: order.resultId, field_paths: ["fulfillmentStatus"] }],
    });
    const deliveredRegistry = createCapabilityRegistry({ ...dependencies, tracking: deliveredTrackingProvider() });
    const deliveredOrder = await deliveredRegistry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const tracking = await deliveredRegistry.execute("get_tracking", JSON.stringify({ tracking_number: "PC10231" }));
    const delivered = validate(deliveredRegistry, {
      type: "fact",
      fact_kind: "shipment_status",
      evidence: [{ result_id: tracking.resultId, field_paths: ["live_tracking.status"] }],
    });

    expect(renderResponseSegments(fulfilled.approvedSegments, registry)).toContain("has shipped");
    expect(renderResponseSegments(fulfilled.approvedSegments, registry)).not.toContain("delivered");
    expect(renderResponseSegments(delivered.approvedSegments, deliveredRegistry)).toContain("has been delivered");
    expect(deliveredOrder.status).toBe("ok");
  });

  it("combines carrier and tracking number without provider labels", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const order = await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const result = validate(registry,
      { type: "fact", fact_kind: "shipment_carrier", evidence: [{ result_id: order.resultId, field_paths: ["fulfillments[0].carrier"] }] },
      { type: "fact", fact_kind: "shipment_tracking_number", evidence: [{ result_id: order.resultId, field_paths: ["fulfillments[0].trackingNumber"] }] },
    );

    expect(result.allValid).toBe(true);
    expect(renderResponseSegments(result.approvedSegments, registry)).toBe(
      "Your package is being handled by ParcelCo. Track your package here: https://tracking.example.test/PC10231",
    );
    expect(renderResponseSegments(result.approvedSegments, registry)).not.toMatch(/^(Carrier|Tracking number):/m);
  });

  it("renders a natural localized order-ID question", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const result = validate(registry, {
      type: "question",
      purpose: "enable_capability",
      text: "ignored",
      capability: "get_order",
      missing_arguments: ["order_id"],
    });

    expect(inferResponseLocale("Hvor er min ordre #10231?")).toBe("da");
    expect(renderResponseSegments(result.approvedSegments, { ...registry, locale: "da" })).toBe(
      "Kan du sende ordrenummeret fra din ordrebekræftelse?",
    );
  });

  it("renders a helpful limitation without inventing a tracking cause", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({
      ...dependencies,
      tracking: {
        providerName: "test_ship24",
        lookup: async (input) => ({
          status: "not_found",
          trackingNumber: input.trackingNumber,
          provider: "test_ship24",
          observedAt: "2026-09-03T12:00:00.000Z",
          error: { code: "tracking_not_found", message: "No live record was returned." },
        }),
      },
    });
    await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const tracking = await registry.execute("get_tracking", JSON.stringify({ tracking_number: "PC10231" }));
    const result = validate(registry, {
      type: "limitation",
      text: "No active tracking record was returned from the tracking provider.",
      basis: { result_id: tracking.resultId, field_paths: [] },
    });

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, { ...registry, locale: "da" });
    expect(rendered).toContain("Pakken sendes med ParcelCo.");
    expect(rendered).toContain("Du kan følge pakken her: https://tracking.example.test/PC10231");
    expect(rendered).toContain("Jeg kunne ikke finde en live trackingopdatering på pakken.");
    expect(rendered).not.toMatch(/fordi|because|provider|årsag/i);
  });

  it("distinguishes tracking provider unavailability and drops a question that cannot unlock another capability", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({
      ...dependencies,
      tracking: {
        providerName: "test_ship24",
        lookup: async (input) => ({
          status: "unavailable",
          trackingNumber: input.trackingNumber,
          provider: "test_ship24",
          observedAt: "2026-09-03T12:00:00.000Z",
          error: { code: "tracking_provider_unavailable", message: "Provider unavailable." },
        }),
      },
    });
    await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const tracking = await registry.execute("get_tracking", JSON.stringify({ tracking_number: "PC10231" }));
    const result = validate(registry,
      {
        type: "limitation",
        text: "The live provider is unavailable.",
        basis: { result_id: tracking.resultId, field_paths: [] },
      },
      {
        type: "question",
        purpose: "pure_clarification",
        text: "What does the tracking page show?",
        capability: null,
        missing_arguments: [],
      },
    );

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, registry);
    expect(rendered).toContain("Your package is being handled by ParcelCo.");
    expect(rendered).toContain("Track your package here: https://tracking.example.test/PC10231");
    expect(rendered).toContain("I can’t retrieve a live tracking update for this shipment right now.");
    expect(rendered).not.toContain("What does the tracking page show?");
    expect(rendered).not.toContain("delivered");
  });

  it("keeps a relevant customer clarification after a tracking not_found result", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({
      ...dependencies,
      tracking: {
        providerName: "test_ship24",
        lookup: async (input) => ({
          status: "not_found",
          trackingNumber: input.trackingNumber,
          provider: "test_ship24",
          observedAt: "2026-09-03T12:00:00.000Z",
        }),
      },
    });
    await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const tracking = await registry.execute("get_tracking", JSON.stringify({ tracking_number: "PC10231" }));
    const result = validate(registry,
      {
        type: "limitation",
        text: "No live tracking record was returned.",
        basis: { result_id: tracking.resultId, field_paths: [] },
      },
      {
        type: "question",
        purpose: "pure_clarification",
        text: "Does the tracking page show an error or simply no events?",
        capability: null,
        missing_arguments: [],
      },
    );

    expect(result.allValid).toBe(true);
    expect(renderResponseSegments(result.approvedSegments, registry)).toContain("Does the tracking page show an error or simply no events?");
  });

  it("turns availability not_found into a useful alternate-identifier next step", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({
      ...dependencies,
      commerce: {
        ...dependencies.commerce,
        async getProductAvailability(query) {
          return { status: "not_found", query };
        },
      },
    });
    const availability = await registry.execute("get_product_availability", JSON.stringify({ query: "No Such Chaos 999" }));
    const result = validate(registry,
      {
        type: "limitation",
        text: "The product was not found.",
        basis: { result_id: availability.resultId, field_paths: [] },
      },
      {
        type: "question",
        purpose: "enable_capability",
        text: "Which product name or SKU should I check for availability?",
        capability: "get_product_availability",
        missing_arguments: ["query"],
      },
    );

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, registry);
    expect(rendered).toContain("couldn’t find a matching product or variant");
    expect(rendered).toContain("SKU or product link");
    expect(rendered).not.toContain("Which product name or SKU");
    expect(rendered).not.toContain("out of stock");
  });

  it("does not ask for more product data while availability is unavailable", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({
      ...dependencies,
      commerce: {
        ...dependencies.commerce,
        async getProductAvailability(query) {
          return { status: "unavailable", query };
        },
      },
    });
    const availability = await registry.execute("get_product_availability", JSON.stringify({ query: "A-Blaze" }));
    const result = validate(registry,
      {
        type: "limitation",
        text: "The availability lookup is unavailable.",
        basis: { result_id: availability.resultId, field_paths: [] },
      },
      {
        type: "question",
        purpose: "pure_clarification",
        text: "Which version or SKU do you mean?",
        capability: null,
        missing_arguments: [],
      },
    );

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, registry);
    expect(rendered).toBe("I can’t check the current availability right now.");
  });

  it("treats a nested unknown availability result as unknown when the customer already named the product", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({
      ...dependencies,
      commerce: {
        ...dependencies.commerce,
        async getProductAvailability() {
          return { status: "unknown", query: "", products: [] };
        },
      },
    });
    const availability = await registry.execute("get_product_availability", JSON.stringify({ query: "" }));
    const result = validate(registry,
      {
        type: "limitation",
        text: "Availability could not be established.",
        basis: { result_id: availability.resultId, field_paths: ["data.status"] },
      },
      {
        type: "question",
        purpose: "enable_capability",
        text: "Which product name or SKU should I check for availability?",
        capability: "get_product_availability",
        missing_arguments: ["query"],
      },
    );

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, {
      ...registry,
      customerMessage: "Can I buy No Such Chaos 999 right now?",
    });
    expect(rendered).toContain("because the lookup did not include a specific product or variant");
    expect(rendered).toContain("Which product name or SKU should I check for availability?");
  });

  it("keeps an action-related question when an unrelated tracking lookup is limited", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const tracking = await registry.execute("get_tracking", JSON.stringify({ tracking_number: "PC10231" }));
    const result = validate(registry,
      {
        type: "limitation",
        text: "No live tracking record was returned.",
        basis: { result_id: tracking.resultId, field_paths: [] },
      },
      {
        type: "question",
        purpose: "enable_capability",
        text: "What reason should I use for the replacement request?",
        capability: "send_replacement",
        missing_arguments: ["order_id", "item_id", "reason"],
      },
    );

    expect(result.allValid).toBe(true);
    expect(renderResponseSegments(result.approvedSegments, registry)).toContain("Could you share the order number, the item ID, and the reason");
  });

  it("keeps order history items bound to their own order", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const history = await registry.execute("get_order_history", JSON.stringify({}));
    const result = validate(registry,
      {
        type: "fact",
        fact_kind: "order_reference",
        evidence: [{ result_id: history.resultId, field_paths: ["data.orders[0].orderNumber", "data.orders[1].orderNumber"] }],
      },
      {
        type: "fact",
        fact_kind: "order_item",
        evidence: [{ result_id: history.resultId, field_paths: ["data.orders[0].items", "data.orders[1].items"] }],
      },
    );

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, registry);
    expect(rendered).toContain("#10231: 1 × Orion Wireless");
    expect(rendered).toContain("#10232: 1 × Orion Wired");
    expect(rendered).not.toContain("#10231: 1 × Orion Wired");
  });

  it("aggregates repeated returned order lines instead of deduplicating quantity", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({
      ...dependencies,
      commerce: {
        ...dependencies.commerce,
        async getOrder(orderId) {
          const order = await dependencies.commerce.getOrder(orderId);
          return order ? { ...order, items: [
            { id: "line-a", title: "Orion Wireless", quantity: 1 },
            { id: "line-b", title: "Orion Wireless", quantity: 2 },
          ] } : null;
        },
      },
    });
    const order = await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const result = validate(registry,
      { type: "fact", fact_kind: "order_reference", evidence: [{ result_id: order.resultId, field_paths: ["data.orderNumber"] }] },
      { type: "fact", fact_kind: "order_item", evidence: [{ result_id: order.resultId, field_paths: ["data.items"] }] },
    );

    expect(result.allValid).toBe(true);
    expect(renderResponseSegments(result.approvedSegments, registry)).toContain("3 × Orion Wireless");
    expect(renderResponseSegments(result.approvedSegments, registry)).not.toContain("1 × Orion Wireless");
  });

  it("does not pair a latest timestamp with an older checkpoint location", async () => {
    const dependencies = await createDemoDependencies();
    const tracking = deliveredTrackingProvider({ location: null });
    const originalLookup = tracking.lookup;
    tracking.lookup = async (input) => {
      const result = await originalLookup(input);
      result.data.checkpoints = [{
        description: "Older scan",
        timestamp: "2026-09-03T10:00:00.000Z",
        location: "Older location",
      }];
      return result;
    };
    const registry = createCapabilityRegistry({ ...dependencies, tracking });
    await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const live = await registry.execute("get_tracking", JSON.stringify({ tracking_number: "PC10231" }));
    const result = validate(registry,
      { type: "fact", fact_kind: "shipment_status", evidence: [{ result_id: live.resultId, field_paths: ["data.live_tracking.status"] }] },
      { type: "fact", fact_kind: "shipment_timestamp", evidence: [{ result_id: live.resultId, field_paths: ["data.live_tracking.latestEvent.timestamp"] }] },
      { type: "fact", fact_kind: "shipment_location", evidence: [{ result_id: live.resultId, field_paths: ["data.live_tracking.checkpoints[0].location"] }] },
    );

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, registry);
    expect(rendered).toContain("The latest scan was on");
    expect(rendered).not.toContain("Older location");
  });

  it("uses customer-facing wording when procedure knowledge is not found", async () => {
    const dependencies = await createDemoDependencies();
    const knowledge = {
      ingest: (...args) => dependencies.knowledge.ingest(...args),
      search: async () => [],
    };
    const registry = createCapabilityRegistry({ ...dependencies, knowledge });
    const procedure = await registry.execute("search_procedures", JSON.stringify({ query: "reset unknown headset" }));
    const result = validate(registry, {
      type: "limitation",
      text: "Knowledge retrieval returned no evidence.",
      basis: { result_id: procedure.resultId, field_paths: [] },
    });

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, registry);
    expect(rendered).toBe("I couldn’t verify a support procedure for this issue from our current guidance.");
    expect(rendered).not.toMatch(/retrieval|database|system/i);
  });

  it("uses customer-facing wording when procedure retrieval returns only weak legacy evidence", async () => {
    const dependencies = await createDemoDependencies();
    const record = {
      id: "legacy-procedure",
      workspaceId: dependencies.tenant.workspaceId,
      knowledgeType: "procedural",
      authority: "authoritative",
      title: "[DEV lifecycle] Procedure",
      content: "Open the test workflow and confirm the expected result.",
      structuredData: { procedure_steps: [{ text: "Open the test workflow and confirm the expected result." }] },
      sourceKind: "merchant_authored",
      sourceId: "legacy-procedure",
      sourceUri: null,
      sourceLabel: "Legacy procedure",
      contentHash: "legacy-procedure",
      publishedAt: null,
      observedAt: null,
      expiresAt: null,
      metadata: {},
      chunks: ["Open the test workflow and confirm the expected result."],
      taskKey: null,
    };
    const registry = createCapabilityRegistry({
      ...dependencies,
      knowledge: {
        ingest: async () => record,
        search: async () => [{
          record,
          score: 0.0864,
          taskRelevance: 0,
          taskTitleMatches: 0,
          taskBodyMatches: 0,
          matchReason: "lexical",
          rank: 1,
          evidenceSections: [{ heading: "Source context", content: record.content, chunkIds: ["legacy-procedure"] }],
          taskSpecificity: "sufficient",
        }],
      },
    });
    const procedure = await registry.execute("search_procedures", JSON.stringify({ query: "headset keeps disconnecting from the dongle" }));
    const result = validate(registry, {
      type: "limitation",
      text: "The procedure lookup returned no usable support guidance.",
      basis: { result_id: procedure.resultId, field_paths: [] },
    });

    expect(procedure.status).toBe("not_found");
    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, registry);
    expect(rendered).toContain("couldn’t verify a support procedure");
    expect(rendered).not.toMatch(/technical|retrieval|database|system/i);
  });

  it("states the useful partial-fulfillment distinction without inventing item allocation", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({
      ...dependencies,
      commerce: {
        ...dependencies.commerce,
        async getOrder(orderId) {
          const order = await dependencies.commerce.getOrder(orderId);
          return order ? { ...order, fulfillmentStatus: "partial" } : null;
        },
      },
    });
    const order = await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    const result = validate(registry,
      { type: "fact", fact_kind: "order_reference", evidence: [{ result_id: order.resultId, field_paths: ["orderNumber"] }] },
      { type: "fact", fact_kind: "order_fulfillment_status", evidence: [{ result_id: order.resultId, field_paths: ["fulfillmentStatus"] }] },
    );

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, registry);
    expect(rendered).toContain("has shipped some items while others are still unfulfilled");
    expect(rendered).not.toContain("delivered");
    expect(rendered).not.toContain("missing item");
  });

  it("keeps proposal safety intact while composing action wording", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const result = validate(registry,
      {
        type: "question",
        purpose: "enable_capability",
        text: "ignored",
        capability: "create_refund",
        missing_arguments: ["order_id", "amount", "reason"],
      },
      {
        type: "action_offer",
        capability: "create_refund",
        mode: "proposal",
        missing_arguments: ["order_id", "amount", "reason"],
      },
    );

    const rendered = renderResponseSegments(result.approvedSegments, registry);
    expect(rendered).toContain("help you request a refund");
    expect(rendered).toContain("Nothing will be changed until you confirm");
    expect(rendered).not.toContain("prepare a proposal");
    expect(rendered).not.toMatch(/has been refunded|was refunded/i);
    expect(rendered.match(/Could you share/g)).toHaveLength(1);
  });

  it("fails closed for invented evidence", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const evidence = validate(registry, {
      type: "fact",
      fact_kind: "order_fulfillment_status",
      evidence: [{ result_id: "tool_result_999", field_paths: ["fulfillmentStatus"] }],
    });
    expect(evidence.allValid).toBe(false);
    expect(evidence.issues[0].code).toBe("unknown_result_id");
  });
});

function answerEvidenceRecord(records) {
  return {
    resultId: "answer-completeness-1",
    toolName: "search_policy",
    result: {
      status: "ok",
      data: { results: records },
    },
  };
}

function policyRecord(content, title = "Authoritative support policy", structuredData) {
  return {
    title,
    knowledge_type: "policy",
    authority: "authoritative",
    evidence_sections: [{ heading: "Relevant policy section", content }],
    provenance: { source_kind: "merchant_authored", source_id: title },
    ...(structuredData ? { structured_data: structuredData } : {}),
  };
}

function procedureEvidenceRecord({ taskSpecificity = "sufficient", procedureEvidenceQuality = "usable", records = [{
  title: "A-Blaze pairing procedure",
  knowledge_type: "procedural",
  authority: "authoritative",
  task_relevance_score: 1,
  rank: 1,
  evidence_sections: [{ heading: "Pairing", content: "Pair the headset with the USB-C dongle." }],
  structured_data: {
    applies_to: { product_models: ["A-Blaze"] },
    procedure_steps: [
      { block_id: "pair_1", kind: "instruction", text: "Plug the USB-C dongle into the PC." },
      { block_id: "pair_2", kind: "instruction", text: "Turn on the headset and wait for it to pair." },
    ],
  },
  provenance: { source_kind: "merchant_authored", source_id: "a-blaze-pairing" },
}] } = {}) {
  return {
    resultId: "procedure-completeness-1",
    toolName: "search_procedures",
    result: {
      status: taskSpecificity === "sufficient" && procedureEvidenceQuality === "usable" ? "ok" : "not_found",
      data: {
        task_specificity: taskSpecificity,
        procedure_evidence_quality: procedureEvidenceQuality,
        results: records,
      },
    },
  };
}

async function recoveryCase(customerMessage, modelSegments, evidenceRecords, customerProvidedContext = {}, interactionChannel) {
  const dependencies = await createDemoDependencies();
  const registry = createCapabilityRegistry(dependencies);
  const getResult = registry.getResult;
  const context = {
    ...registry,
    customerMessage,
    customerProvidedContext,
    interactionChannel,
    getResult: (resultId) => evidenceRecords.find((evidence) => evidence.resultId === resultId) ?? getResult(resultId),
    getResults: () => [...evidenceRecords, ...registry.getResults()],
  };
  const initial = validateStructuredResponse({ segments: modelSegments }, context);
  const completed = ensureAnswerCompleteness(initial, context);
  return { context, initial, completed, rendered: renderResponseSegments(completed.approvedSegments, context) };
}

async function invalidResponseRecoveryCase(customerMessage, evidenceRecords) {
  const dependencies = await createDemoDependencies();
  const registry = createCapabilityRegistry(dependencies);
  const getResult = registry.getResult;
  const context = {
    ...registry,
    customerMessage,
    getResult: (resultId) => evidenceRecords.find((evidence) => evidence.resultId === resultId) ?? getResult(resultId),
    getResults: () => [...evidenceRecords, ...registry.getResults()],
  };
  const initial = validateStructuredResponse("The model returned an unstructured fallback.", context);
  const completed = ensureAnswerCompleteness(initial, context);
  return { context, initial, completed, rendered: renderResponseSegments(completed.approvedSegments, context) };
}

async function answerCompletenessCase(customerMessage, modelText, records) {
  const dependencies = await createDemoDependencies();
  const registry = createCapabilityRegistry(dependencies);
  const evidence = answerEvidenceRecord(records);
  const getResult = registry.getResult;
  const context = {
    ...registry,
    customerMessage,
    getResult: (resultId) => resultId === evidence.resultId ? evidence : getResult(resultId),
    getResults: () => [evidence, ...registry.getResults()],
  };
  const initial = validateStructuredResponse({ segments: [{
    type: "knowledge_guidance",
    text: modelText,
    basis: { result_id: evidence.resultId, field_paths: ["results"] },
  }] }, context);
  const completed = ensureAnswerCompleteness(initial, context);
  return { context, completed, rendered: renderResponseSegments(completed.approvedSegments, context) };
}

async function policyTruthCase(customerMessage, modelText, records, fieldPaths = ["results"]) {
  const dependencies = await createDemoDependencies();
  const registry = createCapabilityRegistry(dependencies);
  const evidence = answerEvidenceRecord(records);
  const getResult = registry.getResult;
  const context = {
    ...registry,
    customerMessage,
    getResult: (resultId) => resultId === evidence.resultId ? evidence : getResult(resultId),
  };
  const result = validateStructuredResponse({ segments: [{
    type: "knowledge_guidance",
    text: modelText,
    basis: { result_id: evidence.resultId, field_paths: fieldPaths },
  }] }, context);
  return { context, result, rendered: renderResponseSegments(result.approvedSegments, context) };
}

describe("model-to-contract answer completeness", () => {
  it("restores one omitted physical destination from selected evidence", async () => {
    const result = await answerCompletenessCase(
      "Where do I send my return?",
      "Send the return to:",
      [policyRecord("Send the return to:\nMerchant Returns\nReturn Street 10\n2000 Frederiksberg")],
    );

    expect(result.completed.allValid).toBe(true);
    expect(result.rendered).toContain("Merchant Returns");
    expect(result.rendered).toContain("Return Street 10");
    expect(result.rendered).toContain("2000 Frederiksberg");
  });

  it("restores one omitted return portal URL from selected evidence", async () => {
    const result = await answerCompletenessCase(
      "Where do I send my return?",
      "Use the returns portal:",
      [policyRecord("Use the returns portal:\nhttps://returns.example.test/start")],
    );

    expect(result.rendered).toContain("https://returns.example.test/start");
  });

  it("restores one omitted tracking URL from selected evidence", async () => {
    const result = await answerCompletenessCase(
      "Where is my tracking link?",
      "Your tracking link is:",
      [policyRecord("Your tracking link is:\nhttps://tracking.example.test/parcel-1")],
    );

    expect(result.rendered).toContain("https://tracking.example.test/parcel-1");
  });

  it("restores one omitted contact email from selected evidence", async () => {
    const result = await answerCompletenessCase(
      "Where can I contact support?",
      "Contact support at:",
      [policyRecord("Contact support at:\nsupport@example.test")],
    );

    expect(result.rendered).toContain("support@example.test");
  });

  it("restores one omitted refund timing value from selected evidence", async () => {
    const result = await answerCompletenessCase(
      "When will I get my refund?",
      "Your refund is processed within:",
      [policyRecord("Your refund is processed within 5 business days after receipt.")],
    );

    expect(result.rendered).toContain("5 business days after receipt");
  });

  it("restores one omitted return-shipping payer from selected evidence", async () => {
    const result = await answerCompletenessCase(
      "Who pays return shipping?",
      "Return shipping is paid by:",
      [policyRecord("The customer is responsible for return shipping costs.")],
    );

    expect(result.rendered).toContain("responsible for return shipping costs");
  });

  it("restores one omitted eligibility answer from selected evidence", async () => {
    const result = await answerCompletenessCase(
      "Can I return it?",
      "Returns are accepted:",
      [policyRecord("Yes, returns are accepted within 30 days after delivery.")],
    );

    expect(result.rendered).toContain("returns are accepted within 30 days after delivery");
  });

  it("withholds an incomplete answer when selected evidence has conflicting destinations", async () => {
    const result = await answerCompletenessCase(
      "Where do I send my return?",
      "Send the return to:",
      [
        policyRecord("Send the return to:\nReturns North\nNorth Street 1\n1000 Copenhagen", "North return policy"),
        policyRecord("Send the return to:\nReturns South\nSouth Street 2\n2000 Aarhus", "South return policy"),
      ],
    );

    expect(result.completed.allValid).toBe(false);
    expect(result.completed.approvedSegments).toEqual([]);
    expect(result.completed.issues.at(-1).code).toBe("answer_value_ambiguous");
    expect(result.rendered).not.toContain("North Street 1");
    expect(result.rendered).not.toContain("South Street 2");
  });

  it("does not duplicate an answer-bearing value already present in model output", async () => {
    const result = await answerCompletenessCase(
      "Where do I send my return?",
      "Send the return to:\nMerchant Returns\nReturn Street 10\n2000 Frederiksberg",
      [policyRecord("Send the return to:\nMerchant Returns\nReturn Street 10\n2000 Frederiksberg")],
    );

    expect(result.completed.approvedSegments[0].text).toBe("Send the return to:\nMerchant Returns\nReturn Street 10\n2000 Frederiksberg");
    expect(result.rendered.match(/Return Street 10/g)).toHaveLength(1);
  });
});

describe("evidence-aware fallback recovery", () => {
  it.each(["support_email", "support_inbox", "playground", "web_chat"])(
    "treats a support contact prerequisite as satisfied on %s",
    async (interactionChannel) => {
      const evidence = answerEvidenceRecord([policyRecord(
        "Contact us to request a return. Send the return with tracked shipping.",
      )]);
      const result = await recoveryCase("I would like to return my order.", [{
        type: "limitation",
        text: "I couldn't verify that policy detail from our current policy information.",
        basis: { result_id: evidence.resultId, field_paths: ["results"] },
      }], [evidence], {}, interactionChannel);

      expect(result.completed.allValid).toBe(true);
      expect(result.completed.completenessDiagnostics.recovery).toContainEqual({ type: "process", result: "recovered" });
      expect(result.rendered).toContain("Send the return with tracked shipping");
      expect(result.rendered).not.toMatch(/contact us/i);
    },
  );

  it.each([
    "Email support to request a return.",
    "Use the support form to request a return.",
    "Let us know you want to return.",
    "Submit a return request.",
  ])("recognizes a satisfied support-request variant: %s", async (policyText) => {
    const evidence = answerEvidenceRecord([policyRecord(policyText)]);
    const result = await recoveryCase("I would like to return my order.", [{
      type: "knowledge_guidance",
      text: policyText,
      basis: { result_id: evidence.resultId, field_paths: ["results"] },
    }], [evidence], {}, "web_chat");

    expect(result.completed.allValid).toBe(true);
    expect(result.completed.completenessDiagnostics.recovery).toContainEqual({ type: "process", result: "unavailable" });
    expect(result.rendered).toBe("");
  });

  it("keeps a content-bearing contact requirement unresolved", async () => {
    const evidence = answerEvidenceRecord([policyRecord("Email us a photo of the damage.")]);
    const result = await recoveryCase("My product is damaged. How do I get help?", [{
      type: "limitation",
      text: "I couldn't verify that policy detail from our current policy information.",
      basis: { result_id: evidence.resultId, field_paths: ["results"] },
    }], [evidence], {}, "playground");

    expect(result.completed.completenessDiagnostics.recovery).toContainEqual({ type: "process", result: "recovered" });
    expect(result.rendered).toContain("photo");
  });

  it("keeps a missing serial-number requirement unresolved", async () => {
    const evidence = answerEvidenceRecord([policyRecord("Provide your serial number.")]);
    const result = await recoveryCase("My product is damaged. How do I get help?", [{
      type: "limitation",
      text: "I couldn't verify that policy detail from our current policy information.",
      basis: { result_id: evidence.resultId, field_paths: ["results"] },
    }], [evidence], {}, "playground");

    expect(result.completed.completenessDiagnostics.recovery).toContainEqual({ type: "process", result: "recovered" });
    expect(result.rendered).toContain("serial number");
  });

  it("does not treat a merchant-side contact as a customer process step", async () => {
    const evidence = answerEvidenceRecord([policyRecord("We will contact you about deductions.")]);
    const result = await recoveryCase("I would like to return my order.", [{
      type: "knowledge_guidance",
      text: "The policy mentions possible deductions.",
      basis: { result_id: evidence.resultId, field_paths: ["results"] },
    }], [evidence], {}, "playground");

    expect(result.completed.allValid).toBe(true);
    expect(result.completed.completenessDiagnostics.recovery).toContainEqual({ type: "process", result: "unavailable" });
    expect(result.completed.issues).not.toContainEqual(expect.objectContaining({ code: "answer_value_ambiguous" }));
  });

  it("keeps contradictory customer process instructions ambiguous", async () => {
    const evidence = answerEvidenceRecord([
      policyRecord("Contact support before returning.", "Contact-first policy"),
      policyRecord("Do not contact support; send the item directly.", "Direct-send policy"),
    ]);
    const result = await recoveryCase("I would like to return my order.", [{
      type: "limitation",
      text: "I couldn't verify that policy detail from our current policy information.",
      basis: { result_id: evidence.resultId, field_paths: ["results"] },
    }], [evidence], {}, "playground");

    expect(result.completed.completenessDiagnostics.recovery).toContainEqual({ type: "process", result: "ambiguous" });
    expect(result.rendered).toContain("couldn't verify");
  });

  it("does not make the #1063 policy contact or merchant follow-up ambiguous", async () => {
    const evidence = answerEvidenceRecord([policyRecord(
      "If not, we will contact you concerning a further deduction from the refund. Please contact us via e-mail letting us know that you want to return.",
      "Refund policy",
    )]);
    const result = await recoveryCase(
      "Hi, I would like to return my order 1063 since I'm not happy with my product. How do I return it?",
      [{
        type: "knowledge_guidance",
        text: "Your return request is being reviewed.",
        basis: { result_id: evidence.resultId, field_paths: ["results"] },
      }],
      [evidence],
      {},
      "playground",
    );

    expect(result.completed.allValid).toBe(true);
    expect(result.completed.approvedSegments).toHaveLength(1);
    expect(result.completed.completenessDiagnostics.recovery).toContainEqual({ type: "process", result: "unavailable" });
    expect(result.completed.issues).not.toContainEqual(expect.objectContaining({ code: "answer_value_ambiguous" }));
  });

  it.each([
    ["P1 active", "You pay return shipping.", true],
    ["P2 passive", "Return shipping must be paid by you.", true],
    ["P3 borne", "Return postage is borne by the customer.", true],
    ["P4 prepaid", "We provide a prepaid return label.", true],
    ["P5 unrelated payment", "Your order has already been paid.", false],
  ])("extracts payer responsibility safely: %s", async (_name, policyText, shouldRecover) => {
    const evidence = answerEvidenceRecord([policyRecord(policyText)]);
    const result = await recoveryCase("Hvem betaler returfragten?", [{
      type: "limitation",
      text: "I couldn't verify that policy detail from our current policy information.",
      basis: { result_id: evidence.resultId, field_paths: ["results"] },
    }], [evidence]);

    expect(result.completed.completenessDiagnostics.recovery).toContainEqual({
      type: "cost",
      result: shouldRecover ? "recovered" : "unavailable",
    });
    if (shouldRecover) expect(result.rendered).not.toContain("couldn't verify");
    else expect(result.rendered).toContain("couldn't verify");
  });

  it("fails closed for conflicting payer responsibility", async () => {
    const evidence = answerEvidenceRecord([
      policyRecord("You pay return shipping.", "Customer-pays policy"),
      policyRecord("We pay return shipping.", "Merchant-pays policy"),
    ]);
    const result = await recoveryCase("Hvem betaler returfragten?", [{
      type: "limitation",
      text: "I couldn't verify that policy detail from our current policy information.",
      basis: { result_id: evidence.resultId, field_paths: ["results"] },
    }], [evidence]);

    expect(result.completed.completenessDiagnostics.recovery).toContainEqual({
      type: "cost",
      result: "ambiguous",
    });
    expect(result.rendered).toContain("couldn't verify");
  });

  it("exposes candidate-level diagnostics for timing propositions", () => {
    const [certified] = inspectTimingCandidateDiagnostics([
      "As soon as we have received and processed your return we will initiate the refund and you will be notified.",
    ]);

    expect(certified).toMatchObject({
      timing_pattern_detected: true,
      event_trigger_detected: true,
      duration_detected: false,
      explicit_date_detected: false,
      subject_outcome_detected: true,
      rejected: false,
      rejection_reason: [],
      certified_candidate: true,
      conflict_group: null,
    });
  });

  it.each([
    ["T1 event-triggered receipt and processing", "As soon as the return is received and processed, the refund is initiated.", true, true],
    ["T2 event-triggered receipt and inspection", "The refund is initiated once the return has been received and inspected.", true, true],
    ["T3 incomplete event and outcome", "After the return, the outcome follows.", false, true],
  ])("classifies timing candidates safely: %s", (_name, text, shouldCertify, shouldDetectEvent) => {
    const [candidate] = inspectTimingCandidateDiagnostics([text]);
    expect(candidate.certified_candidate).toBe(shouldCertify);
    expect(candidate.event_trigger_detected).toBe(shouldDetectEvent);
  });

  it("keeps compatible timing stages together", async () => {
    const result = await recoveryCase("When will I get my refund?", [{
      type: "limitation",
      text: "I couldn't verify that policy detail from our current policy information.",
      basis: { result_id: "answer-completeness-1", field_paths: ["results"] },
    }], [answerEvidenceRecord([policyRecord(
      "The refund is initiated after the return is received and processed. Your payment provider may take additional time to display the funds.",
    )])]);

    expect(result.completed.completenessDiagnostics.recovery).toContainEqual({
      type: "timing",
      result: "recovered",
    });
    expect(result.rendered).toContain("refund is initiated after the return is received and processed");
    expect(result.rendered).toContain("payment provider may take additional time");
  });

  it("fails closed for contradictory timing stages", async () => {
    const result = await recoveryCase("When will I get my refund?", [{
      type: "limitation",
      text: "I couldn't verify that policy detail from our current policy information.",
      basis: { result_id: "answer-completeness-1", field_paths: ["results"] },
    }], [answerEvidenceRecord([
      policyRecord("The refund is initiated within 5 business days.", "Five-day refund policy"),
      policyRecord("The refund is initiated within 30 business days.", "Thirty-day refund policy"),
    ])]);

    expect(result.completed.completenessDiagnostics.recovery).toContainEqual({
      type: "timing",
      result: "ambiguous",
    });
    expect(result.rendered).toContain("couldn't verify");
  });

  it("certifies the exact selected Refund-policy timing evidence", () => {
    const [candidate] = inspectTimingCandidateDiagnostics([
      "As soon as we have received and processed your return we will initiate the refund and you will be notified.",
    ]);

    expect(candidate.certified_candidate).toBe(true);
    expect(candidate.rejection_reason).toEqual([]);
  });

  it("distinguishes a certified timing candidate from policy-truth rejection", async () => {
    const result = await answerCompletenessCase(
      "Hvornår får jeg pengene tilbage?",
      "As soon as we have received and processed your return we will initiate the refund",
      [
        policyRecord(
          "Returns are accepted within 30 days. If the seal is broken, the refund may be reduced by EUR 50. As soon as we have received and processed your return we will initiate the refund and you will be notified.",
          "Current refund policy",
        ),
        policyRecord("Returns are not accepted.", "Conflicting return policy"),
      ],
    );

    expect(result.completed.completenessDiagnostics.timing_candidates.some((candidate) => candidate.certified_candidate)).toBe(true);
    expect(result.completed.issues.some((issue) => issue.code === "policy_truth_ambiguous")).toBe(true);
    expect(result.completed.completenessDiagnostics.recovery.some((entry) => entry.type === "timing")).toBe(true);
  });

  it("recovers a usable policy answer when the model emits a generic fallback", async () => {
    const evidence = answerEvidenceRecord([policyRecord("Your refund is initiated after the return is received and processed.")]);
    const result = await recoveryCase("When will I get my refund?", [{
      type: "limitation",
      text: "I couldn't verify that policy detail from our current policy information.",
      basis: { result_id: evidence.resultId, field_paths: ["results"] },
    }], [evidence]);

    expect(result.rendered).toContain("refund is initiated after the return is received and processed");
    expect(result.rendered).not.toContain("couldn't verify");
  });

  it("recovers the payer without re-inserting the rest of the policy", async () => {
    const evidence = answerEvidenceRecord([policyRecord("You arrange and pay for the return shipment.")]);
    const result = await recoveryCase("Who pays return shipping?", [{
      type: "limitation",
      text: "I couldn't verify that policy detail from our current policy information.",
      basis: { result_id: evidence.resultId, field_paths: ["results"] },
    }], [evidence]);

    expect(result.rendered).toContain("pay for the return shipment");
    expect(result.rendered).not.toContain("30 days");
  });

  it("recovers a general timing answer when the model asks for an unnecessary order number", async () => {
    const evidence = answerEvidenceRecord([policyRecord(
      "The refund is initiated after the return is received and processed. Your bank or payment provider may take additional time to display the funds.",
    )]);
    const result = await recoveryCase("When will I get my refund?", [{
      type: "question",
      purpose: "enable_capability",
      text: null,
      capability: "get_order",
      missing_arguments: ["order_id"],
    }], [evidence]);

    expect(result.completed.approvedSegments.filter((segment) => segment.type === "knowledge_guidance")).toHaveLength(1);
    expect(result.rendered).toContain("refund is initiated after the return is received and processed");
    expect(result.rendered).toContain("payment provider may take additional time");
    expect(result.rendered).not.toContain("order number");
  });

  it("does not let an approved clarification block timing recovery when the answer segment is rejected", async () => {
    const evidence = answerEvidenceRecord([policyRecord(
      "The refund is initiated after the return is received and processed.",
    )]);
    const result = await recoveryCase("When will I get my refund?", [
      {
        type: "question",
        purpose: "enable_capability",
        text: null,
        capability: "get_order",
        missing_arguments: ["order_id"],
      },
      {
        type: "knowledge_guidance",
        text: "The refund is initiated after the return is received and processed.",
        basis: { result_id: evidence.resultId, field_paths: ["results[0].missing"] },
      },
    ], [evidence]);

    expect(result.initial.approvedSegments).toHaveLength(1);
    expect(result.initial.approvedSegments[0].type).toBe("question");
    expect(result.completed.completenessDiagnostics).toMatchObject({
      intent_resolved_by_approved_segment: false,
    });
    expect(result.completed.completenessDiagnostics.recovery).toContainEqual({ type: "timing", result: "recovered" });
    expect(result.rendered).toContain("refund is initiated after the return is received and processed");
    expect(result.rendered).not.toContain("order number");
  });

  it("treats an approved payer clarification as non-answering when payer evidence is usable", async () => {
    const evidence = answerEvidenceRecord([policyRecord("The customer pays the return shipping.")]);
    const result = await recoveryCase("Who pays return shipping?", [{
      type: "question",
      purpose: "enable_capability",
      text: null,
      capability: "get_order",
      missing_arguments: ["order_id"],
    }], [evidence]);

    expect(result.completed.completenessDiagnostics).toMatchObject({
      intent_resolved_by_approved_segment: false,
    });
    expect(result.completed.completenessDiagnostics.recovery).toContainEqual({ type: "cost", result: "recovered" });
    expect(result.rendered).toContain("customer pays the return shipping");
    expect(result.rendered).not.toContain("order number");
  });

  it("keeps a customer-specific clarification when general policy cannot resolve the requested status", async () => {
    const evidence = answerEvidenceRecord([policyRecord("The refund is initiated after the return is received and processed.")]);
    const result = await recoveryCase("When was my refund processed for order #123?", [{
      type: "question",
      purpose: "enable_capability",
      text: null,
      capability: "get_order",
      missing_arguments: ["order_id"],
    }], [evidence]);

    expect(result.completed.completenessDiagnostics).toMatchObject({
      intent_resolved_by_approved_segment: false,
    });
    expect(result.completed.completenessDiagnostics.recovery).toContainEqual({ type: "timing", result: "skipped" });
    expect(result.completed.approvedSegments).toHaveLength(1);
    expect(result.completed.approvedSegments[0].type).toBe("question");
  });

  it("does not prefer fallback when an approved answer already resolves the intent", async () => {
    const evidence = answerEvidenceRecord([policyRecord("The refund is initiated after the return is received and processed.")]);
    const result = await recoveryCase("When will I get my refund?", [{
      type: "knowledge_guidance",
      text: "The refund is initiated after the return is received and processed.",
      basis: { result_id: evidence.resultId, field_paths: ["results"] },
    }, {
      type: "question",
      purpose: "enable_capability",
      text: null,
      capability: "get_order",
      missing_arguments: ["order_id"],
    }], [evidence]);

    expect(result.completed.completenessDiagnostics).toMatchObject({
      intent_resolved_by_approved_segment: true,
    });
    expect(shouldPreferAuthoritativeEvidenceFallback(result.completed, result.context)).toBe(false);
    expect(result.rendered).toContain("refund is initiated after the return is received and processed");
    expect(result.rendered).not.toContain("order number");
  });

  it("attempts recovery when every approved segment is a non-answer question", async () => {
    const evidence = answerEvidenceRecord([policyRecord("The customer pays the return shipping.")]);
    const result = await recoveryCase("Who pays return shipping?", [{
      type: "question",
      purpose: "pure_clarification",
      text: "Could you share more details?",
      capability: null,
      missing_arguments: [],
    }], [evidence]);

    expect(result.completed.completenessDiagnostics.recovery).toContainEqual({ type: "cost", result: "recovered" });
    expect(result.rendered).toContain("customer pays the return shipping");
  });

  it("allows clarification when policy evidence is ambiguous", async () => {
    const evidence = answerEvidenceRecord([
      policyRecord("The customer pays the return shipping.", "Customer payer policy"),
      policyRecord("The merchant pays the return shipping.", "Merchant payer policy"),
    ]);
    const result = await recoveryCase("Who pays return shipping?", [{
      type: "question",
      purpose: "pure_clarification",
      text: "Could you share more details?",
      capability: null,
      missing_arguments: [],
    }], [evidence]);

    expect(result.completed.completenessDiagnostics.recovery).toContainEqual({ type: "cost", result: "ambiguous" });
    expect(result.rendered).toContain("Could you share more details?");
    expect(result.rendered).not.toContain("customer pays");
    expect(result.rendered).not.toContain("merchant pays");
  });

  it("recovers event-trigger timing for a general Danish question", async () => {
    const evidence = answerEvidenceRecord([policyRecord(
      "As soon as your return is received and inspected, we will release the refund.",
    )]);
    const result = await recoveryCase("Hvornår får jeg pengene tilbage?", [{
      type: "question",
      purpose: "enable_capability",
      text: null,
      capability: "get_order",
      missing_arguments: ["order_id"],
    }], [evidence]);

    expect(result.completed.completenessDiagnostics.recovery).toContainEqual({ type: "timing", result: "recovered" });
    expect(result.rendered).toContain("release the refund");
    expect(result.rendered).not.toContain("order number");
  });

  it("recognizes an explicitly grounded refund date as timing evidence", async () => {
    const result = await recoveryCase("When will I get my refund?", [{
      type: "limitation",
      text: "I couldn't verify that policy detail from our current policy information.",
      basis: { result_id: "answer-completeness-1", field_paths: ["results"] },
    }], [answerEvidenceRecord([policyRecord("The refund will be issued on 16/09/2026.")])]);

    expect(result.completed.completenessDiagnostics.recovery).toContainEqual({ type: "timing", result: "recovered" });
    expect(result.rendered).toContain("issued on 16/09/2026");
  });

  it("recovers a payer answer when an SDK fallback has no structured output", async () => {
    const evidence = answerEvidenceRecord([policyRecord("The customer is responsible for return shipping costs.")]);
    const result = await invalidResponseRecoveryCase("Who pays return shipping?", [evidence]);

    expect(result.initial.schemaValid).toBe(false);
    expect(result.completed.schemaValid).toBe(false);
    expect(result.completed.approvedSegments).toHaveLength(1);
    expect(result.rendered).toContain("responsible for return shipping costs");
  });

  it("recovers a Danish payer answer when every model segment is rejected", async () => {
    const evidence = answerEvidenceRecord([policyRecord("The customer pays the return shipping.")]);
    const result = await recoveryCase("Hvem betaler returfragten?", [{
      type: "question",
      purpose: "enable_capability",
      text: null,
      capability: "not_a_real_capability",
      missing_arguments: ["unsupported"],
    }], [evidence]);

    expect(result.initial.approvedSegments).toEqual([]);
    expect(result.initial.rejectedSegments).toHaveLength(1);
    expect(result.completed.completenessDiagnostics.recovery).toContainEqual({ type: "cost", result: "recovered" });
    expect(result.rendered).toContain("customer pays the return shipping");
  });

  it("wires a resolvable payer question directly to payer recovery even without model cues", async () => {
    const evidence = answerEvidenceRecord([policyRecord("The customer pays the return shipping.")]);
    const result = await recoveryCase("Hvem betaler returfragten?", [], [evidence]);

    expect(result.completed.completenessDiagnostics.cues).toContain("cost");
    expect(result.completed.completenessDiagnostics.recovery).toContainEqual({ type: "cost", result: "recovered" });
    expect(result.rendered).toContain("customer pays the return shipping");
  });

  it("does not recover general policy timing for a customer-specific order status question", async () => {
    const evidence = answerEvidenceRecord([policyRecord("The refund is initiated after the return is received and processed.")]);
    const result = await recoveryCase("When was my refund processed for order #123?", [{
      type: "question",
      purpose: "enable_capability",
      text: null,
      capability: "get_order",
      missing_arguments: ["order_id"],
    }], [evidence]);

    expect(result.completed.approvedSegments).toHaveLength(1);
    expect(result.completed.approvedSegments[0].type).toBe("question");
    expect(result.rendered).not.toContain("refund is initiated");
  });

  it("fails closed when prose mentions refund timing without stating an answer", async () => {
    const evidence = answerEvidenceRecord([policyRecord("Refund timing depends on a case review and may vary.")]);
    const result = await recoveryCase("When will I get my refund?", [{
      type: "limitation",
      text: "I couldn't verify that policy detail from our current policy information.",
      basis: { result_id: evidence.resultId, field_paths: ["results"] },
    }], [evidence]);

    expect(result.completed.approvedSegments).toHaveLength(1);
    expect(result.rendered).toContain("couldn't verify");
    expect(result.rendered).not.toContain("depends on a case review");
  });

  it("recovers a compound eligibility and consequence proposition", async () => {
    const evidence = answerEvidenceRecord([policyRecord(
      "Returns are accepted within 30 days of delivery. If the seal is broken, the refund may be reduced by EUR 50.",
    )]);
    const result = await recoveryCase("Can I return an opened item?", [{
      type: "limitation",
      text: "I couldn't verify that policy detail from our current policy information.",
      basis: { result_id: evidence.resultId, field_paths: ["results"] },
    }], [evidence]);

    expect(result.rendered).toContain("Returns are accepted within 30 days of delivery");
    expect(result.rendered).toContain("refund may be reduced by EUR 50");
  });

  it("preserves an applicable procedure when the model says it was not found", async () => {
    const evidence = procedureEvidenceRecord();
    const result = await recoveryCase("My A-Blaze headset will not pair.", [{
      type: "limitation",
      text: "I couldn't verify a support procedure for this issue from our current guidance.",
      basis: { result_id: evidence.resultId, field_paths: ["results"] },
    }], [evidence], { product: "A-Blaze", issue: "My A-Blaze headset will not pair" });

    expect(result.rendered).toContain("Plug the USB-C dongle into the PC.");
    expect(result.rendered).toContain("wait for it to pair");
    expect(result.rendered).not.toContain("couldn't verify a support procedure");
  });

  it("leaves an ambiguous procedure request as a clarification", async () => {
    const evidence = procedureEvidenceRecord({ taskSpecificity: "insufficient", procedureEvidenceQuality: "insufficient" });
    const result = await recoveryCase("My headset is not working.", [{
      type: "question",
      purpose: "clarify_task",
      text: "What exactly is happening with the headset?",
      capability: null,
      missing_arguments: [],
    }], [evidence], { product: "A-Blaze", issue: "My headset is not working" });

    expect(result.rendered).toContain("What exactly is happening");
    expect(result.rendered).not.toContain("Plug the USB-C dongle");
  });

  it("reselects the final supported procedure intent using multi-turn context", async () => {
    const evidence = procedureEvidenceRecord();
    const result = await recoveryCase("I use the USB-C dongle on a PC.", [{
      type: "limitation",
      text: "I couldn't verify a support procedure for this issue from our current guidance.",
      basis: { result_id: evidence.resultId, field_paths: ["results"] },
    }], [evidence], {
      product: "A-Blaze",
      platform: "USB-C dongle + PC",
      issue: "My headset will not connect",
      attemptedSteps: ["I already reset it"],
    });

    expect(result.rendered).toContain("Plug the USB-C dongle into the PC.");
    expect(result.rendered).not.toContain("reset");
  });

  it("keeps the safe fallback when authoritative evidence is insufficient", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry(dependencies);
    const evidence = {
      resultId: "insufficient-policy-1",
      toolName: "search_policy",
      result: { status: "not_found", data: { results: [] } },
    };
    const context = {
      ...registry,
      customerMessage: "When will I get my refund?",
      getResult: (resultId) => resultId === evidence.resultId ? evidence : registry.getResult(resultId),
      getResults: () => [evidence],
    };
    const initial = validateStructuredResponse({ segments: [{
      type: "limitation",
      text: "I couldn't verify that policy detail.",
      basis: { result_id: evidence.resultId, field_paths: ["results"] },
    }] }, context);
    const completed = ensureAnswerCompleteness(initial, context);

    expect(completed.approvedSegments).toHaveLength(1);
    expect(renderResponseSegments(completed.approvedSegments, context)).toContain("couldn’t verify");
  });

  it("fails closed when authoritative answer values conflict", async () => {
    const evidence = answerEvidenceRecord([
      policyRecord("Send the return to:\nReturns North\nNorth Street 1\n1000 Copenhagen", "North policy"),
      policyRecord("Send the return to:\nReturns South\nSouth Street 2\n2000 Aarhus", "South policy"),
    ]);
    const result = await recoveryCase("Where do I send my return?", [{
      type: "limitation",
      text: "I couldn't verify that policy detail from our current policy information.",
      basis: { result_id: evidence.resultId, field_paths: ["results"] },
    }], [evidence]);

    expect(result.rendered).toContain("couldn't verify");
    expect(result.rendered).not.toContain("North Street 1");
    expect(result.rendered).not.toContain("South Street 2");
  });

  it("fails closed when authoritative payer evidence conflicts", async () => {
    const result = await recoveryCase("Hvem betaler returfragten?", [{
      type: "limitation",
      text: "I couldn't verify that policy detail from our current policy information.",
      basis: { result_id: "answer-completeness-1", field_paths: ["results"] },
    }], [answerEvidenceRecord([
      policyRecord("The customer pays the return shipping.", "Customer payer policy"),
      policyRecord("The merchant pays the return shipping.", "Merchant payer policy"),
    ])]);

    expect(result.completed.completenessDiagnostics.recovery).toContainEqual({ type: "cost", result: "ambiguous" });
    expect(result.rendered).toContain("couldn't verify");
    expect(result.rendered).not.toContain("customer pays");
    expect(result.rendered).not.toContain("merchant pays");
  });

  it("fails closed when authoritative timing values conflict", async () => {
    const result = await recoveryCase("When will I get my refund?", [{
      type: "limitation",
      text: "I couldn't verify that policy detail from our current policy information.",
      basis: { result_id: "answer-completeness-1", field_paths: ["results"] },
    }], [answerEvidenceRecord([
      policyRecord("The refund is issued within 5 business days.", "Five-day refund policy"),
      policyRecord("The refund is issued within 30 business days.", "Thirty-day refund policy"),
    ])]);

    expect(result.completed.completenessDiagnostics.recovery).toContainEqual({ type: "timing", result: "ambiguous" });
    expect(result.rendered).toContain("couldn't verify");
    expect(result.rendered).not.toContain("5 business days");
    expect(result.rendered).not.toContain("30 business days");
  });

  it("keeps compatible timing stages together as one recovered proposition", async () => {
    const result = await recoveryCase("When will I get my refund?", [{
      type: "limitation",
      text: "I couldn't verify that policy detail from our current policy information.",
      basis: { result_id: "answer-completeness-1", field_paths: ["results"] },
    }], [answerEvidenceRecord([policyRecord(
      "The refund is released after the return is received. The payment provider then displays the funds within 5 business days.",
    )])]);

    expect(result.completed.completenessDiagnostics.recovery).toContainEqual({ type: "timing", result: "recovered" });
    expect(result.rendered).toContain("return is received");
    expect(result.rendered).toContain("within 5 business days");
  });

  it("recovers only the current timing proposition from an otherwise broad policy", async () => {
    const result = await recoveryCase("When will I get my refund?", [{
      type: "limitation",
      text: "I couldn't verify that policy detail from our current policy information.",
      basis: { result_id: "answer-completeness-1", field_paths: ["results"] },
    }], [answerEvidenceRecord([policyRecord(
      "Returns are accepted within 30 days. Opened products may incur a EUR 50 deduction. The customer pays return shipping. The refund is initiated after the return is received and processed.",
    )])]);

    expect(result.rendered).toContain("refund is initiated after the return is received and processed");
    expect(result.rendered).not.toContain("30 days");
    expect(result.rendered).not.toContain("EUR 50");
    expect(result.rendered).not.toContain("return shipping");
  });

  it("does not duplicate a complete model answer", async () => {
    const evidence = answerEvidenceRecord([policyRecord("Your refund is initiated after the return is received and processed.")]);
    const result = await recoveryCase("When will I get my refund?", [{
      type: "knowledge_guidance",
      text: "Your refund is initiated after the return is received and processed.",
      basis: { result_id: evidence.resultId, field_paths: ["results"] },
    }], [evidence]);

    expect(result.rendered.match(/refund is initiated/gi)).toHaveLength(1);
  });
});

describe("policy truth safeguards", () => {
  it("does not let a prohibition override an authoritative allowed outcome", async () => {
    const result = await policyTruthCase(
      "Can I return this item?",
      "Returns are not accepted.",
      [policyRecord("Returns are accepted.", "Allowed return policy", {
        policy_truth: { eligibility: "allowed", source_text: "Returns are accepted." },
      })],
    );

    expect(result.result.allValid).toBe(true);
    expect(result.rendered).toContain("Returns are accepted.");
    expect(result.rendered).not.toMatch(/not accepted/i);
  });

  it("fails closed instead of rewriting from incomplete prose policy evidence", async () => {
    const result = await policyTruthCase(
      "Can I return this item?",
      "Returns are not accepted.",
      [policyRecord("Returns may be accepted depending on the item.")],
    );

    expect(result.result.allValid).toBe(false);
    expect(result.result.approvedSegments).toEqual([]);
    expect(result.result.issues.at(-1).code).toBe("policy_truth_ambiguous");
    expect(result.rendered).toBe("");
  });

  it("preserves a conditional return allowance and its deduction when the model says the return is rejected", async () => {
    const result = await policyTruthCase(
      "Can I return this item?",
      "The return is rejected.",
      [policyRecord("Returns may still be accepted, but a EUR 50 deduction applies when the item is returned in acceptable condition.")],
    );

    expect(result.result.allValid).toBe(true);
    expect(result.rendered).toContain("may still be accepted");
    expect(result.rendered).toContain("EUR 50");
    expect(result.rendered).not.toMatch(/rejected/i);
  });

  it("does not turn an opened-item deduction into an absolute return prohibition", async () => {
    const result = await policyTruthCase(
      "Can I return an opened item?",
      "Opened items cannot be returned.",
      [policyRecord("If the product has been opened, the return may still be accepted but a EUR 50 deduction applies when it is returned in mint condition.")],
    );

    expect(result.result.allValid).toBe(true);
    expect(result.rendered).toContain("may still be accepted");
    expect(result.rendered).toContain("EUR 50");
    expect(result.rendered).not.toMatch(/cannot be returned/i);
  });

  it("preserves an actual prohibition when the model says the item is returnable", async () => {
    const result = await policyTruthCase(
      "Can I return a final-sale item?",
      "Yes, you can return the final-sale item.",
      [policyRecord("Final-sale items are not eligible for return.")],
    );

    expect(result.result.allValid).toBe(true);
    expect(result.rendered).toContain("not eligible for return");
    expect(result.rendered).not.toMatch(/Yes, you can return/i);
  });

  it("keeps a proof-of-purchase condition instead of overstating warranty coverage", async () => {
    const result = await policyTruthCase(
      "Is my warranty claim covered?",
      "Your warranty covers this issue.",
      [policyRecord("Warranty coverage is available only with proof of purchase.", "Warranty policy", {
        policy_truth: {
          eligibility: "allowed",
          condition: "proof of purchase",
          consequence: "coverage requires proof of purchase",
          source_text: "Warranty coverage is available only with proof of purchase.",
        },
      })],
    );

    expect(result.result.allValid).toBe(true);
    expect(result.rendered).toContain("only with proof of purchase");
    expect(result.rendered).not.toBe("Your warranty covers this issue.");
  });

  it("keeps a shipping restriction instead of accepting an overgeneralized worldwide claim", async () => {
    const result = await policyTruthCase(
      "Do you ship to my country?",
      "We ship worldwide.",
      [policyRecord("We ship to supported destinations except restricted regions.")],
    );

    expect(result.result.allValid).toBe(true);
    expect(result.rendered).toContain("except restricted regions");
    expect(result.rendered).not.toBe("We ship worldwide.");
  });

  it("withholds a response when authoritative policy conditions conflict", async () => {
    const result = await policyTruthCase(
      "Can I return this item?",
      "Yes, you can return it.",
      [
        policyRecord("Returns are allowed for eligible items.", "Current eligible-item policy", {
          policy_truth: { eligibility: "allowed", source_text: "Returns are allowed for eligible items." },
        }),
        policyRecord("Returns are not allowed for final-sale items.", "Current final-sale policy", {
          policy_truth: { eligibility: "disallowed", source_text: "Returns are not allowed for final-sale items." },
        }),
      ],
    );

    expect(result.result.allValid).toBe(false);
    expect(result.result.approvedSegments).toEqual([]);
    expect(result.result.issues.at(-1).code).toBe("policy_truth_ambiguous");
    expect(result.rendered).toBe("");
  });

  it("uses current authoritative policy over a conflicting historical example", async () => {
    const historical = policyRecord("A previous customer was told the item could be returned.", "Historical support example");
    historical.authority = "reference";
    historical.provenance = { source_kind: "historical_support", source_id: historical.title };
    const result = await policyTruthCase(
      "Can I return this final-sale item?",
      "Yes, the item can be returned.",
      [
        policyRecord("Current policy: final-sale items are not eligible for return.", "Current return policy"),
        historical,
      ],
      ["results[0]"],
    );

    expect(result.result.allValid).toBe(true);
    expect(result.rendered).toContain("not eligible for return");
    expect(result.rendered).not.toMatch(/can be returned/i);
  });

  it.each([
    ["English", "Can I return an opened item?", "Opened items cannot be returned.", "If the product has been opened, the return may still be accepted but a EUR 50 deduction applies when it is returned in mint condition.", /may still be accepted/i],
    ["Danish", "Kan jeg returnere en åbnet vare?", "Hvis emballagen er åbnet, kan returneringen afvises.", "Hvis produktet er åbnet, kan returneringen stadig accepteres, men ved mint stand fratrækkes 50 EUR.", /stadig accepteres/i],
    ["German", "Kann ich einen geöffneten Artikel zurückgeben?", "Wenn die Verpackung geöffnet ist, kann die Rückgabe abgelehnt werden.", "Wenn das Produkt geöffnet wurde, kann die Rückgabe weiterhin akzeptiert werden, aber bei einwandfreiem Zustand fällt ein Abzug von 50 EUR an.", /weiterhin akzeptiert/i],
  ])("corrects the conditional opened-return interpretation in %s", async (_language, customerMessage, modelText, sourceText, expectedAllowance) => {
    const result = await policyTruthCase(
      customerMessage,
      modelText,
      [policyRecord(sourceText)],
    );

    expect(result.result.allValid).toBe(true);
    expect(result.rendered).toMatch(expectedAllowance);
    expect(result.rendered).toMatch(/50\s*EUR|EUR\s*50/i);
    expect(result.rendered).not.toMatch(/cannot be returned|afvises|abgelehnt/i);
  });
});
