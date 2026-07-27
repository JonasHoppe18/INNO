import { describe, expect, it } from "vitest";
import { resolveClerkOrgId } from "../workspace-auth.js";

describe("resolveClerkOrgId", () => {
  it("uses Clerk's direct orgId when available", () => {
    expect(
      resolveClerkOrgId({
        orgId: "org_direct",
        sessionClaims: { o: { id: "org_compact" } },
      }),
    ).toBe("org_direct");
  });

  it("supports Clerk's compact organization claim", () => {
    expect(
      resolveClerkOrgId({
        sessionClaims: { o: { id: "org_compact" } },
      }),
    ).toBe("org_compact");
  });

  it("supports legacy organization claims", () => {
    expect(resolveClerkOrgId({ sessionClaims: { org_id: "org_legacy" } })).toBe(
      "org_legacy",
    );
  });

  it("returns null when the session has no active organization", () => {
    expect(resolveClerkOrgId({ sessionClaims: {} })).toBeNull();
    expect(resolveClerkOrgId()).toBeNull();
  });
});
