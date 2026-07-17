import { describe, it, expect } from "vitest";
import en from "../../../messages/en.json";
import da from "../../../messages/da.json";
import {
  INTEGRATIONS,
  INTEGRATION_STATUSES,
  integrationsByStatus,
  integrationBodyKey,
} from "../integrations";

describe("landing integrations", () => {
  it("only uses known statuses", () => {
    for (const integration of INTEGRATIONS) {
      expect(INTEGRATION_STATUSES, `${integration.id} has an unknown status`).toContain(
        integration.status
      );
    }
  });

  it("has a unique id for every entry", () => {
    const ids = INTEGRATIONS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("splits into available and roadmap", () => {
    expect(integrationsByStatus("available").map((i) => i.id)).toEqual([
      "shopify",
      "email",
      "zendesk",
    ]);
    expect(integrationsByStatus("roadmap").map((i) => i.id)).toEqual(["woocommerce", "magento"]);
  });

  // Guards the accuracy of what we advertise: per CLAUDE.md the Gmail/Outlook
  // pollers are legacy and not in use, so they must not appear as integrations.
  it("does not advertise the legacy Gmail/Outlook pollers", () => {
    const names = INTEGRATIONS.map((i) => i.name.toLowerCase());
    expect(names).not.toContain("gmail");
    expect(names).not.toContain("outlook");
  });

  it("has a description key in both locales for every integration", () => {
    for (const integration of INTEGRATIONS) {
      const key = integrationBodyKey(integration);
      expect(en.landing.integrationsPage, `en is missing ${key}`).toHaveProperty(key);
      expect(da.landing.integrationsPage, `da is missing ${key}`).toHaveProperty(key);
    }
  });
});
