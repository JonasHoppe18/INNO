export type GreenfieldReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null;

export const GREENFIELD_DEFAULT_MODEL = "gpt-5.6-luna";
export const GREENFIELD_DEFAULT_REASONING_EFFORT: GreenfieldReasoningEffort = "medium";

export interface GreenfieldRuntimeConfig {
  model: string;
  reasoningEffort: GreenfieldReasoningEffort;
}

/**
 * Resolve the single Greenfield runtime default while keeping explicit model
 * and reasoning choices available to evaluation callers.
 */
export function resolveGreenfieldRuntimeConfig(options: {
  model?: string;
  reasoningEffort?: GreenfieldReasoningEffort;
} = {}): GreenfieldRuntimeConfig {
  const explicitModel = typeof options.model === "string" && options.model.trim() ? options.model.trim() : null;
  return {
    model: explicitModel ?? GREENFIELD_DEFAULT_MODEL,
    reasoningEffort: options.reasoningEffort !== undefined
      ? options.reasoningEffort
      : explicitModel
        ? null
        : GREENFIELD_DEFAULT_REASONING_EFFORT,
  };
}
