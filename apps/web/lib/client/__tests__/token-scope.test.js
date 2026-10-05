import { describe, expect, it } from "vitest";
import { tokenMatchesScope } from "../token-scope.js";
const token = claims => `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
const identity = { userId: "user-a", sessionId: "session-a", orgId: "org-a" };
describe("read token scope consistency", () => {
  it("accepts matching legacy and compact Clerk organization claims", () => {
    expect(tokenMatchesScope(token({sub:"user-a",sid:"session-a",org_id:"org-a"}),identity)).toBe(true);
    expect(tokenMatchesScope(token({sub:"user-a",sid:"session-a",o:{id:"org-a"}}),identity)).toBe(true);
  });
  it("rejects stale organization, session or account tokens and malformed input", () => {
    for (const claims of [{sub:"user-a",sid:"session-a",org_id:"old-org"},{sub:"user-a",sid:"old-session",org_id:"org-a"},{sub:"other-user",sid:"session-a",org_id:"org-a"}]) {
      expect(tokenMatchesScope(token(claims), identity)).toBe(false);
    }
    expect(tokenMatchesScope("invalid",identity)).toBe(false);
    expect(tokenMatchesScope(token({sub:"user-a",sid:"session-a"}),{...identity,orgId:null})).toBe(true);
  });
});
