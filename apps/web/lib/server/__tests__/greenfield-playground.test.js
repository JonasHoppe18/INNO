import { describe, expect, it } from "vitest";
import {
  historyFromPlaygroundRows,
  isInternalGreenfieldPlaygroundUser,
  isGreenfieldPlaygroundEnabled,
  isGreenfieldPlaygroundDevDiagnosticsEnabled,
  isGreenfieldPlaygroundFreeformEnabled,
  isGreenfieldPlaygroundTicketRequired,
  isOwnedPlaygroundSession,
  normalizePlaygroundContext,
  normalizePlaygroundCustomerEmail,
  normalizePlaygroundMessage,
  greenfieldPlaygroundRuntimeRevision,
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

  it("keeps only safe order labels when a customer must choose from history", () => {
    const context = normalizePlaygroundContext({
      turn: 2,
      activeOrder: null,
      customerSignal: null,
      orderCandidates: [
        { orderNumber: "1054", itemTitles: ["Chaos Headset 4"], createdAt: "2026-09-01T00:00:00.000Z" },
        { orderNumber: "1055", itemTitles: ["Chaos Mic 6"], createdAt: "2026-09-02T00:00:00.000Z" },
      ],
    });

    expect(context).toEqual({
      turn: 2,
      activeOrder: null,
      customerSignal: null,
      orderCandidates: [
        { orderNumber: "1054", itemTitles: ["Chaos Headset 4"], createdAt: "2026-09-01T00:00:00.000Z" },
        { orderNumber: "1055", itemTitles: ["Chaos Mic 6"], createdAt: "2026-09-02T00:00:00.000Z" },
      ],
    });
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

  it("maps snake_case validation summaries and keeps DEV diagnostics bounded", () => {
    const devEnv = {
      NODE_ENV: "production",
      GREENFIELD_PLAYGROUND_ENABLED: "true",
      GREENFIELD_PLAYGROUND_ENVIRONMENT: "production",
      GREENFIELD_DEPLOYMENT_ENV: "development",
      GREENFIELD_PLAYGROUND_SUPABASE_PROJECT_REF: "zxaoycxzdjrbnzvbullk",
      NEXT_PUBLIC_SUPABASE_URL: "https://zxaoycxzdjrbnzvbullk.supabase.co",
      GREENFIELD_RUNTIME_REVISION: "8f6e1270443274f3b7341f1e8e72e5066e172abc",
    };
    const sanitized = sanitizeGreenfieldTrace({
      traceId: "trace-diagnostics",
      events: [{
        type: "final_response",
        at: "now",
        data: {
          validation: {
            schema_valid: true,
            all_valid: true,
            approved_count: 1,
            rejected_segments: [],
            completeness: {
              entered: true,
              cues: ["timing"],
              recovery: [{ type: "timing", result: "recovered" }],
            },
          },
        },
      }],
      diagnostics: {
        question_shape: "timing",
        selected_source_ids: ["shopify:refund-policy"],
        selected_evidence_section_ids: ["refund:section:3:0"],
        provider_status: { search_policy: "ok" },
        validation: {
          schema_valid: true,
          all_valid: true,
          approved_count: 1,
          rejected_segments: [],
          completeness: { entered: true, cues: ["timing"], recovery: [{ type: "timing", result: "recovered" }] },
        },
        model_output: {
          structured_parse_failed: false,
          knowledge_guidance_exists: true,
          knowledge_guidance_has_answer_text: false,
          knowledge_guidance_basis_refs: 1,
          clarification_requested: false,
          fallback_like_content: true,
          segment_count: 1,
          response_mode: "fallback",
        },
        model_response_mode: "fallback",
        completeness_check_entered: true,
        resolvable_intent: true,
        recovery_attempted: true,
        recovery_type: ["timing"],
        recovery_result: "recovered",
        recovery_details: [{ type: "timing", result: "recovered" }],
        fallback_reason: null,
        final_composition_source: "recovered_evidence",
      },
    }, { env: devEnv });

    expect(sanitized.runtime_revision).toBe(devEnv.GREENFIELD_RUNTIME_REVISION);
    expect(sanitized.diagnostics).toMatchObject({
      question_shape: "timing",
      selected_source_ids: ["shopify:refund-policy"],
      selected_evidence_section_ids: ["refund:section:3:0"],
      completeness_check_entered: true,
      recovery_result: "recovered",
      final_composition_source: "recovered_evidence",
    });
    expect(sanitized.events[0].validation).toEqual({
      approved_segments: 1,
      rejected_segments: 0,
      valid: true,
      completeness: {
        entered: true,
        cues: ["timing"],
        recovery: [{ type: "timing", result: "recovered" }],
      },
    });
  });

  it.each([
    ["A model answers directly", { model_response_mode: "answered", recovery_result: "skipped", final_composition_source: "model" }],
    ["B model fallback recovers", { model_response_mode: "fallback", recovery_result: "recovered", final_composition_source: "recovered_evidence" }],
    ["C clarification has resolvable evidence", { model_response_mode: "clarification", resolvable_intent: true, final_composition_source: "model" }],
    ["D ambiguous evidence", { model_response_mode: "fallback", recovery_result: "ambiguous", final_composition_source: "fallback" }],
    ["E structured parse failure", { model_response_mode: "fallback", fallback_reason: "structured_parse_failed" }],
    ["F customer-specific recovery skipped", { recovery_result: "skipped", recovery_type: ["timing"], final_composition_source: "fallback" }],
  ])("reports diagnostics for %s", (_label, expected) => {
    const sanitized = sanitizeGreenfieldTrace({
      traceId: "trace-case",
      diagnostics: {
        question_shape: "timing",
        provider_status: { search_policy: "ok" },
        model_response_mode: "fallback",
        completeness_check_entered: true,
        resolvable_intent: false,
        recovery_attempted: true,
        recovery_type: ["timing"],
        recovery_result: "unavailable",
        fallback_reason: "no_approved_segments",
        final_composition_source: "fallback",
        model_output: { response_mode: "fallback", structured_parse_failed: false },
        ...expected,
      },
    }, {
      env: {
        NODE_ENV: "production",
        GREENFIELD_PLAYGROUND_ENABLED: "true",
        GREENFIELD_PLAYGROUND_ENVIRONMENT: "production",
        GREENFIELD_DEPLOYMENT_ENV: "development",
        GREENFIELD_PLAYGROUND_SUPABASE_PROJECT_REF: "zxaoycxzdjrbnzvbullk",
        NEXT_PUBLIC_SUPABASE_URL: "https://zxaoycxzdjrbnzvbullk.supabase.co",
      },
    });
    expect(sanitized.diagnostics).toMatchObject(expected);
  });

  it.each([
    ["A: production-style DEV", {
      NODE_ENV: "production",
      GREENFIELD_PLAYGROUND_ENABLED: "true",
      GREENFIELD_PLAYGROUND_ENVIRONMENT: "production",
      GREENFIELD_DEPLOYMENT_ENV: "development",
      GREENFIELD_PLAYGROUND_SUPABASE_PROJECT_REF: "zxaoycxzdjrbnzvbullk",
      NEXT_PUBLIC_SUPABASE_URL: "https://zxaoycxzdjrbnzvbullk.supabase.co",
    }, true],
    ["B: production deployment identity", {
      NODE_ENV: "production",
      GREENFIELD_PLAYGROUND_ENABLED: "true",
      GREENFIELD_PLAYGROUND_ENVIRONMENT: "production",
      GREENFIELD_DEPLOYMENT_ENV: "production",
      GREENFIELD_PLAYGROUND_SUPABASE_PROJECT_REF: "zxaoycxzdjrbnzvbullk",
      NEXT_PUBLIC_SUPABASE_URL: "https://zxaoycxzdjrbnzvbullk.supabase.co",
    }, false],
    ["C: missing deployment identity", {
      NODE_ENV: "production",
      GREENFIELD_PLAYGROUND_ENABLED: "true",
      GREENFIELD_PLAYGROUND_ENVIRONMENT: "production",
      GREENFIELD_PLAYGROUND_SUPABASE_PROJECT_REF: "zxaoycxzdjrbnzvbullk",
      NEXT_PUBLIC_SUPABASE_URL: "https://zxaoycxzdjrbnzvbullk.supabase.co",
    }, false],
    ["D: DEV marker with production Supabase", {
      NODE_ENV: "production",
      GREENFIELD_PLAYGROUND_ENABLED: "true",
      GREENFIELD_PLAYGROUND_ENVIRONMENT: "production",
      GREENFIELD_DEPLOYMENT_ENV: "development",
      GREENFIELD_PLAYGROUND_SUPABASE_PROJECT_REF: "ikuupzjaxzvatdnmyzoy",
      NEXT_PUBLIC_SUPABASE_URL: "https://ikuupzjaxzvatdnmyzoy.supabase.co",
    }, false],
    ["E: DEV marker with Supabase mismatch", {
      NODE_ENV: "production",
      GREENFIELD_PLAYGROUND_ENABLED: "true",
      GREENFIELD_PLAYGROUND_ENVIRONMENT: "production",
      GREENFIELD_DEPLOYMENT_ENV: "development",
      GREENFIELD_PLAYGROUND_SUPABASE_PROJECT_REF: "zxaoycxzdjrbnzvbullk",
      NEXT_PUBLIC_SUPABASE_URL: "https://ikuupzjaxzvatdnmyzoy.supabase.co",
    }, false],
    ["F: normal Playground gate fails", {
      NODE_ENV: "production",
      GREENFIELD_PLAYGROUND_ENABLED: "false",
      GREENFIELD_PLAYGROUND_ENVIRONMENT: "production",
      GREENFIELD_DEPLOYMENT_ENV: "development",
      GREENFIELD_PLAYGROUND_SUPABASE_PROJECT_REF: "zxaoycxzdjrbnzvbullk",
      NEXT_PUBLIC_SUPABASE_URL: "https://zxaoycxzdjrbnzvbullk.supabase.co",
    }, false],
    ["G: missing deployment identity", {
      NODE_ENV: "production",
      GREENFIELD_PLAYGROUND_ENABLED: "true",
      GREENFIELD_PLAYGROUND_SUPABASE_PROJECT_REF: "zxaoycxzdjrbnzvbullk",
      NEXT_PUBLIC_SUPABASE_URL: "https://zxaoycxzdjrbnzvbullk.supabase.co",
    }, false],
  ])("diagnostics gate %s", (_label, env, expected) => {
    expect(isGreenfieldPlaygroundDevDiagnosticsEnabled(env)).toBe(expected);
  });

  it("fails closed for diagnostics outside the authorized DEV target", () => {
    expect(isGreenfieldPlaygroundDevDiagnosticsEnabled({
      NODE_ENV: "development",
      GREENFIELD_PLAYGROUND_ENABLED: "true",
      GREENFIELD_PLAYGROUND_ENVIRONMENT: "production",
      GREENFIELD_DEPLOYMENT_ENV: "development",
      GREENFIELD_PLAYGROUND_SUPABASE_PROJECT_REF: "zxaoycxzdjrbnzvbullk",
      NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co",
    })).toBe(false);
    expect(greenfieldPlaygroundRuntimeRevision({
      NODE_ENV: "production",
      GREENFIELD_RUNTIME_REVISION: "8f6e127",
      NEXT_PUBLIC_SUPABASE_URL: "https://ikuupzjaxzvatdnmyzoy.supabase.co",
    })).toBeNull();
    const sanitized = sanitizeGreenfieldTrace({
      traceId: "trace-prod",
      diagnostics: { final_composition_source: "recovered_evidence" },
    }, {
      env: {
        NODE_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL: "https://ikuupzjaxzvatdnmyzoy.supabase.co",
      },
    });
    expect(sanitized.runtime_revision).toBeNull();
    expect(sanitized.diagnostics).toBeNull();
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
