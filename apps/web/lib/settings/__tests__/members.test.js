import { describe, expect, it } from "vitest";
import { memberRowPermissions } from "../members";

const ctx = { canManageRoles: true, currentClerkUserId: "me", currentIsOwner: false };

describe("memberRowPermissions", () => {
  it("lets an admin manage a plain member", () => {
    expect(memberRowPermissions({ org_user_id: "u1", user_id: "s1", workspace_role: "org:member" }, ctx))
      .toMatchObject({ canEditRole: true, canRemoveMember: true, canEditSignature: true, isSelf: false });
  });
  it("never allows editing the owner or yourself", () => {
    expect(memberRowPermissions({ org_user_id: "u2", workspace_role: "org:owner" }, ctx).canEditRole).toBe(false);
    expect(memberRowPermissions({ org_user_id: "me", user_id: "s3", workspace_role: "org:member" }, ctx))
      .toMatchObject({ canEditRole: false, isSelf: true, canEditSignature: true });
  });
  it("only owners can change other admins", () => {
    const admin = { org_user_id: "u4", workspace_role: "org:admin" };
    expect(memberRowPermissions(admin, ctx).canEditRole).toBe(false);
    expect(memberRowPermissions(admin, { ...ctx, currentIsOwner: true }).canEditRole).toBe(true);
  });
  it("gives non-managers no role actions and only their own signature", () => {
    const viewer = { ...ctx, canManageRoles: false };
    expect(memberRowPermissions({ org_user_id: "u5", user_id: "s5", workspace_role: "org:member" }, viewer))
      .toMatchObject({ canEditRole: false, canRemoveMember: false, canEditSignature: false });
  });
  it("flags invitations and unsynced profiles", () => {
    expect(memberRowPermissions({ email: "x@y.dk", status: "invited" }, ctx)).toMatchObject({ isInvited: true, canEditSignature: false });
  });
});
