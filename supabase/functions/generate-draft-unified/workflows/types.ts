import type { AutomationAction } from "../../_shared/automation-actions.ts";
import type { EmailCategory } from "../../_shared/email-category.ts";

export type WorkflowSlug =
  | "tracking"
  | "return"
  | "exchange"
  | "product_question"
  | "technical_support"
  | "payment"
  | "cancellation"
  | "refund"
  | "address_change"
  | "general";

export type WorkflowRoute = {
  category: EmailCategory;
  workflow: WorkflowSlug;
  promptHint: string;
  systemHint: string;
  promptBlocks: string[];
  systemRules: string[];
  allowedActionTypes?: string[];
  blockedActionTypes?: string[];
  forceTrackingIntent?: boolean;
  forceReturnDetailsFlow?: boolean;
};

export type WorkflowActionPolicyResult = {
  actions: AutomationAction[];
  removed: Array<{ type: string; reason: string }>;
};
