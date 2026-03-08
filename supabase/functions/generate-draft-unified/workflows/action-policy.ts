import type { AutomationAction } from "../../_shared/automation-actions.ts";
import type { WorkflowActionPolicyResult, WorkflowRoute } from "./types.ts";

function normalizeActionType(action: AutomationAction): string {
  return String(action?.type || "").trim().toLowerCase();
}

export function applyWorkflowActionPolicy(
  actions: AutomationAction[],
  workflow: WorkflowRoute,
): WorkflowActionPolicyResult {
  const allowed = Array.isArray(workflow.allowedActionTypes) && workflow.allowedActionTypes.length
    ? new Set(workflow.allowedActionTypes.map((item) => String(item || "").trim().toLowerCase()))
    : null;
  const blocked = new Set(
    Array.isArray(workflow.blockedActionTypes)
      ? workflow.blockedActionTypes.map((item) => String(item || "").trim().toLowerCase())
      : [],
  );
  const removed: Array<{ type: string; reason: string }> = [];
  const kept: AutomationAction[] = [];
  for (const action of actions || []) {
    const type = normalizeActionType(action);
    if (!type) continue;
    if (blocked.has(type)) {
      removed.push({ type, reason: "blocked_by_workflow" });
      continue;
    }
    if (allowed && !allowed.has(type)) {
      removed.push({ type, reason: "not_allowed_in_workflow" });
      continue;
    }
    kept.push(action);
  }
  return { actions: kept, removed };
}

