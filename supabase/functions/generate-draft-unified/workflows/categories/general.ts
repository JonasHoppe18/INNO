import type { WorkflowRoute } from "../types.ts";

export function buildGeneralDraft(): WorkflowRoute {
  return {
    category: "General",
    workflow: "general",
    promptHint: "WORKFLOW: General. Løs henvendelsen direkte med kort, tydeligt svar.",
    systemHint: "Workflow er General: vælg mindst nødvendige handlinger.",
    promptBlocks: [],
    systemRules: [],
  };
}

