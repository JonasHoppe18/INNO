import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AUTO_TAG_SYSTEM_PROMPT } from "../autoTagThread.js";

const webRoot = fileURLToPath(new URL("../../../", import.meta.url));

function readFromWebRoot(relativePath) {
  return readFileSync(new URL(relativePath, `file://${webRoot}/`), "utf8");
}

describe("solution summary ownership", () => {
  it("keeps auto-tagging focused on tags only", () => {
    expect(AUTO_TAG_SYSTEM_PROMPT).toContain("tag_ids");
    expect(AUTO_TAG_SYSTEM_PROMPT).not.toContain("solution_summary");

    const sendRoute = readFromWebRoot("app/api/threads/[threadId]/send/route.js");
    expect(sendRoute).not.toContain("result.solution_summary");
  });

  it("regenerates resolved summaries with an explicit English instruction", () => {
    const summaryRoute = readFromWebRoot("app/api/threads/[threadId]/solution-summary/route.js");
    expect(summaryRoute).toContain("Always write the entire summary in English");
    expect(summaryRoute).not.toContain("if (thread.solution_summary)");
  });
});
