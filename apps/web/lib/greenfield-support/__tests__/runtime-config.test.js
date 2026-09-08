import { describe, expect, it } from "vitest";
import {
  GREENFIELD_DEFAULT_MODEL,
  GREENFIELD_DEFAULT_REASONING_EFFORT,
  resolveGreenfieldRuntimeConfig,
} from "../runtime-config";

describe("Greenfield runtime model configuration", () => {
  it("uses GPT-5.6 Luna with medium reasoning by default", () => {
    expect(resolveGreenfieldRuntimeConfig()).toEqual({
      model: "gpt-5.6-luna",
      reasoningEffort: "medium",
    });
    expect(GREENFIELD_DEFAULT_MODEL).toBe("gpt-5.6-luna");
    expect(GREENFIELD_DEFAULT_REASONING_EFFORT).toBe("medium");
  });

  it("keeps explicit evaluation overrides available without fallback routing", () => {
    expect(resolveGreenfieldRuntimeConfig({ model: "gpt-5.2", reasoningEffort: "none" })).toEqual({
      model: "gpt-5.2",
      reasoningEffort: "none",
    });
    expect(resolveGreenfieldRuntimeConfig({ model: "gpt-5.2" })).toEqual({
      model: "gpt-5.2",
      reasoningEffort: null,
    });
  });

  it("does not introduce a model fallback when an explicit model is selected", () => {
    expect(resolveGreenfieldRuntimeConfig({ model: "gpt-5.2", reasoningEffort: null })).toEqual({
      model: "gpt-5.2",
      reasoningEffort: null,
    });
  });
});
