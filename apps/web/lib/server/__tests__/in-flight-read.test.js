import { describe, expect, it, vi } from "vitest";
import { shareInFlightRead } from "../in-flight-read.js";

describe("in-flight scoped reads", () => {
  it("coalesces concurrent reads but never retains an authorization result", async () => {
    const client = {};
    const loader = vi.fn(async () => ({ workspaceId: "workspace-a" }));
    await Promise.all([shareInFlightRead(client, "user-a/org-a", loader), shareInFlightRead(client, "user-a/org-a", loader)]);
    expect(loader).toHaveBeenCalledOnce();
    await shareInFlightRead(client, "user-a/org-a", loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });
  it("keeps users, organizations and transports separate", async () => {
    const client = {};
    const loader = vi.fn(async () => "scope");
    await Promise.all([
      shareInFlightRead(client, "user-a/org-a", loader),
      shareInFlightRead(client, "user-a/org-b", loader),
      shareInFlightRead(client, "user-b/org-a", loader),
      shareInFlightRead({}, "user-a/org-a", loader),
    ]);
    expect(loader).toHaveBeenCalledTimes(4);
  });
  it("clears rejected authorization reads so a later request rechecks membership", async () => {
    const client = {};
    const loader = vi.fn().mockRejectedValueOnce(Error("not a member")).mockResolvedValueOnce("new scope");
    await expect(shareInFlightRead(client, "user/org", loader)).rejects.toThrow("not a member");
    expect(await shareInFlightRead(client, "user/org", loader)).toBe("new scope");
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
