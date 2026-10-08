"use client";

import { useAuth, useOrganization, useUser } from "@clerk/nextjs";
import { useSettingsWorkspace } from "@/components/settings/SettingsWorkspaceProvider";
import {
  SettingsEmptyState,
  SettingsGroup,
  SettingsPage,
  SettingsRowMenu,
  SettingsTable,
  SettingsTableRow,
} from "@/components/settings/ui/settings-layout";
import { memberRowPermissions } from "@/lib/settings/members";
import { EditSignatureModal } from "@/components/settings/EditSignatureModal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Mail,
  Trash2,
  User,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

function getDisplayName(member) {
  const first = String(member?.first_name || "").trim();
  const last = String(member?.last_name || "").trim();
  const fullName = `${first} ${last}`.trim();
  if (fullName) return fullName;
  const email = String(member?.email || "").trim();
  if (email) return email.split("@")[0];
  return "Unknown user";
}

function normalizeOrgRole(role) {
  const normalized = String(role || "").toLowerCase();
  if (normalized.includes("admin")) return "Admin";
  if (normalized.includes("owner")) return "Owner";
  if (normalized.includes("member")) return "Member";
  return "Member";
}

function MembersTab({
  members,
  onSignatureSaved,
  onInviteCreated,
  onMembersChanged,
  canManageRoles,
  currentOrgRole,
  currentClerkUserId,
}) {
  const { organization, isLoaded: organizationLoaded } = useOrganization();
  const { memberships, invitations } = useOrganization({
    memberships: { infinite: true, keepPreviousData: true },
    invitations: { infinite: true, keepPreviousData: true },
  });
  const [activeMember, setActiveMember] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("org:member");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [roleUpdatingForUserId, setRoleUpdatingForUserId] = useState(null);
  const normalizedCurrentRole = String(currentOrgRole || "").toLowerCase();
  const currentIsOwner = normalizedCurrentRole.includes("owner");

  const handleOpenSignatureModal = (member) => {
    setActiveMember(member);
    setModalOpen(true);
  };

  const profileByClerkUserId = useMemo(() => {
    const map = new Map();
    for (const profile of members || []) {
      const clerkId = String(profile?.clerk_user_id || "").trim();
      if (clerkId) map.set(clerkId, profile);
    }
    return map;
  }, [members]);

  const orgRows = useMemo(() => {
    const data = memberships?.data || [];
    return data.map((membership) => {
      const pud = membership?.publicUserData || membership?.public_user_data || null;
      const clerkUserId = String(pud?.userId || pud?.user_id || "").trim();
      const profile = clerkUserId ? profileByClerkUserId.get(clerkUserId) : null;
      return {
        user_id: profile?.user_id ?? null,
        clerk_user_id: clerkUserId || null,
        org_user_id: clerkUserId || null,
        org_membership_id: membership?.id ?? null,
        status: "active",
        joined_at: membership?.createdAt ?? membership?.created_at ?? null,
        first_name: profile?.first_name ?? pud?.firstName ?? pud?.first_name ?? "",
        last_name: profile?.last_name ?? pud?.lastName ?? pud?.last_name ?? "",
        email: profile?.email ?? pud?.identifier ?? "",
        image_url: profile?.image_url ?? pud?.imageUrl ?? pud?.image_url ?? "",
        signature: profile?.signature ?? "",
        workspace_role: membership?.role ?? "org:member",
      };
    });
  }, [memberships?.data, profileByClerkUserId]);

  const invitedRows = useMemo(() => {
    const data = invitations?.data || [];
    return data.map((invitation) => {
      const email = String(
        invitation?.emailAddress || invitation?.email_address || ""
      ).trim();
      return {
        user_id: null,
        clerk_user_id: null,
        org_user_id: null,
        org_membership_id: null,
        invitation_id: invitation?.id ?? null,
        status: "invited",
        joined_at: invitation?.createdAt ?? invitation?.created_at ?? null,
        first_name: "",
        last_name: "",
        email,
        image_url: "",
        signature: "",
        workspace_role: invitation?.role ?? "org:member",
      };
    });
  }, [invitations?.data]);

  const rows = useMemo(() => {
    const byKey = new Map();

    const put = (row) => {
      const key =
        String(row?.clerk_user_id || "").trim() ||
        String(row?.email || "").trim().toLowerCase() ||
        String(row?.user_id || "").trim();
      if (!key) return;
      byKey.set(key, { ...(byKey.get(key) || {}), ...row });
    };

    for (const row of members || []) put(row);
    for (const row of orgRows || []) put(row);
    for (const row of invitedRows || []) put(row);

    return Array.from(byKey.values());
  }, [invitedRows, members, orgRows]);

  const handleRoleChange = useCallback(
    async (member, nextRole) => {
      const userId = String(member?.org_user_id || member?.clerk_user_id || "").trim();
      if (!organizationLoaded || !organization || !userId) {
        toast.error("Could not resolve organization member.");
        return;
      }
      if (!canManageRoles) {
        toast.error("Only admins can change roles.");
        return;
      }
      setRoleUpdatingForUserId(userId);
      try {
        await organization.updateMember({ userId, role: nextRole });
        toast.success("Member role updated.");
        await memberships?.revalidate?.();
        onMembersChanged?.();
      } catch (error) {
        toast.error(error?.errors?.[0]?.longMessage || error?.message || "Could not update role.");
      } finally {
        setRoleUpdatingForUserId(null);
      }
    },
    [canManageRoles, memberships, onMembersChanged, organization, organizationLoaded]
  );

  const handleInvite = useCallback(async () => {
    if (!canManageRoles) {
      toast.error("Only admins can invite members.");
      return;
    }
    const email = String(inviteEmail || "").trim();
    if (!email) {
      toast.error("Enter an email address.");
      return;
    }

    setInviteLoading(true);
    try {
      const response = await fetch("/api/settings/members/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, role: inviteRole }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not send invitation.");
      }
      toast.success("Invitation sent.");
      setInviteOpen(false);
      setInviteEmail("");
      setInviteRole("org:member");
      onInviteCreated?.();
    } catch (error) {
      toast.error(error?.errors?.[0]?.longMessage || error?.message || "Could not send invitation.");
    } finally {
      setInviteLoading(false);
    }
  }, [canManageRoles, inviteEmail, inviteRole, onInviteCreated]);

  const handleResendInvite = useCallback(
    async (member) => {
      const email = String(member?.email || "").trim();
      const role = String(member?.workspace_role || "org:member");
      if (!email) {
        toast.error("Missing invite email.");
        return;
      }
      try {
        const response = await fetch("/api/settings/members/invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ email, role }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Could not resend invite.");
        }
        toast.success("Invitation resent.");
        onInviteCreated?.();
      } catch (error) {
        toast.error(
          error?.errors?.[0]?.longMessage || error?.message || "Could not resend invite."
        );
      }
    },
    [onInviteCreated]
  );

  const handleRemoveMember = useCallback(
    async (member) => {
      if (String(member?.status || "") === "invited") {
        const invitationId = String(member?.invitation_id || "").trim();
        if (!organizationLoaded || !organization || !invitationId) {
          toast.error("Could not resolve invitation.");
          return;
        }
        const confirmed = window.confirm(`Delete pending invitation for ${member?.email || "user"}?`);
        if (!confirmed) return;
        try {
          if (typeof organization.revokeInvitation === "function") {
            await organization.revokeInvitation({ invitationId });
          } else {
            throw new Error("Revoke invitation API not available.");
          }
          toast.success("Invitation deleted.");
          await invitations?.revalidate?.();
          onMembersChanged?.();
        } catch (error) {
          toast.error(
            error?.errors?.[0]?.longMessage || error?.message || "Could not delete invitation."
          );
        }
        return;
      }

      const userId = String(member?.org_user_id || member?.clerk_user_id || "").trim();
      const role = String(member?.workspace_role || "").toLowerCase();
      const isOwner = role.includes("owner");
      const isSelf = userId === String(currentClerkUserId || "").trim();

      if (!organizationLoaded || !organization || !userId) {
        toast.error("Could not resolve organization member.");
        return;
      }
      if (!canManageRoles) {
        toast.error("Only admins can remove members.");
        return;
      }
      if (isOwner) {
        toast.error("Owner cannot be removed from this screen.");
        return;
      }
      if (isSelf) {
        toast.error("You cannot remove yourself.");
        return;
      }

      const displayName = getDisplayName(member);
      const confirmed = window.confirm(`Remove ${displayName} from the team?`);
      if (!confirmed) return;

      try {
        if (typeof organization.removeMember === "function") {
          await organization.removeMember({ userId });
        } else if (typeof organization.destroyMembership === "function") {
          await organization.destroyMembership({ userId });
        } else if (typeof organization.updateMember === "function") {
          throw new Error("No remove API available in this Clerk SDK.");
        } else {
          throw new Error("Organization membership removal is not available.");
        }
        toast.success("Member removed.");
        await memberships?.revalidate?.();
        onMembersChanged?.();
      } catch (error) {
        toast.error(
          error?.errors?.[0]?.longMessage || error?.message || "Could not remove member."
        );
      }
    },
    [
      canManageRoles,
      currentClerkUserId,
      invitations,
      memberships,
      onMembersChanged,
      organization,
      organizationLoaded,
    ]
  );

  return (
    <>
      <SettingsPage
        width="wide"
        title="Members"
        description="Manage who has access to your workspace."
        actions={
          <Button type="button" size="sm" onClick={() => setInviteOpen(true)} disabled={!canManageRoles}>
            Invite member
          </Button>
        }
      >
        <SettingsGroup footer={`${rows.length} ${rows.length === 1 ? "member" : "members"}`}>
          {rows.length ? (
            <SettingsTable
              template="minmax(240px,1fr) 110px 120px 40px"
              columns={[
                { key: "member", label: "Member" },
                { key: "role", label: "Role" },
                { key: "signature", label: "Signature" },
                { key: "actions", label: "" },
              ]}
            >
              {rows.map((member) => {
                const displayName = getDisplayName(member);
                const initials = displayName
                  .split(" ")
                  .map((part) => part[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase();
                const role = normalizeOrgRole(member?.workspace_role);
                const {
                  rawRole,
                  memberUserId,
                  canEditRole,
                  canEditSignature,
                  canRemoveMember,
                  isInvited,
                } = memberRowPermissions(member, { canManageRoles, currentClerkUserId, currentIsOwner });
                const isRoleUpdating = roleUpdatingForUserId && roleUpdatingForUserId === memberUserId;

                return (
                  <SettingsTableRow key={member.user_id || member.clerk_user_id || member.email}>
                    <div className="flex min-w-0 items-center gap-3">
                      {member.image_url && !isInvited ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={member.image_url} alt={displayName} className="h-7 w-7 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                          {initials || "U"}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="truncate font-medium text-foreground">{displayName}</p>
                          {isInvited ? (
                            <Badge variant="neutral" className="shrink-0">Invited</Badge>
                          ) : null}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{member.email || "No email"}</p>
                      </div>
                    </div>

                    <p className="text-sm text-foreground">{role}</p>

                    <div>
                      {isInvited ? (
                        <Button type="button" variant="ghost" size="sm" className="-ml-3" onClick={() => handleResendInvite(member)}>
                          Resend
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="-ml-3"
                          onClick={() => handleOpenSignatureModal(member)}
                          disabled={!canEditSignature}
                          title={
                            !member?.user_id
                              ? "User profile not synced yet"
                              : !canEditSignature
                              ? "You can only edit your own signature."
                              : ""
                          }
                        >
                          Edit
                        </Button>
                      )}
                    </div>

                    <SettingsRowMenu
                      disabled={!canManageRoles && !isInvited}
                      title={canManageRoles || isInvited ? "More actions" : "Only admins can manage members"}
                    >
                      {isInvited ? (
                        <>
                          <DropdownMenuItem onSelect={() => handleResendInvite(member)}>
                            <Mail className="mr-2 h-4 w-4" />
                            Resend invite
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-danger-foreground focus:text-danger-foreground"
                            onSelect={() => handleRemoveMember(member)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Remove user
                          </DropdownMenuItem>
                        </>
                      ) : (
                        <>
                          <DropdownMenuItem
                            disabled={!canEditRole || Boolean(isRoleUpdating)}
                            onSelect={() =>
                              handleRoleChange(member, rawRole.includes("admin") ? "org:member" : "org:admin")
                            }
                          >
                            <User className="mr-2 h-4 w-4" />
                            {rawRole.includes("admin") ? "Make member" : "Make admin"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-danger-foreground focus:text-danger-foreground"
                            disabled={!canRemoveMember}
                            onSelect={() => handleRemoveMember(member)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Remove user
                          </DropdownMenuItem>
                        </>
                      )}
                    </SettingsRowMenu>
                  </SettingsTableRow>
                );
              })}
            </SettingsTable>
          ) : (
            <SettingsEmptyState title="No members yet" description="Invite your team to start working in Sona." />
          )}
        </SettingsGroup>
      </SettingsPage>

      <EditSignatureModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        member={activeMember}
        onSaved={onSignatureSaved}
      />

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Invite member</DialogTitle>
            <DialogDescription>
              Send an organization invitation by email.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="invite-email" className="text-sm font-medium text-foreground">
                Email
              </label>
              <Input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="teammate@company.com"
                disabled={inviteLoading}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="invite-role" className="text-sm font-medium text-foreground">
                Role
              </label>
              <select
                id="invite-role"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value)}
                disabled={inviteLoading}
              >
                <option value="org:member">Member</option>
                {canManageRoles && <option value="org:admin">Admin</option>}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setInviteOpen(false)} disabled={inviteLoading}>
              Cancel
            </Button>
            <Button type="button" onClick={handleInvite} disabled={inviteLoading}>
              {inviteLoading ? "Sending..." : "Send invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function MembersSection() {
  const { user } = useUser();
  const { orgRole } = useAuth();
  const { members, setMembers, currentRole, canManageMembers, reloadMembers } = useSettingsWorkspace();

  return (
    <MembersTab
      members={members}
      currentOrgRole={currentRole || orgRole}
      currentClerkUserId={user?.id ?? null}
      canManageRoles={
        canManageMembers ||
        String(orgRole || "").toLowerCase().includes("admin") ||
        String(orgRole || "").toLowerCase().includes("owner")
      }
      onInviteCreated={reloadMembers}
      onMembersChanged={reloadMembers}
      onSignatureSaved={(userId, signature) => {
        setMembers((prev) =>
          prev.map((member) =>
            member.user_id === userId ? { ...member, signature } : member
          )
        );
      }}
    />
  );
}
