import { describe, expect, it } from "vitest";
import { createCapabilityRegistry } from "../capabilities";
import { PlaygroundDryRunExecutor, validateActionProposal } from "../action-executor";
import { createDemoDependencies } from "../demo-fixtures";

function proposal(action, argumentsValue) {
  return {
    action,
    arguments: argumentsValue,
    reason: argumentsValue.reason,
    requiresConfirmation: true,
    status: "proposed",
  };
}

async function verifiedContext(orderId = "10232") {
  const dependencies = await createDemoDependencies();
  const registry = createCapabilityRegistry(dependencies);
  const order = await registry.execute("get_order", JSON.stringify({ order_id: orderId }));
  expect(order.status).toBe("ok");
  return {
    dependencies,
    registry,
    context: {
      tenant: dependencies.tenant,
      manifest: registry.manifest,
      activeOrder: registry.getActiveOrderFocus(),
      verifiedWorkspaceId: dependencies.tenant.workspaceId,
    },
  };
}

describe("greenfield action executor boundary", () => {
  it("A/B: simulates a validated action without executing or contacting a provider", async () => {
    const { context } = await verifiedContext();
    const executor = new PlaygroundDryRunExecutor();
    const result = await executor.execute(
      proposal("cancel_order", { order_id: "10232", reason: "Customer changed their mind" }),
      context,
    );

    expect(result).toMatchObject({
      mode: "dry_run",
      action: "cancel_order",
      target: { order_id: "10232" },
      proposal_status: "proposed",
      validation_status: "validated",
      execution_status: "dry_run_success",
      would_execute: true,
      executed: false,
    });
    expect(result.reason).toContain("No provider mutation was attempted");
  });

  it("C: blocks an action for an unverified or different customer order", async () => {
    const { context } = await verifiedContext("10232");
    const result = await new PlaygroundDryRunExecutor().execute(
      proposal("cancel_order", { order_id: "9999", reason: "Customer changed their mind" }),
      context,
    );

    expect(result.execution_status).toBe("blocked");
    expect(result.executed).toBe(false);
    expect(result.validation_checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "order_scope", status: "failed" }),
    ]));
  });

  it("D: blocks a cross-workspace action at the executor boundary", async () => {
    const { context } = await verifiedContext();
    const result = await new PlaygroundDryRunExecutor().execute(
      proposal("cancel_order", { order_id: "10232", reason: "Customer changed their mind" }),
      { ...context, verifiedWorkspaceId: "another-workspace" },
    );

    expect(result.validation_status).toBe("blocked");
    expect(result.would_execute).toBe(false);
    expect(result.validation_checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "workspace_scope", status: "failed" }),
    ]));
  });

  it("E/F/G: ignores client credentials and cannot be forced into live mode", async () => {
    const { context } = await verifiedContext();
    const result = await new PlaygroundDryRunExecutor().execute(
      proposal("cancel_order", { order_id: "10232", reason: "Customer changed their mind", access_token: "client-secret" }),
      context,
    );

    expect(result.mode).toBe("dry_run");
    expect(result.executed).toBe(false);
    expect(result.execution_status).toBe("blocked");
    expect(JSON.stringify(result)).not.toContain("client-secret");
  });

  it("H: an unsupported capability cannot become a validated proposal", async () => {
    const { context } = await verifiedContext();
    const unsupported = proposal("hold_order", { order_id: "10232", reason: "Customer is away" });
    const validation = validateActionProposal(unsupported, context);
    const result = await new PlaygroundDryRunExecutor().execute(unsupported, context);

    expect(context.manifest.proposalOnlyTools).not.toContain("hold_order");
    expect(validation.valid).toBe(false);
    expect(result.execution_status).toBe("blocked");
  });

  it("requires action-specific details represented by the existing schemas", async () => {
    const { context } = await verifiedContext();
    const result = await new PlaygroundDryRunExecutor().execute(
      proposal("update_address", { order_id: "10232", address: "", reason: "Customer moved" }),
      context,
    );

    expect(result.execution_status).toBe("blocked");
    expect(result.validation_checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "address_details", status: "failed" }),
    ]));
  });
});
