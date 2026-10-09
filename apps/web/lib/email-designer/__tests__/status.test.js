import { describe, expect, it } from "vitest";
import { designerStatus } from "../status";

const published = { id: "d1", status: "published", published_version: 3 };
const changedSincePublish = { id: "d1", status: "draft", published_version: 3 };
const neverPublished = { id: "d1", status: "draft", published_version: null };

describe("designerStatus", () => {
  it("separates whether the design is live from whether it is saved", () => {
    expect(designerStatus({ draft: published })).toEqual({
      publish: { label: "Published", tone: "published" },
      save: "Saved",
      canPublish: false,
    });
    expect(designerStatus({ draft: changedSincePublish }).publish).toEqual({ label: "Unpublished changes", tone: "pending" });
    expect(designerStatus({ draft: neverPublished }).publish).toEqual({ label: "Not published", tone: "draft" });
  });

  it("shows saving progress and unsaved edits", () => {
    expect(designerStatus({ draft: published, saving: true }).save).toBe("Saving…");
    expect(designerStatus({ draft: published, dirty: true }).save).toBe("Unsaved changes");
  });

  it("allows publishing only when there is something new to publish", () => {
    expect(designerStatus({ draft: published, dirty: true }).canPublish).toBe(true);
    expect(designerStatus({ draft: published, dirty: true }).publish.label).toBe("Unpublished changes");
    expect(designerStatus({ draft: changedSincePublish }).canPublish).toBe(true);
    expect(designerStatus({ draft: neverPublished }).canPublish).toBe(true);
    expect(designerStatus({ draft: { status: "draft" } }).canPublish).toBe(true);
    expect(designerStatus({ draft: null }).canPublish).toBe(false);
  });
});

describe("requiredBlockProblem", () => {
  it("requires exactly one block when the block is required", async () => {
    const { requiredBlockProblem } = await import("../status");
    expect(requiredBlockProblem(1, { optional: false })).toBe("");
    expect(requiredBlockProblem(0, { optional: false })).toBe("Add one required message block before publishing.");
    expect(requiredBlockProblem(2, { optional: false })).toContain("Keep one required message block");
  });

  it("allows none but not two when the block is optional", async () => {
    const { requiredBlockProblem } = await import("../status");
    expect(requiredBlockProblem(0, { optional: true })).toBe("");
    expect(requiredBlockProblem(1, { optional: true })).toBe("");
    expect(requiredBlockProblem(2, { optional: true })).toBe("Keep at most one message block in the email.");
  });
});
