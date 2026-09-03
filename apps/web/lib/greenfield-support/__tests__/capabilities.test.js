import { describe, expect, it } from "vitest";
import { createCapabilityRegistry } from "../capabilities";
import { createDemoDependencies } from "../demo-fixtures";
import { GREENFIELD_TOOL_DEFINITIONS } from "../tool-contracts";

describe("greenfield capabilities", () => {
  it("exposes strict schemas without model-controlled tenant scope", () => {
    for (const tool of GREENFIELD_TOOL_DEFINITIONS) {
      expect(tool.strict).toBe(true);
      expect(tool.parameters.additionalProperties).toBe(false);
      expect(tool.parameters.properties).not.toHaveProperty("tenant_id");
      expect(tool.parameters.properties).not.toHaveProperty("workspace_id");
      expect(tool.parameters.properties).not.toHaveProperty("shop_id");
    }
  });

  it("rejects tenant escape arguments", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({ ...dependencies, tenant: dependencies.tenant });
    const result = await registry.execute("get_order", JSON.stringify({ order_id: "10231", workspace_id: "other-tenant" }));
    expect(result.status).toBe("invalid_arguments");
    expect(result.error.code).toBe("trusted_context_argument");
  });

  it("returns proposal-only results for sensitive actions", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({ ...dependencies, tenant: dependencies.tenant });
    const result = await registry.execute("cancel_order", JSON.stringify({ order_id: "10232", reason: "Customer changed their mind" }));
    expect(result.status).toBe("proposed");
    expect(result.proposedAction).toMatchObject({ action: "cancel_order", requiresConfirmation: true, status: "proposed" });
  });

  it("fails closed for live order data without verified customer identity", async () => {
    const dependencies = await createDemoDependencies();
    const registry = createCapabilityRegistry({
      ...dependencies,
      tenant: { workspaceId: dependencies.tenant.workspaceId, shopId: dependencies.tenant.shopId },
    });
    const result = await registry.execute("get_order", JSON.stringify({ order_id: "10231" }));
    expect(result).toMatchObject({ status: "missing_context", error: { code: "customer_identity_missing" } });
  });
});
