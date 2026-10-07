import type { ActionEligibility } from "./action-eligibility";
import type { ProposedAction, ToolExecutionResult } from "./types";

type ResultRecord = { resultId: string; toolName: string; result: ToolExecutionResult };

/** A failed action gate owns the next-step outcome, before response validation or rendering. */
export function boundedActionDecision(records: ResultRecord[], proposals: ProposedAction[], locale: string) {
  if (proposals.length) return null;
  const blocked = [...records].reverse().find(record => record.result.status === "invalid_request"
    && record.result.data && typeof record.result.data === "object" && !Array.isArray(record.result.data)
    && record.result.data.action_eligibility);
  const validation = blocked?.result.data && typeof blocked.result.data === "object" && !Array.isArray(blocked.result.data)
    ? blocked.result.data.action_validation as unknown as { checks?: Array<{ name: string; status: string }> } : null;
  if (!["customer_identity", "verified_order", "order_scope"].every(name => validation?.checks?.some(c => c.name === name && c.status === "passed"))) return null;
  if (!blocked || !blocked.result.data || typeof blocked.result.data !== "object" || Array.isArray(blocked.result.data)) return null;
  const gate = blocked.result.data.action_eligibility as unknown as ActionEligibility;
  if (gate.outcome === "proposal_allowed") return null;
  const assessment = gate.outcome === "assessment_required";
  const stateKnown = gate.requirements.find(r => r.name === "operational_state_known")?.satisfied === true;
  const dispatched = gate.requirements.find(r => r.name === "whole_order_unfulfilled")?.satisfied === false;
  const text = locale === "da" ? assessment
    ? "Sagen kræver en vurdering hos support, før retur, refundering eller erstatning kan tilbydes. Jeg kan ikke godkende løsningen her. Følg reklamationsprocessen for vurdering og godkendelse."
    : dispatched ? "Ordren er allerede helt eller delvist afsendt. Derfor kan jeg ikke ændre leveringsadressen eller annullere hele ordren. Support kan hjælpe med at vurdere de mulige næste skridt."
    : "Jeg kan ikke bekræfte, at denne handling er mulig ud fra ordrens aktuelle status. Support skal vurdere de næste skridt."
    : assessment
      ? "This claim needs support assessment before a return, refund or replacement can be offered. I cannot approve a remedy here. Please follow the complaint process for assessment and authorization."
      : dispatched ? "The order has already been shipped at least in part, so I cannot change the delivery address or cancel the whole order. Support can review the available next steps."
      : "I cannot confirm this action is available from the current order state. Support needs to review the next steps.";
  return {
    outcome: gate.outcome, action: blocked.toolName, stateKnown, eligibility: gate,
    structuredOutput: { segments: [{ type: "limitation", text,
      basis: { result_id: blocked.resultId, field_paths: ["data.action_eligibility"] } }] },
  };
}
