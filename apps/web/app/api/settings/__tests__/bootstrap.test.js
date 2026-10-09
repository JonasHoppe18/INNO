import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ userId: "viewer", calls: [], release: null }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: state.userId }) }));
const handler = async (request) => {
  state.calls.push({ path: new URL(request.url).pathname, authorization: request.headers.get("authorization") });
  await new Promise(resolve => { state.release.push(resolve); });
  const path = request.nextUrl.pathname;
  if (path.endsWith("email-routing")) throw new Error("Unavailable");
  return Response.json({ path }, { status: path.endsWith("email-blocklist") ? 403 : 200 });
};
vi.mock("../members/route", () => ({ GET: (...args) => handler(...args) }));
vi.mock("../test-mode/route", () => ({ GET: (...args) => handler(...args) }));
vi.mock("../brand/route", () => ({ GET: (...args) => handler(...args) }));
vi.mock("../../persona/route", () => ({ GET: (...args) => handler(...args) }));
vi.mock("../auto-reply/route", () => ({ GET: (...args) => handler(...args) }));
vi.mock("../email-signature/route", () => ({ GET: (...args) => handler(...args) }));
vi.mock("../email-routing/route", () => ({ GET: (...args) => handler(...args) }));
vi.mock("../email-sender-rules/route", () => ({ GET: (...args) => handler(...args) }));
vi.mock("../email-blocklist/route", () => ({ GET: (...args) => handler(...args) }));
vi.mock("../../inboxes/route", () => ({ GET: (...args) => handler(...args) }));
import { GET } from "../bootstrap/route";
beforeEach(() => { state.userId = "viewer"; state.calls = []; state.release = []; });
describe("settings bootstrap", () => {
  it("rejects signed-out reads before calling resource handlers", async () => {
    state.userId = null;
    expect((await GET(new Request("https://app.test/api/settings/bootstrap"))).status).toBe(401);
    expect(state.calls).toHaveLength(0);
  });
  it("starts all protected reads together and preserves individual failures", async () => {
    const pending = GET(new Request("https://app.test/api/settings/bootstrap?ignored=1", {
      headers: { Authorization: "Bearer test-session" },
    }));
    await vi.waitFor(() => expect(state.calls).toHaveLength(10));
    expect(state.calls.every(call => call.authorization === "Bearer test-session")).toBe(true);
    state.release.forEach(resolve => resolve());
    const response = await pending;
    const { resources } = await response.json();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(resources["/api/settings/members"].ok).toBe(true);
    expect(resources["/api/settings/email-blocklist"].status).toBe(403);
    expect(resources["/api/settings/email-routing"].status).toBe(500);
    expect(Object.keys(resources)).toHaveLength(10);
  });
});
