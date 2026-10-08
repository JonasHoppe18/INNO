import { describe, expect, it } from "vitest";
import { draftAfterSave } from "../ai-instructions";

describe("draftAfterSave", () => {
  it("shows the saved, trimmed prompt when nothing changed during the save", () => {
    expect(draftAfterSave({ draft: " Hello ", submitted: " Hello ", saved: "Hello" })).toBe("Hello");
  });
  it("keeps edits typed while the save was in flight", () => {
    expect(draftAfterSave({ draft: " Hello world", submitted: " Hello ", saved: "Hello" })).toBe(" Hello world");
  });
});
