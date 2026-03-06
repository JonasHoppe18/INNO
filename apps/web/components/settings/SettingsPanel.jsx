"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth, useOrganization, useUser } from "@clerk/nextjs";
import {
  Building2,
  ChevronDown,
  CreditCard,
  Mail,
  Lock,
  PenLine,
  Settings,
  Trash2,
  User,
  Users2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EditSignatureModal } from "@/components/settings/EditSignatureModal";
import { useClerkSupabase } from "@/lib/useClerkSupabase";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const MENU_SECTIONS = [
  {
    label: "PERSONAL",
    items: [{ key: "profile", label: "Profile", icon: User }],
  },
  {
    label: "TEAM",
    items: [
      { key: "general", label: "General", icon: Building2 },
      { key: "members", label: "Members", icon: Users2 },
      { key: "email", label: "Email", icon: Mail },
      { key: "billing", label: "Billing", icon: CreditCard },
    ],
  },
];

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function TabSkeleton() {
  return (
    <section className="max-w-2xl rounded-lg bg-white p-6">
      <div className="h-8 w-40 animate-pulse rounded bg-slate-200" />
      <div className="mt-3 h-4 w-64 animate-pulse rounded bg-slate-100" />
      <div className="mt-8 space-y-3">
        <div className="h-4 w-24 animate-pulse rounded bg-slate-200" />
        <div className="h-10 w-full animate-pulse rounded bg-slate-100" />
        <div className="h-10 w-32 animate-pulse rounded bg-slate-200" />
      </div>
    </section>
  );
}

function GeneralTab({ shopDomain, teamName, onTeamNameChange, onSave, saving, canSave }) {
  const hasShop = Boolean(shopDomain);

  return (
    <section className="max-w-2xl">
      <div className="px-1">
        <h2 className="text-2xl font-semibold text-slate-900">General</h2>
        <p className="mt-1 text-sm text-slate-600">Configure shared team settings.</p>
      </div>

      <div className="mt-6 divide-y divide-gray-100">
        <div className="grid grid-cols-1 gap-6 py-6 md:grid-cols-3">
          <div>
            <h3 className="font-medium text-gray-900">Shop URL</h3>
            <p className="mt-1 text-sm text-gray-500">The connected Shopify store.</p>
          </div>
          <div className="md:col-span-2">
            <Input
              id="shop-url"
              value={shopDomain || "No shop connected"}
              readOnly
              className="max-w-md bg-slate-100 text-slate-600"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 py-6 md:grid-cols-3">
          <div>
            <h3 className="font-medium text-gray-900">Team Name</h3>
            <p className="mt-1 text-sm text-gray-500">
              This is your team&apos;s visible name within Sona.
            </p>
          </div>
          <div className="space-y-3 md:col-span-2">
            <Input
              id="team-name"
              value={teamName}
              onChange={(event) => onTeamNameChange(event.target.value)}
              placeholder="Enter your team name"
              className="max-w-md"
            />
            <div className="max-w-md">
              <Button
                onClick={onSave}
                disabled={!hasShop || !canSave || saving}
                className="ml-auto block bg-slate-900 text-white hover:bg-slate-800"
              >
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 py-6 md:grid-cols-3">
          <div>
            <h3 className="font-medium text-red-700">Delete Workspace</h3>
            <p className="mt-1 text-sm text-gray-500">
              Permanently delete this team and all data.
            </p>
          </div>
          <div className="md:col-span-2">
            <div className="max-w-md">
              <Button
                type="button"
                className="ml-auto block bg-red-600 text-white hover:bg-red-700"
              >
                Delete Team
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

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

function formatJoinedDate(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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
      <section className="w-full max-w-none rounded-lg bg-white p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">Team Members</h2>
            <p className="mt-1 text-sm text-slate-600">Manage who has access.</p>
          </div>
          <Button type="button" onClick={() => setInviteOpen(true)} disabled={!canManageRoles}>
            Invite Member
          </Button>
        </div>

        <div className="mt-5 w-full overflow-hidden rounded-lg border border-gray-200 divide-y divide-gray-100 bg-white">
          {rows.length ? (
            rows.map((member) => {
              const displayName = getDisplayName(member);
              const initials = displayName
                .split(" ")
                .map((part) => part[0])
                .join("")
                .slice(0, 2)
                .toUpperCase();
              const role = normalizeOrgRole(member?.workspace_role);
              const rawRole = String(member?.workspace_role || "").toLowerCase();
              const isOwner = rawRole.includes("owner");
              const memberUserId = String(member?.org_user_id || member?.clerk_user_id || "").trim();
              const isSelf =
                Boolean(memberUserId) &&
                memberUserId === String(currentClerkUserId || "").trim();
              const canEditRole =
                canManageRoles &&
                Boolean(memberUserId) &&
                !isOwner &&
                !isSelf &&
                (currentIsOwner || !rawRole.includes("admin"));
              const canRemoveMember = canEditRole;
              const isRoleUpdating =
                roleUpdatingForUserId &&
                roleUpdatingForUserId === memberUserId;
              const isInvited = String(member?.status || "") === "invited";
              const joinedLabel = formatJoinedDate(member?.joined_at);

              return (
                <div
                  key={member.user_id || member.clerk_user_id || member.email}
                  className="flex items-center justify-between p-4 bg-white hover:bg-gray-50/50 transition-colors"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    {member.image_url && !isInvited ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={member.image_url}
                        alt={displayName}
                        className="h-9 w-9 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-sm font-medium text-slate-600">
                        {initials || "U"}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium text-gray-900">{displayName}</p>
                        {isInvited && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                            Pending
                          </span>
                        )}
                      </div>
                      <p className="truncate text-sm text-gray-500">
                        {member.email || "No email"}
                        {!isInvited && joinedLabel ? ` • Joined ${joinedLabel}` : ""}
                      </p>
                    </div>
                  </div>

                  <div className="ml-6 flex shrink-0 items-center gap-1.5">
                    {isInvited ? (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          className="border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                          onClick={() => handleResendInvite(member)}
                        >
                          <Mail className="mr-2 h-[14px] w-[14px]" />
                          Resend
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="text-gray-400 hover:text-gray-700"
                            >
                              <Settings className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem onSelect={() => handleResendInvite(member)}>
                              <Mail className="mr-2 h-4 w-4" />
                              Resend invite
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-red-600 focus:text-red-600"
                              onSelect={() => handleRemoveMember(member)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Remove user
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </>
                    ) : (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          className="border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                          onClick={() => handleOpenSignatureModal(member)}
                          disabled={!member?.user_id}
                          title={!member?.user_id ? "User profile not synced yet" : ""}
                        >
                          <PenLine className="mr-2 h-[14px] w-[14px]" />
                          Signature
                        </Button>
                        {canEditRole ? (
                          <div className="relative">
                            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-[14px] w-[14px] -translate-y-1/2 text-gray-600" />
                            <select
                              className="h-8 appearance-none rounded-md border border-gray-200 bg-white pl-3 pr-7 text-xs font-medium text-gray-700"
                              value={rawRole.includes("admin") ? "org:admin" : "org:member"}
                              onChange={(event) => handleRoleChange(member, event.target.value)}
                              disabled={Boolean(isRoleUpdating)}
                            >
                              <option value="org:member">Member</option>
                              {(currentIsOwner || !rawRole.includes("admin")) && (
                                <option value="org:admin">Admin</option>
                              )}
                            </select>
                          </div>
                        ) : (
                          <Badge
                            variant="secondary"
                            className="h-8 rounded-md border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-700"
                          >
                            {role}
                          </Badge>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="text-gray-400 hover:text-gray-700"
                              disabled={!canManageRoles}
                              title={canManageRoles ? "More actions" : "Only admins can manage members"}
                            >
                              <Settings className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem
                              className="text-red-600 focus:text-red-600"
                              disabled={!canRemoveMember}
                              onSelect={() => handleRemoveMember(member)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Remove user
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="px-4 py-8 text-sm text-slate-500">No members found.</div>
          )}
        </div>
      </section>

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
              <label htmlFor="invite-email" className="text-sm font-medium text-slate-700">
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
              <label htmlFor="invite-role" className="text-sm font-medium text-slate-700">
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

function BillingTab() {
  return (
    <section className="max-w-2xl rounded-lg bg-white p-6">
      <h2 className="text-2xl font-semibold text-slate-900">Billing</h2>
      <p className="mt-1 text-sm text-slate-600">Manage your subscription.</p>

      <div className="mt-6 max-w-xl rounded-lg border border-slate-200 p-5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-700">Plan:</span>
          <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
            Free Beta
          </Badge>
        </div>
        <p className="mt-3 text-sm text-slate-600">
          You are currently on the free beta plan.
        </p>
        <Button disabled className="mt-4 bg-slate-200 text-slate-500 hover:bg-slate-200">
          Manage Subscription
        </Button>
      </div>
    </section>
  );
}

function EmailSettings({
  enabled,
  onEnabledChange,
  subjectTemplate,
  onSubjectTemplateChange,
  bodyTextTemplate,
  onBodyTextTemplateChange,
  saving,
  onSave,
}) {
  const [messageModalOpen, setMessageModalOpen] = useState(false);
  const [draftSubject, setDraftSubject] = useState(subjectTemplate || "");
  const [draftBody, setDraftBody] = useState(bodyTextTemplate || "");

  useEffect(() => {
    setDraftSubject(subjectTemplate || "");
  }, [subjectTemplate]);

  useEffect(() => {
    setDraftBody(bodyTextTemplate || "");
  }, [bodyTextTemplate]);

  const handleToggleEnabled = useCallback(
    async (nextValue) => {
      onEnabledChange(nextValue);
      await onSave({ enabled: nextValue });
    },
    [onEnabledChange, onSave]
  );

  const handleSaveMessage = useCallback(async () => {
    onSubjectTemplateChange(draftSubject);
    onBodyTextTemplateChange(draftBody);
    await onSave({
      subject_template: draftSubject,
      body_text_template: draftBody,
    });
    setMessageModalOpen(false);
  }, [draftBody, draftSubject, onBodyTextTemplateChange, onSave, onSubjectTemplateChange]);

  return (
    <section className="max-w-4xl rounded-lg bg-white">
      <div className="border-b border-slate-200 px-6 py-5">
        <h2 className="text-2xl font-semibold text-slate-900">Email &amp; Template</h2>
        <p className="mt-1 text-sm text-slate-600">
          Configure auto-reply behavior and prepare reusable email template settings.
        </p>
      </div>

      <div className="divide-y divide-gray-100 px-6">
        <div className="grid grid-cols-1 gap-6 py-6 md:grid-cols-3">
          <div>
            <h3 className="font-medium text-gray-900">Enable Auto-Reply</h3>
            <p className="mt-1 text-sm text-gray-500">
              Automatically send a response when new customers contact you via email.
            </p>
          </div>
          <div className="md:col-span-2">
            <div className="flex items-center justify-end">
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                onClick={() => handleToggleEnabled(!enabled)}
                disabled={saving}
                className={cn(
                  "relative inline-flex h-7 w-12 items-center rounded-full transition",
                  enabled ? "bg-emerald-500" : "bg-slate-300",
                  saving && "cursor-not-allowed opacity-70"
                )}
              >
                <span
                  className={cn(
                    "inline-block h-5 w-5 transform rounded-full bg-white transition",
                    enabled ? "translate-x-6" : "translate-x-1"
                  )}
                />
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 py-6 md:grid-cols-3">
          <div>
            <h3 className="font-medium text-gray-900">Auto-Reply Message</h3>
            <p className="mt-1 text-sm text-gray-500">
              Message sent to new customers. Click edit to update text and preview.
            </p>
          </div>
          <div className="md:col-span-2">
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                className="border border-gray-200 bg-white"
                onClick={() => setMessageModalOpen(true)}
                disabled={saving}
              >
                <PenLine className="mr-2 h-4 w-4" />
                Edit
              </Button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 py-6 md:grid-cols-3">
          <div>
            <h3 className="font-medium text-gray-900">Template</h3>
            <p className="mt-1 text-sm text-gray-500">
              Shared email template for layout and branding across replies.
            </p>
          </div>
          <div className="md:col-span-2">
            <div className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
              Coming soon
            </div>
            <p className="mt-2 text-sm text-slate-500">
              Template editor and live wrapper preview will be available here.
            </p>
          </div>
        </div>
      </div>

      <Dialog open={messageModalOpen} onOpenChange={setMessageModalOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PenLine className="h-4 w-4" />
              Auto-Reply Message
            </DialogTitle>
            <DialogDescription>
              This message will be sent automatically when a new customer contacts you by email.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Subject</label>
              <Input
                value={draftSubject}
                onChange={(event) => setDraftSubject(event.target.value)}
                placeholder="Tak for din henvendelse"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-slate-700">Message</label>
                <span className="text-xs text-slate-500">
                  {draftBody.length} / 2000 characters
                </span>
              </div>
              <textarea
                value={draftBody}
                onChange={(event) => setDraftBody(event.target.value.slice(0, 2000))}
                rows={8}
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              />
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-medium text-slate-800">Email Preview</h4>
              <div className="rounded-md border border-slate-200">
                <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600">
                  <div>From: Support Team &lt;support@yourcompany.com&gt;</div>
                  <div>To: customer@example.com</div>
                  <div>Subject: {draftSubject || "Tak for din henvendelse"}</div>
                </div>
                <div
                  className="p-4 text-sm text-slate-900"
                  dangerouslySetInnerHTML={{
                    __html: `<div style="white-space:pre-wrap;">${String(draftBody || "")
                      .replace(/</g, "&lt;")
                      .replace(/>/g, "&gt;")}</div>`,
                  }}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setMessageModalOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleSaveMessage} disabled={saving}>
              {saving ? "Saving..." : "Save Message"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ProfileTab({ user, isLoaded }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    if (!isLoaded || !user) return;
    setFirstName(user.firstName || "");
    setLastName(user.lastName || "");
  }, [isLoaded, user]);

  const email = user?.primaryEmailAddress?.emailAddress || "";
  const hasChanges =
    isLoaded &&
    Boolean(user) &&
    (firstName !== (user?.firstName || "") || lastName !== (user?.lastName || ""));

  const handleSaveProfile = async () => {
    if (!user || !hasChanges || savingProfile) return;
    setSavingProfile(true);
    try {
      await user.update({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      });
      toast.success("Profile updated.");
    } catch (error) {
      toast.error(error?.errors?.[0]?.longMessage || "Could not update profile.");
    } finally {
      setSavingProfile(false);
    }
  };

  if (!isLoaded) {
    return (
      <section className="max-w-2xl rounded-lg bg-white p-6">
        <div className="h-8 w-44 animate-pulse rounded bg-slate-200" />
        <div className="mt-2 h-4 w-64 animate-pulse rounded bg-slate-100" />
        <div className="mt-8 h-20 w-20 animate-pulse rounded-full bg-slate-200" />
      </section>
    );
  }

  return (
    <section className="max-w-2xl rounded-lg bg-white p-6">
      <h2 className="text-2xl font-semibold text-slate-900">Personal Profile</h2>
      <p className="mt-1 text-sm text-slate-600">Manage your account details.</p>

      <div className="mt-6 flex items-center gap-4">
        {user?.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.imageUrl}
            alt={user.fullName || "Profile avatar"}
            className="h-20 w-20 rounded-full object-cover ring-1 ring-slate-200"
          />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-200 text-xl font-semibold text-slate-600">
            {`${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase() || "U"}
          </div>
        )}
        <Button type="button" variant="outline">
          Change Avatar
        </Button>
      </div>

      <div className="mt-8 space-y-5">
        <div className="space-y-2">
          <label htmlFor="profile-first-name" className="text-sm font-medium text-slate-700">
            First Name
          </label>
          <Input
            id="profile-first-name"
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            placeholder="Enter first name"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="profile-last-name" className="text-sm font-medium text-slate-700">
            Last Name
          </label>
          <Input
            id="profile-last-name"
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            placeholder="Enter last name"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="profile-email" className="text-sm font-medium text-slate-700">
            Email Address
          </label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              id="profile-email"
              value={email}
              disabled
              readOnly
              className="bg-slate-100 pl-9 text-slate-600"
            />
          </div>
        </div>

        <Button
          onClick={handleSaveProfile}
          disabled={!hasChanges || savingProfile}
          className="bg-slate-900 text-white hover:bg-slate-800"
        >
          {savingProfile ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </section>
  );
}

export function SettingsPanel() {
  const supabase = useClerkSupabase();
  const { user, isLoaded } = useUser();
  const { orgId, orgRole } = useAuth();
  const [activeTab, setActiveTab] = useState("general");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [workspaceId, setWorkspaceId] = useState(null);
  const [shopId, setShopId] = useState(null);
  const [shopDomain, setShopDomain] = useState("");
  const [teamName, setTeamName] = useState("Sona Team");
  const [initialTeamName, setInitialTeamName] = useState("Sona Team");
  const [members, setMembers] = useState([]);
  const [workspaceCurrentRole, setWorkspaceCurrentRole] = useState("");
  const [canManageWorkspaceMembers, setCanManageWorkspaceMembers] = useState(false);
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [autoReplyTriggerMode, setAutoReplyTriggerMode] = useState("first_inbound_per_thread");
  const [autoReplyCooldownMinutes, setAutoReplyCooldownMinutes] = useState("1440");
  const [autoReplySubjectTemplate, setAutoReplySubjectTemplate] = useState("Tak for din henvendelse");
  const [autoReplyBodyTextTemplate, setAutoReplyBodyTextTemplate] = useState(
    "Hej,\n\nTak for din henvendelse. Vi har modtaget din besked og vender tilbage hurtigst muligt.\n\nMed venlig hilsen\nSona Team"
  );
  const [autoReplyBodyHtmlTemplate, setAutoReplyBodyHtmlTemplate] = useState("");
  const [autoReplyTemplateId, setAutoReplyTemplateId] = useState(null);
  const [autoReplyTemplateName, setAutoReplyTemplateName] = useState("Default template");
  const [autoReplyTemplateHtml, setAutoReplyTemplateHtml] = useState(
    "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#111\">{{content}}</div>"
  );
  const [savingAutoReply, setSavingAutoReply] = useState(false);

  const loadData = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      let supabaseUserId = null;
      const metadataUuid = user?.publicMetadata?.supabase_uuid;
      if (typeof metadataUuid === "string" && UUID_REGEX.test(metadataUuid)) {
        supabaseUserId = metadataUuid;
      }

      if (!supabaseUserId && user?.id) {
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("user_id")
          .eq("clerk_user_id", user.id)
          .maybeSingle();
        if (profileError) throw profileError;
        supabaseUserId = profile?.user_id ?? null;
      }

      let workspaceId = null;
      let workspaceName = null;
      if (orgId) {
        const { data: workspaceRow, error: workspaceError } = await supabase
          .from("workspaces")
          .select("id, name")
          .eq("clerk_org_id", orgId)
          .maybeSingle();
        if (workspaceError) throw workspaceError;
        workspaceId = workspaceRow?.id ?? null;
        workspaceName = workspaceRow?.name ?? null;
      }
      if (!workspaceId && user?.id) {
        const { data: membership, error: membershipError } = await supabase
          .from("workspace_members")
          .select("workspace_id")
          .eq("clerk_user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!membershipError) {
          workspaceId = membership?.workspace_id ?? null;
        }
        if (workspaceId) {
          const { data: workspaceRow, error: workspaceError } = await supabase
            .from("workspaces")
            .select("id, name")
            .eq("id", workspaceId)
            .maybeSingle();
          if (!workspaceError) {
            workspaceName = workspaceRow?.name ?? null;
          }
        }
      }

      let shopRow = null;
      let shopError = null;
      let latestShop = null;
      if (workspaceId) {
        latestShop = await supabase
          .from("shops")
          .select("id, owner_user_id, shop_domain")
          .eq("workspace_id", workspaceId)
          .is("uninstalled_at", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
      } else if (supabaseUserId) {
        latestShop = await supabase
          .from("shops")
          .select("id, owner_user_id, shop_domain")
          .eq("owner_user_id", supabaseUserId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
      } else {
        latestShop = { data: null, error: null };
      }
      shopRow = latestShop?.data ?? null;
      shopError = latestShop?.error ?? null;

      if (shopError) throw shopError;

      if (!workspaceId && !supabaseUserId) {
        setWorkspaceId(null);
        setShopId(null);
        setShopDomain("");
        setTeamName("Sona Team");
        setInitialTeamName("Sona Team");
        setMembers([]);
        setWorkspaceCurrentRole("");
        setCanManageWorkspaceMembers(false);
        return;
      }

      const resolvedTeamName =
        String(workspaceName || "").trim() ||
        String(shopRow?.shop_domain || "").replace(".myshopify.com", "") ||
        "Sona Team";

      setWorkspaceId(workspaceId ?? null);
      setShopId(shopRow?.id ?? null);
      setShopDomain(shopRow?.shop_domain ?? "");
      setTeamName(resolvedTeamName);
      setInitialTeamName(resolvedTeamName);

      const memberOwnerId = shopRow?.owner_user_id ?? supabaseUserId;
      if (workspaceId) {
        const membersResponse = await fetch("/api/settings/members", {
          method: "GET",
          cache: "no-store",
          credentials: "include",
        }).catch(() => null);
        if (!membersResponse?.ok) throw new Error("Could not load workspace members.");
        const membersPayload = await membersResponse.json().catch(() => ({}));
        setMembers(Array.isArray(membersPayload?.members) ? membersPayload.members : []);
        setWorkspaceCurrentRole(String(membersPayload?.current_role || ""));
        setCanManageWorkspaceMembers(Boolean(membersPayload?.can_manage_members));
      } else {
        const { data: profileRows, error: membersError } = await supabase
          .from("profiles")
          .select("user_id, first_name, last_name, email, image_url, signature")
          .eq("user_id", memberOwnerId)
          .order("created_at", { ascending: true });
        if (membersError) throw membersError;
        setMembers(Array.isArray(profileRows) ? profileRows : []);
        setWorkspaceCurrentRole("");
        setCanManageWorkspaceMembers(false);
      }

      const autoReplyResponse = await fetch("/api/settings/auto-reply", {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      }).catch(() => null);
      if (autoReplyResponse?.ok) {
        const payload = await autoReplyResponse.json().catch(() => ({}));
        const setting = payload?.setting || {};
        const template = payload?.template || {};
        setAutoReplyEnabled(Boolean(setting?.enabled));
        setAutoReplyTriggerMode(
          String(setting?.trigger_mode || "first_inbound_per_thread")
        );
        setAutoReplyCooldownMinutes(String(setting?.cooldown_minutes ?? 1440));
        setAutoReplySubjectTemplate(
          String(setting?.subject_template || "Tak for din henvendelse")
        );
        setAutoReplyBodyTextTemplate(
          String(
            setting?.body_text_template ||
              "Hej,\n\nTak for din henvendelse. Vi har modtaget din besked og vender tilbage hurtigst muligt.\n\nMed venlig hilsen\nSona Team"
          )
        );
        setAutoReplyBodyHtmlTemplate(String(setting?.body_html_template || ""));
        setAutoReplyTemplateId(template?.id || setting?.template_id || null);
        setAutoReplyTemplateName(String(template?.name || "Default template"));
        setAutoReplyTemplateHtml(
          String(
            template?.html_layout ||
              "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#111\">{{content}}</div>"
          )
        );
      }
    } catch (error) {
      console.error("Settings load failed:", error);
      toast.error("Could not load settings.");
    } finally {
      setLoading(false);
    }
  }, [orgId, supabase, user?.id, user?.publicMetadata?.supabase_uuid]);

  useEffect(() => {
    loadData().catch(() => null);
  }, [loadData]);

  const canSave = useMemo(
    () => String(teamName || "").trim() !== String(initialTeamName || "").trim(),
    [initialTeamName, teamName]
  );

  const handleSaveGeneral = useCallback(async () => {
    if (!supabase || !canSave || saving) return;

    setSaving(true);
    try {
      const nextTeamName = String(teamName || "").trim() || "Sona Team";
      if (workspaceId) {
        const { error } = await supabase.from("workspaces").update({ name: nextTeamName }).eq("id", workspaceId);
        if (error) throw error;
      } else if (shopId) {
        const { error } = await supabase.from("shops").update({ team_name: nextTeamName }).eq("id", shopId);
        if (error) throw error;
      } else {
        throw new Error("No workspace or shop found to save team name.");
      }
      setTeamName(nextTeamName);
      setInitialTeamName(nextTeamName);
      toast.success("Settings saved.");
    } catch (error) {
      if (error?.code === "42703") {
        toast.error("team_name column is missing in shops. Add it before saving.");
      } else {
        toast.error(error?.message || "Could not save settings.");
      }
    } finally {
      setSaving(false);
    }
  }, [canSave, saving, shopId, supabase, teamName, workspaceId]);

  const handleSaveAutoReply = useCallback(async (overrides = {}) => {
    if (savingAutoReply) return;
    setSavingAutoReply(true);
    try {
      const nextEnabled =
        typeof overrides.enabled === "boolean" ? overrides.enabled : autoReplyEnabled;
      const nextSubject = String(
        overrides.subject_template ?? autoReplySubjectTemplate ?? ""
      );
      const nextBodyText = String(
        overrides.body_text_template ?? autoReplyBodyTextTemplate ?? ""
      );
      const nextTriggerMode = String(
        overrides.trigger_mode ?? autoReplyTriggerMode ?? "first_inbound_per_thread"
      );
      const nextCooldownMinutes = Number(
        overrides.cooldown_minutes ?? autoReplyCooldownMinutes ?? 1440
      );
      const nextBodyHtml = String(
        overrides.body_html_template ?? autoReplyBodyHtmlTemplate ?? ""
      );
      const nextTemplateId = overrides.template_id ?? autoReplyTemplateId;
      const nextTemplateName = String(
        overrides.template_name ?? autoReplyTemplateName ?? "Default template"
      );
      const nextTemplateHtml = String(
        overrides.template_html ??
          autoReplyTemplateHtml ??
          "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#111\">{{content}}</div>"
      );

      const response = await fetch("/api/settings/auto-reply", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: nextEnabled,
          trigger_mode: nextTriggerMode,
          cooldown_minutes: nextCooldownMinutes,
          subject_template: nextSubject,
          body_text_template: nextBodyText,
          body_html_template: nextBodyHtml,
          template_id: nextTemplateId,
          template_name: nextTemplateName,
          template_html: nextTemplateHtml,
          template_text_fallback: nextBodyText,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Could not save auto reply settings.");
      setAutoReplyEnabled(nextEnabled);
      setAutoReplySubjectTemplate(nextSubject);
      setAutoReplyBodyTextTemplate(nextBodyText);
      setAutoReplyTriggerMode(nextTriggerMode);
      setAutoReplyCooldownMinutes(String(nextCooldownMinutes));
      setAutoReplyBodyHtmlTemplate(nextBodyHtml);
      setAutoReplyTemplateName(nextTemplateName);
      setAutoReplyTemplateHtml(nextTemplateHtml);
      setAutoReplyTemplateId(
        payload?.template?.id || payload?.setting?.template_id || nextTemplateId
      );
      toast.success("Auto reply settings saved.");
    } catch (error) {
      toast.error(error?.message || "Could not save auto reply settings.");
    } finally {
      setSavingAutoReply(false);
    }
  }, [
    autoReplyBodyHtmlTemplate,
    autoReplyBodyTextTemplate,
    autoReplyCooldownMinutes,
    autoReplyEnabled,
    autoReplySubjectTemplate,
    autoReplyTemplateHtml,
    autoReplyTemplateId,
    autoReplyTemplateName,
    autoReplyTriggerMode,
    savingAutoReply,
  ]);

  const renderContent = () => {
    if (loading) {
      return <TabSkeleton />;
    }

    switch (activeTab) {
      case "profile":
        return <ProfileTab user={user} isLoaded={isLoaded} />;
      case "members":
        return (
          <MembersTab
            members={members}
            currentOrgRole={workspaceCurrentRole || orgRole}
            currentClerkUserId={user?.id ?? null}
            canManageRoles={
              canManageWorkspaceMembers ||
              String(orgRole || "").toLowerCase().includes("admin") ||
              String(orgRole || "").toLowerCase().includes("owner")
            }
            onInviteCreated={loadData}
            onMembersChanged={loadData}
            onSignatureSaved={(userId, signature) => {
              setMembers((prev) =>
                prev.map((member) =>
                  member.user_id === userId ? { ...member, signature } : member
                )
              );
            }}
          />
        );
      case "billing":
        return <BillingTab />;
      case "email":
        return (
          <EmailSettings
            enabled={autoReplyEnabled}
            onEnabledChange={setAutoReplyEnabled}
            subjectTemplate={autoReplySubjectTemplate}
            onSubjectTemplateChange={setAutoReplySubjectTemplate}
            bodyTextTemplate={autoReplyBodyTextTemplate}
            onBodyTextTemplateChange={setAutoReplyBodyTextTemplate}
            saving={savingAutoReply}
            onSave={handleSaveAutoReply}
          />
        );
      case "general":
      default:
        return (
          <GeneralTab
            shopDomain={shopDomain}
            teamName={teamName}
            onTeamNameChange={setTeamName}
            onSave={handleSaveGeneral}
            saving={saving}
            canSave={canSave}
          />
        );
    }
  };

  return (
    <main className="bg-white px-4 py-6 lg:px-10 lg:py-10">
      <div className="grid gap-8 lg:grid-cols-[260px_1fr]">
        <aside className="space-y-7">
          {MENU_SECTIONS.map((section) => (
            <div key={section.label} className="space-y-2">
              <h3 className="px-2 text-xs font-semibold tracking-[0.12em] text-slate-500">
                {section.label}
              </h3>
              <nav className="space-y-1">
                {section.items.map((item) => {
                  const active = activeTab === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setActiveTab(item.key)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-base text-slate-600 hover:bg-slate-100",
                        active && "bg-slate-100 font-medium text-slate-900"
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>
          ))}
        </aside>

        {renderContent()}
      </div>
    </main>
  );
}
