import { describe, expect, it } from "vitest";
import { canNavigateQueueLocally } from "../queue-navigation.js";

describe("local inbox queue navigation", () => {
  it("can filter the loaded inbox and reset to its default queue", () => {
    expect(canNavigateQueueLocally("https://sona.test/inbox?thread=one", "/inbox?view=waiting_customer")).toBe(true);
    expect(canNavigateQueueLocally("https://sona.test/inbox?view=resolved", "/inbox")).toBe(true);
  });
  it.each(["/dashboard", "/inbox/tickets", "/inbox?q=search", "/inbox?unread=1", "/inbox?new=1", "https://other.test/inbox"])("keeps server/cross-route navigation for %s", href => {
    expect(canNavigateQueueLocally("https://sona.test/inbox", href)).toBe(false);
  });
  it("does not hide new-tab, canceled or modifier clicks", () => {
    for (const event of [{button:1}, {metaKey:true}, {ctrlKey:true}, {shiftKey:true}, {altKey:true}, {defaultPrevented:true}]) {
      expect(canNavigateQueueLocally("https://sona.test/inbox", "/inbox?view=mine", event)).toBe(false);
    }
    expect(canNavigateQueueLocally("https://sona.test/customers", "/inbox?view=mine")).toBe(false);
    expect(canNavigateQueueLocally("https://sona.test/inbox?q=term", "/inbox?view=mine")).toBe(false);
  });
});
