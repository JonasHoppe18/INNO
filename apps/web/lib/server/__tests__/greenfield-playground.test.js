import { describe, expect, it } from "vitest";
import {
  historyFromPlaygroundRows,
  isInternalGreenfieldPlaygroundUser,
  isGreenfieldPlaygroundEnabled,
  isGreenfieldPlaygroundFreeformEnabled,
  isGreenfieldPlaygroundTicketRequired,
  isOwnedPlaygroundSession,
  normalizePlaygroundContext,
  normalizePlaygroundCustomerEmail,
  normalizePlaygroundMessage,
  sanitizeGreenfieldTrace,
} from "../greenfield-playground.js";

describe("greenfield playground boundary", () => {
  it("A: is disabled in production", () => {
    expect(isGreenfieldPlaygroundEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(isGreenfieldPlaygroundEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(isGreenfieldPlaygroundEnabled({
      NODE_ENV: "production",
      GREENFIELD_PLAYGROUND_ENABLED: "true",
      GREENFIELD_PLAYGROUND_ENVIRONMENT: "production",
      GREENFIELD_PLAYGROUND_SUPABASE_PROJECT_REF: "prodref",
      NEXT_PUBLIC_SUPABASE_URL: "https://prodref.supabase.co",
    })).toBe(true);
    expect(isGreenfieldPlaygroundEnabled({
      NODE_ENV: "production",
      GREENFIELD_PLAYGROUND_ENABLED: "true",
      GREENFIELD_PLAYGROUND_ENVIRONMENT: "production",
      GREENFIELD_PLAYGROUND_SUPABASE_PROJECT_REF: "prodref",
      NEXT_PUBLIC_SUPABASE_URL: "https://dev-ref.supabase.co",
    })).toBe(false);
  });

  it("A1: allows free-form only for the explicitly authorized development project", () => {
    expect(isGreenfieldPlaygroundFreeformEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(isGreenfieldPlaygroundFreeformEnabled({
      NODE_ENV: "production",
      GREENFIELD_PLAYGROUND_ALLOW_FREEFORM: "true",
      GREENFIELD_PLAYGROUND_SUPABASE_PROJECT_REF: "zxaoycxzdjrbnzvbullk",
      NEXT_PUBLIC_SUPABASE_URL: "https://zxaoycxzdjrbnzvbullk.supabase.co",
    })).toBe(true);
    expect(isGreenfieldPlaygroundTicketRequired({
      NODE_ENV: "production",
      GREENFIELD_PLAYGROUND_ALLOW_FREEFORM: "true",
      GREENFIELD_PLAYGROUND_SUPABASE_PROJECT_REF: "prodref",
      NEXT_PUBLIC_SUPABASE_URL: "https://prodref.supabase.co",
    })).toBe(true);
    expect(isGreenfieldPlaygroundTicketRequired({
      NODE_ENV: "production",
      GREENFIELD_PLAYGROUND_ALLOW_FREEFORM: "true",
      GREENFIELD_PLAYGROUND_SUPABASE_PROJECT_REF: "zxaoycxzdjrbnzvbullk",
      NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co",
    })).toBe(true);
  });

  it("A2: limits access to workspace administrators", async () => {
    const serviceClient = { from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { role: "org:admin" }, error: null }) }),
        }),
      }),
    }) };
    await expect(isInternalGreenfieldPlaygroundUser(serviceClient, { workspaceId: "workspace-a", clerkUserId: "user-a" })).resolves.toBe(true);
  });

  it("B/C: requires both the current workspace and current user", () => {
    const session = { workspace_id: "workspace-a", owner_clerk_user_id: "user-a" };
    expect(isOwnedPlaygroundSession(session, { workspaceId: "workspace-a", clerkUserId: "user-a" })).toBe(true);
    expect(isOwnedPlaygroundSession(session, { workspaceId: "workspace-b", clerkUserId: "user-a" })).toBe(false);
    expect(isOwnedPlaygroundSession(session, { workspaceId: "workspace-a", clerkUserId: "user-b" })).toBe(false);
    expect(isOwnedPlaygroundSession(session, {})).toBe(false);
  });

  it("D: validates input without introducing normal mail writes", () => {
    expect(normalizePlaygroundMessage("  Where is my order?  ").value).toBe("Where is my order?");
    expect(normalizePlaygroundMessage("").error).toBe("message is required.");
    expect(normalizePlaygroundMessage("x".repeat(12_001)).error).toBe("message is too long.");
    expect(normalizePlaygroundCustomerEmail("customer@example.test").value).toBe("customer@example.test");
    expect(normalizePlaygroundCustomerEmail("not-an-email").error).toBeTruthy();
  });

  it("E/F: keeps compact context and bounded server history across turns", () => {
    const context = normalizePlaygroundContext({
      turn: 4,
      activeOrder: {
        requestedOrderId: "1055",
        state: "verified",
        order: { orderNumber: "1055", items: [{ title: "secretly-large-payload" }] },
      },
      customerSignal: null,
    });
    expect(context).toEqual({
      turn: 4,
      activeOrder: { requestedOrderId: "1055", state: "verified", order: null },
      customerSignal: null,
    });
    expect(historyFromPlaygroundRows([
      { role: "system", content: "must not enter model history" },
      ...Array.from({ length: 25 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: String(index) })),
    ])).toHaveLength(20);
    expect(historyFromPlaygroundRows([{ role: "system", content: "not allowed" }])).toEqual([]);
    expect(historyFromPlaygroundRows([
      { role: "user", content: "customer question" },
      { role: "assistant", content: "previous response", trace_json: { comparison_only: true } },
    ])).toEqual([{ role: "user", content: "customer question" }]);
  });

  it("G: describes read-only provider results without exposing credentials", () => {
    const sanitized = sanitizeGreenfieldTrace(
      {
        traceId: "trace-1",
        startedAt: "2026-09-06T10:00:00.000Z",
        finishedAt: "2026-09-06T10:00:00.125Z",
        tools: [
          { name: "get_order", sensitivity: "read_only" },
          { name: "get_tracking", sensitivity: "read_only" },
        ],
        events: [
          { type: "tool_call", at: "2026-09-06T10:00:00.010Z", data: { name: "get_order", call_id: "call-1", arguments: { order_id: "1055", access_token: "secret-token" } } },
          { type: "tool_result", at: "2026-09-06T10:00:00.050Z", data: { name: "get_order", duration_ms: 40, result: { resultId: "result-1", status: "ok", data: { order_focus: { state: "verified", requested_order_id: "1055", verified_order_number: "1055" }, provider: "shopify_read_only" } } } },
          { type: "tool_result", at: "2026-09-06T10:00:00.090Z", data: { name: "get_tracking", duration_ms: 40, result: { status: "proposed", proposedAction: { action: "create_refund" } } } },
        ],
      },
      {
        contextBefore: { turn: 1, activeOrder: null, customerSignal: null },
        contextAfter: { turn: 2, activeOrder: { requestedOrderId: "1055", state: "verified", order: { orderNumber: "1055" } }, customerSignal: null },
      },
    );
    const text = JSON.stringify(sanitized);
    expect(text).not.toContain("secret-token");
    expect(sanitized.order_focus).toMatchObject({ requested_order_id: "1055", state: "verified" });
    expect(sanitized.provider_results).toContainEqual(expect.objectContaining({ tool: "get_order", provider: "shopify_read_only" }));
    expect(sanitized.proposed_actions).toContainEqual({ action: "create_refund", status: "proposed", executed: false });
    expect(text).not.toContain("mail_threads");
    expect(text).not.toContain("mail_messages");
  });

  it("H/I: keeps proposed actions visibly unexecuted and emits only bounded trace events", () => {
    const sanitized = sanitizeGreenfieldTrace({
      traceId: "trace-2",
      tools: [{ name: "update_address", sensitivity: "proposed_action" }],
      events: [{ type: "final_response", at: "now", data: { validation: { valid: true, approvedSegments: 1, rejectedSegments: 0 }, proposed_actions: [{ action: "update_address" }] } }],
    });
    expect(sanitized.proposed_actions).toEqual([]);
    expect(sanitized.events[0].validation).toEqual({ approved_segments: 1, rejected_segments: 0, valid: true });
    expect(sanitized.events[0]).not.toHaveProperty("response");
    expect(sanitized.tools).toEqual([{ name: "update_address", sensitivity: "proposed_action" }]);
  });

  it("J: exposes dry-run action details without exposing execution or credentials", () => {
    const sanitized = sanitizeGreenfieldTrace({
      traceId: "trace-action",
      tools: [{ name: "cancel_order", sensitivity: "proposed_action" }],
      events: [{
        type: "action_execution",
        at: "now",
        data: {
          action: "cancel_order",
          target: { order_id: "1055" },
          arguments: { order_id: "1055", reason: "Customer request", access_token: "secret-token" },
          validation_status: "validated",
          execution_status: "dry_run_success",
          would_execute: true,
          executed: false,
          validation_checks: [{ name: "verified_order", status: "passed", detail: "The order is verified." }],
          reason: "Playground simulation only.",
        },
      }],
    });

    expect(sanitized.simulated_actions).toHaveLength(1);
    expect(sanitized.simulated_actions[0]).toMatchObject({
      mode: "dry_run",
      action: "cancel_order",
      execution_status: "dry_run_success",
      would_execute: true,
      executed: false,
    });
    expect(JSON.stringify(sanitized)).not.toContain("secret-token");
  });

  it("K: preserves explicit order correction extraction used by the one-agent runtime", async () => {
    const { extractOrderReferences } = await import("../../greenfield-support/capabilities.ts");
    expect(extractOrderReferences("Sorry, I meant order 1055.")).toEqual(["1055"]);
  });
});
