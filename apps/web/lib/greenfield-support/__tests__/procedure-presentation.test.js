import { describe, expect, it } from "vitest";
import { createCapabilityRegistry } from "../capabilities";
import { createDemoDependencies } from "../demo-fixtures";
import { InMemoryKnowledgeStore } from "../knowledge";
import { renderResponseSegments, validateStructuredResponse } from "../response-contract";

const WORKSPACE_ID = "greenfield-demo-workspace";

async function procedureRegistry(content, title = "Headset reset procedure") {
  const dependencies = await createDemoDependencies();
  const knowledge = new InMemoryKnowledgeStore();
  await knowledge.ingest(WORKSPACE_ID, {
    sourceKind: "merchant_authored",
    sourceId: "presentation-procedure",
    title,
    content,
    knowledgeType: "procedural",
    authority: "authoritative",
    sourceLabel: "Merchant support procedure",
    structuredData: { applies_to: { product_models: ["A-Spire Wireless"] } },
  });
  return createCapabilityRegistry({ ...dependencies, knowledge });
}

async function renderedProcedure(content, customerMessage, stepIndexes, title) {
  const registry = await procedureRegistry(content, title);
  const lookup = await registry.execute("search_procedures", JSON.stringify({ query: customerMessage }));
  const resultIndex = lookup.data.results.findIndex((item) => item.provenance.source_id === "presentation-procedure");
  const segment = {
    type: "procedure_guidance",
    text: "The model cannot rewrite these source-bound steps.",
    basis: { result_id: lookup.resultId, field_paths: [`data.results[${resultIndex}].provenance.source_id`] },
    step_paths: stepIndexes.map((index) => `data.results[${resultIndex}].structured_data.procedure_steps[${index}].text`),
  };
  const validation = validateStructuredResponse({ segments: [segment] }, { ...registry, customerMessage });
  expect(validation.allValid).toBe(true);
  return { rendered: renderResponseSegments(validation.approvedSegments, { ...registry, customerMessage }), segment, validation };
}

const resetContent = [
  "How to reset the headset",
  "To reset the headset:",
  "Turn the headset off .",
  "Press and hold the Power button for at least 15 seconds.",
  "You will hear the voice prompt \"Dongle connected\".",
  "If the LED does not turn purple, repeat step 2.",
  "Connect the USB-C cable.",
  "Hold the Play/Pause button for 4 seconds.",
].join("\n\n");

describe("source-bound procedure presentation", () => {
  it("A: does not render an obvious source heading as an action bullet", async () => {
    const { rendered } = await renderedProcedure(resetContent, "How do I reset my A-Spire Wireless?", [0, 1, 2, 3, 4, 5, 6]);
    expect(rendered).not.toContain("- To reset the headset:");
    expect(rendered).toContain("Turn the headset off.");
  });

  it("B: removes whitespace before punctuation without changing the instruction", async () => {
    const { rendered } = await renderedProcedure("How to reset\n\nTurn the headset off .", "How do I reset my A-Spire Wireless?", [0]);
    expect(rendered).toContain("Turn the headset off.");
    expect(rendered).not.toContain("off .");
  });

  it("C: preserves critical numeric values exactly", async () => {
    const { rendered } = await renderedProcedure(resetContent, "How do I reset my A-Spire Wireless?", [1, 2, 4, 6]);
    expect(rendered).toContain("15 seconds");
    expect(rendered).toContain("4 seconds");
    expect(rendered).not.toContain("35 seconds");
    expect(rendered).not.toContain("for at least 5 seconds");
  });

  it("C2: preserves ports, LED colors, controls, and durations without substitution", async () => {
    const { rendered } = await renderedProcedure([
      "Critical values",
      "Hold the Power button for 15 seconds.",
      "The LED turns purple.",
      "Connect the USB-C cable to the USB-A adapter.",
      "Hold the Play/Pause button for 4 seconds.",
    ].join("\n\n"), "Show me the critical reset values for my A-Spire Wireless.", [0, 1, 2, 3]);
    expect(rendered).toContain("Power button");
    expect(rendered).toContain("15 seconds");
    expect(rendered).toContain("purple");
    expect(rendered).toContain("USB-C");
    expect(rendered).toContain("USB-A");
    expect(rendered).toContain("Play/Pause");
    expect(rendered).toContain("4 seconds");
    expect(rendered).not.toContain("35 seconds");
    expect(rendered).not.toContain("blue");
    expect(rendered).not.toContain("for 5 seconds");
  });

  it("D: preserves button and control names exactly", async () => {
    const { rendered } = await renderedProcedure(resetContent, "How do I reset my A-Spire Wireless?", [1, 2, 6]);
    expect(rendered).toContain("Power button");
    expect(rendered).toContain("Play/Pause button");
    expect(rendered).not.toContain("ANC button");
  });

  it("E: preserves quoted device prompts while normalizing surrounding punctuation", async () => {
    const { rendered } = await renderedProcedure(resetContent, "How do I reset my A-Spire Wireless?", [1, 3]);
    expect(rendered).toContain('"Dongle connected"');
    expect(rendered).not.toContain('"Dongle connected ."');
  });

  it("F: keeps ordered source steps in source order", async () => {
    const { rendered } = await renderedProcedure(resetContent, "How do I reset my A-Spire Wireless?", [1, 2, 3, 4]);
    expect(rendered.indexOf("Turn the headset off.")).toBeLessThan(rendered.indexOf("15 seconds"));
    expect(rendered.indexOf("15 seconds")).toBeLessThan(rendered.indexOf("Dongle connected"));
  });

  it("G: keeps guidance with no ordered metadata as bullets rather than inventing numbering", async () => {
    const { rendered } = await renderedProcedure([
      "# Microphone troubleshooting checks",
      "Check the mute switch.",
      "Check the app permissions.",
      "Try another device.",
    ].join("\n\n"), "What should I check for a microphone problem on my A-Spire Wireless?", [1, 2, 3], "Microphone troubleshooting procedure");
    expect(rendered).toContain("- Check the mute switch.");
    expect(rendered).toContain("- Check the app permissions.");
    expect(rendered).not.toMatch(/\n1\. Check/);
  });

  it("H: keeps conditional wording attached to the rendered source step", async () => {
    const { rendered } = await renderedProcedure(resetContent, "How do I reset my A-Spire Wireless?", [4]);
    expect(rendered).toContain("If the LED does not turn purple, repeat step 2.");
    expect(rendered).not.toContain("Repeat step 2.");
  });

  it("H2: completes a selected condition with its adjacent source instruction", async () => {
    const { rendered } = await renderedProcedure(resetContent, "How do I reset my A-Spire Wireless?", [4]);
    expect(rendered).toContain("If the LED does not turn purple, repeat step 2.");
    expect(rendered).toContain("Connect the USB-C cable.");
  });

  it("H3: drops a dangling condition when the source has no child instruction", async () => {
    const { rendered } = await renderedProcedure([
      "Reset checks.",
      "If the LED does not turn purple:",
    ].join("\n\n"), "How do I reset my A-Spire Wireless?", [1]);
    expect(rendered).not.toContain("If the LED does not turn purple:");
  });

  it("I: answers a single-fact duration question without dumping neighboring steps", async () => {
    const { rendered } = await renderedProcedure(resetContent, "How long should I hold the Power button when resetting my A-Spire Wireless?", [0, 1, 2]);
    expect(rendered).toBe("Press and hold the Power button for at least 15 seconds.");
    expect(rendered).not.toContain("Turn the headset off");
    expect(rendered).not.toContain("Dongle connected");
  });

  it("J: returns every cited source step for a full-procedure request", async () => {
    const { rendered } = await renderedProcedure(resetContent, "How do I reset my A-Spire Wireless?", [0, 1, 2, 3, 4, 5, 6]);
    expect(rendered).toContain("Turn the headset off.");
    expect(rendered).toContain("15 seconds");
    expect(rendered).toContain("If the LED does not turn purple, repeat step 2.");
    expect(rendered).toContain("USB-C cable.");
    expect(rendered).toContain("Play/Pause button for 4 seconds.");
  });

  it("K: renders a multi-turn continuation from the cited next source step", async () => {
    const { rendered } = await renderedProcedure(resetContent, "I already tried the first two steps of the A-Spire Wireless reset. What should I try next?", [3, 4, 5, 6]);
    expect(rendered).not.toContain("Turn the headset off.");
    expect(rendered).not.toContain("15 seconds");
    expect(rendered).toContain("Dongle connected");
    expect(rendered).toContain("If the LED does not turn purple, repeat step 2.");
  });

  it("L: keeps the source citation paths unchanged while cleaning only rendered text", async () => {
    const { segment, validation, rendered } = await renderedProcedure(resetContent, "How do I reset my A-Spire Wireless?", [0, 1, 2]);
    expect(validation.parsed?.segments[0]).toMatchObject({ step_paths: segment.step_paths });
    expect(rendered).not.toContain("The model cannot rewrite");
  });

  it("M: does not invent instructions when the procedure lookup is not found", async () => {
    const registry = await procedureRegistry(resetContent);
    const lookup = await registry.execute("search_procedures", JSON.stringify({ query: "unknown solar panel calibration" }));
    expect(lookup.status).toBe("not_found");
    const result = validateStructuredResponse({ segments: [{
      type: "procedure_guidance",
      text: "Hold the button for 20 seconds.",
      basis: { result_id: lookup.resultId, field_paths: ["data.results[0].provenance.source_id"] },
      step_paths: ["data.results[0].structured_data.procedure_steps[0].text"],
    }] }, { ...registry, customerMessage: "How do I reset an unknown product?" });
    expect(result.approvedSegments).toEqual([]);
    expect(result.issues.map((issue) => issue.code)).toContain("result_not_verified");
  });
});
