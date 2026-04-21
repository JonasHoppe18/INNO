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
import {
  SUPPORTED_SUPPORT_LANGUAGE_CODES,
  SUPPORT_LANGUAGE_LABELS,
  normalizeSupportLanguage,
} from "@/lib/translation/languages";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StickySaveBar } from "@/components/ui/sticky-save-bar";

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

const DEFAULT_CLOSE_SUGGESTION_DELAY_HOURS = 24 * 14;

const normalizeCloseSuggestionDelayHours = (value, fallback = DEFAULT_CLOSE_SUGGESTION_DELAY_HOURS) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  return Math.max(1, Math.min(720, rounded));
};

const normalizeRoutingRows = (rows = []) =>
  (Array.isArray(rows) ? rows : [])
    .map((row, index) => {
      const id = String(row?.id || "").trim();
      const categoryKey = String(row?.category_key || "").trim().toLowerCase();
      if (!id || !categoryKey || categoryKey === "support") return null;
      return {
        id,
        category_key: categoryKey,
        label: String(row?.label || categoryKey).trim(),
        is_active: Boolean(row?.is_active),
        mode: String(row?.mode || "manual_approval") === "auto_forward" ? "auto_forward" : "manual_approval",
        forward_to_email: String(row?.forward_to_email || "").trim(),
        is_default: Boolean(row?.is_default),
        sort_order: Number.isFinite(Number(row?.sort_order)) ? Number(row.sort_order) : index * 10 + 10,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const orderDiff = Number(a.sort_order || 0) - Number(b.sort_order || 0);
      if (orderDiff !== 0) return orderDiff;
      return String(a.label || "").localeCompare(String(b.label || ""), "en", { sensitivity: "base" });
    });

const routingSnapshot = (rows = []) =>
  JSON.stringify(
    normalizeRoutingRows(rows).map((row) => ({
      id: row.id,
      category_key: row.category_key,
      label: String(row.label || "").trim(),
      is_active: Boolean(row.is_active),
      mode: String(row.mode || "manual_approval"),
      forward_to_email: String(row.forward_to_email || "").trim().toLowerCase(),
      sort_order: Number(row.sort_order || 0),
    }))
  );

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

function GeneralTab({
  shopDomain,
  teamName,
  onTeamNameChange,
  testMode,
  onTestModeChange,
  testEmail,
  onTestEmailChange,
  supportLanguage,
  onSupportLanguageChange,
  closeSuggestionDelayHours,
  onCloseSuggestionDelayHoursChange,
  hasWorkspaceScope,
  onSave,
  onReset,
  saving,
  canSave,
}) {
  return (
    <section className="max-w-5xl space-y-4">
      <div className="px-1">
        <p className="text-xs font-medium tracking-[0.08em] text-slate-500">SETTINGS / GENERAL</p>
        <h2 className="mt-1 text-3xl font-semibold text-slate-900">General</h2>
        <p className="mt-1 text-sm text-slate-600">Configure shared team settings.</p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h3 className="text-base font-semibold text-slate-900">Store Information</h3>
        <p className="mt-1 text-sm text-slate-500">Store connection and team profile details.</p>

        <div className="mt-5 grid grid-cols-1 gap-5">
          <div className="space-y-1.5">
            <label htmlFor="shop-url" className="text-xs font-semibold tracking-wide text-slate-500">
              SHOP URL
            </label>
            <div className="flex h-11 w-full max-w-xl items-center gap-2 rounded-md bg-slate-100 px-3 text-slate-700">
              <Lock className="h-4 w-4 text-slate-400" />
              <span className="truncate text-sm">{shopDomain || "No shop connected"}</span>
            </div>
            <p className="text-xs text-slate-500">Connected Shopify store (read-only).</p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="team-name" className="text-xs font-semibold tracking-wide text-slate-500">
              TEAM NAME
            </label>
            <Input
              id="team-name"
              value={teamName}
              onChange={(event) => onTeamNameChange(event.target.value)}
              placeholder="Enter your team name"
              className="h-11 w-full max-w-xl focus-visible:ring-2 focus-visible:ring-sky-500/40"
            />
            <p className="text-xs text-slate-500">
              This is your team&apos;s visible name within Sona.
            </p>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="support-language"
              className="text-xs font-semibold tracking-wide text-slate-500"
            >
              SUPPORT LANGUAGE
            </label>
            <Select
              value={supportLanguage}
              onValueChange={onSupportLanguageChange}
              disabled={!hasWorkspaceScope}
            >
              <SelectTrigger
                id="support-language"
                className="h-11 w-full max-w-xl text-sm text-slate-700 focus-visible:ring-2 focus-visible:ring-sky-500/40"
              >
                <SelectValue placeholder="Select language" />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_SUPPORT_LANGUAGE_CODES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {SUPPORT_LANGUAGE_LABELS[code]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-slate-500">
              This is the language your team prefers to read messages in. Translation views in
              the inbox will use this language.
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="close-suggestion-delay-hours" className="text-xs font-semibold tracking-wide text-slate-500">
              AUTO CLOSE (HOURS)
            </label>
            <Input
              id="close-suggestion-delay-hours"
              type="number"
              min={1}
              max={720}
              step={1}
              value={closeSuggestionDelayHours}
              onChange={(event) => onCloseSuggestionDelayHoursChange(event.target.value)}
              placeholder="336"
              className="h-11 w-full max-w-xl focus-visible:ring-2 focus-visible:ring-sky-500/40"
              disabled={!hasWorkspaceScope}
            />
            <p className="text-xs text-slate-500">
              Automatically close tickets after this many hours in Pending with no customer reply.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h3 className="text-base font-semibold text-slate-900">Test Mode</h3>
        <p className="mt-1 text-sm text-slate-500">
          Simulate actions without writing to Shopify, shipping providers, or other integrations.
        </p>

        <div className="mt-5 grid grid-cols-1 gap-4">
          <div className="flex items-center justify-between rounded-lg px-1 py-1">
            <span className="text-sm text-slate-500">
              Enable Test Mode
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(testMode)}
              onClick={() => onTestModeChange(!Boolean(testMode))}
              disabled={!hasWorkspaceScope}
              className={cn(
                "relative inline-flex h-7 w-12 items-center rounded-full transition",
                testMode ? "bg-[#F59E0B]" : "bg-slate-300",
                !hasWorkspaceScope && "cursor-not-allowed opacity-70"
              )}
            >
              <span
                className={cn(
                  "inline-block h-5 w-5 transform rounded-full bg-white transition",
                  testMode ? "translate-x-6" : "translate-x-1"
                )}
              />
            </button>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="test-email" className="text-xs font-semibold tracking-wide text-slate-500">
              TEST EMAIL ADDRESS
            </label>
            <Input
              id="test-email"
              type="email"
              value={testEmail}
              onChange={(event) => onTestEmailChange(event.target.value)}
              placeholder="qa@company.com"
              className="h-11 w-full max-w-xl focus-visible:ring-2 focus-visible:ring-sky-500/40"
              disabled={!hasWorkspaceScope}
            />
            <p className="text-xs text-slate-500">
              When set, all outgoing emails are redirected to this address while Test Mode is active.
            </p>
          </div>

        </div>
        {!hasWorkspaceScope ? (
          <p className="mt-3 text-xs text-amber-700">
            Test Mode settings require an organization workspace.
          </p>
        ) : null}
      </div>

      <div className="rounded-xl border border-red-200 bg-white p-6">
        <h3 className="text-base font-semibold text-red-700">Danger Zone</h3>
        <p className="mt-1 text-sm text-slate-500">
          Permanently delete this team and all data.
        </p>
        <div className="mt-4">
          <Button
            type="button"
            className="bg-red-600 text-white hover:bg-red-700"
          >
            Delete Team
          </Button>
        </div>
      </div>

      <StickySaveBar
        isVisible={canSave}
        isSaving={saving}
        onSave={onSave}
        onDiscard={onReset}
      />
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
  routingRows = [],
  onUpdateRoutingRow,
  onAddRoutingCategory,
  onDeleteRoutingCategory,
  canSave = false,
  onSaveChanges,
  onDiscardChanges,
  savingRouting = false,
  saving,
}) {
  const [messageModalOpen, setMessageModalOpen] = useState(false);
  const [draftSubject, setDraftSubject] = useState(subjectTemplate || "");
  const [draftBody, setDraftBody] = useState(bodyTextTemplate || "");
  const [addCategoryModalOpen, setAddCategoryModalOpen] = useState(false);
  const [newCategoryLabel, setNewCategoryLabel] = useState("");

  useEffect(() => {
    setDraftSubject(subjectTemplate || "");
  }, [subjectTemplate]);

  useEffect(() => {
    setDraftBody(bodyTextTemplate || "");
  }, [bodyTextTemplate]);

  const handleToggleEnabled = useCallback(
    (nextValue) => {
      onEnabledChange(nextValue);
    },
    [onEnabledChange]
  );

  const handleSaveMessage = useCallback(() => {
    onSubjectTemplateChange(draftSubject);
    onBodyTextTemplateChange(draftBody);
    setMessageModalOpen(false);
  }, [draftBody, draftSubject, onBodyTextTemplateChange, onSubjectTemplateChange]);

  const handleCreateCategory = useCallback(() => {
    const label = String(newCategoryLabel || "").trim();
    if (!label) return;
    onAddRoutingCategory?.(label);
    setNewCategoryLabel("");
    setAddCategoryModalOpen(false);
  }, [newCategoryLabel, onAddRoutingCategory]);

  const previewLines = String(bodyTextTemplate || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3);

  return (
    <section className="max-w-4xl rounded-lg bg-white">
      <div className="border-b border-slate-200 px-6 py-5">
        <h2 className="text-2xl font-semibold text-slate-900">Email &amp; Template</h2>
        <p className="mt-1 text-sm text-slate-600">
          Configure auto-reply behavior and prepare reusable email template settings.
        </p>
      </div>

      <div className="space-y-10 px-6 py-8">
        <div className="rounded-xl border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(260px,40%)_1fr] md:items-center">
            <div>
              <h3 className="font-medium text-gray-900">Enable Auto-Reply</h3>
              <p className="mt-1 text-sm text-gray-500">
                Automatically send a response when new customers contact you via email.
              </p>
            </div>
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

        <div className="rounded-xl border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(260px,40%)_1fr]">
            <div className="min-w-0">
              <h3 className="font-medium text-gray-900">Auto-Reply Message</h3>
              <p className="mt-1 text-sm text-gray-500">
                Message sent to new customers. Click edit to update text and preview.
              </p>
            </div>
            <div className="min-w-0 space-y-3">
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
              <div className="min-w-0 rounded-xl border border-[#E5E7EB] bg-white p-4">
                <p className="text-xs font-medium tracking-wide text-slate-500">Preview</p>
                <p className="mt-2 text-sm font-medium text-slate-900">
                  {subjectTemplate || "Tak for din henvendelse"}
                </p>
                <div className="mt-2 space-y-1 text-sm text-slate-600">
                  {previewLines.length ? (
                    previewLines.map((line, index) => (
                      <p key={`${line}-${index}`} className="break-words">
                        {line}
                      </p>
                    ))
                  ) : (
                    <p className="text-slate-400">No message set yet.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[#E5E7EB] bg-white p-6 opacity-50 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(260px,40%)_1fr] md:items-start">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-gray-900">Template</h3>
                <div className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                  Coming soon
                </div>
              </div>
              <p className="mt-1 text-sm text-gray-500">
                Shared email template for layout and branding across replies.
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-500">
                Template editor and live wrapper preview will be available here.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="space-y-5">
            <div className="max-w-3xl">
              <h3 className="font-medium text-gray-900">Email Routing</h3>
              <p className="mt-1 text-sm text-gray-500">
                Automatically detect non-support emails and route them to the right team.
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Emails that don&apos;t match an active category stay in your Sona inbox.
              </p>
              <p className="mt-1 text-xs text-slate-500">Support emails are always handled in Sona.</p>
            </div>
            <div className="space-y-3">
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  disabled={savingRouting}
                  onClick={() => setAddCategoryModalOpen(true)}
                >
                  + Add email category
                </Button>
              </div>
              <div className="overflow-x-auto rounded-xl border border-[#F3F4F6]">
                <div>
                  <div className="grid grid-cols-[1.1fr_2fr_1.2fr_90px_44px] items-center gap-3 border-b border-[#F3F4F6] px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                    <span>Category</span>
                    <span>Forward to</span>
                    <span>Mode</span>
                    <span className="text-right">Status</span>
                    <span />
                  </div>
                  {routingRows.map((row) => (
                    <div
                      key={row.id}
                      className="grid grid-cols-[1.1fr_2fr_1.2fr_90px_44px] items-center gap-3 border-b border-[#F3F4F6] px-4 py-3 last:border-b-0"
                    >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">{row.label}</span>
                    </div>
                    <Input
                      type="email"
                      placeholder="forward@company.com"
                      value={row.forward_to_email || ""}
                      onChange={(event) =>
                        onUpdateRoutingRow?.({
                          ...row,
                          forward_to_email: event.target.value,
                        })
                      }
                      className="h-9 w-full border-transparent bg-transparent text-sm hover:border-[#E5E7EB] focus:border-[#E5E7EB] focus-visible:ring-0"
                      disabled={savingRouting}
                    />
                    <Select
                      value={row.mode || "manual_approval"}
                      onValueChange={(value) =>
                        onUpdateRoutingRow?.({
                          ...row,
                          mode: value,
                        })
                      }
                      disabled={savingRouting}
                    >
                      <SelectTrigger className="h-9 border-transparent bg-transparent text-sm hover:border-[#E5E7EB] focus:border-[#E5E7EB] focus:ring-0">
                        <SelectValue placeholder="Mode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manual_approval">Manual approval</SelectItem>
                        <SelectItem value="auto_forward">Auto forward</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={Boolean(row.is_active)}
                        onClick={() =>
                          onUpdateRoutingRow?.({
                            ...row,
                            is_active: !Boolean(row.is_active),
                          })
                        }
                        disabled={savingRouting}
                        className={cn(
                          "relative inline-flex h-7 w-12 items-center rounded-full transition",
                          row.is_active ? "bg-emerald-500" : "bg-slate-300",
                          savingRouting && "cursor-not-allowed opacity-70"
                        )}
                      >
                        <span
                          className={cn(
                            "inline-block h-5 w-5 transform rounded-full bg-white transition",
                            row.is_active ? "translate-x-6" : "translate-x-1"
                          )}
                        />
                      </button>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-slate-500 hover:text-red-600"
                      disabled={savingRouting}
                      onClick={() => onDeleteRoutingCategory?.(row)}
                      title="Delete category"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    </div>
                  ))}
                </div>
              </div>
              <p className="text-xs text-slate-500">
                If a category is inactive, deleted, or has no forwarding email, messages remain in the normal inbox.
              </p>
            </div>
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
      <Dialog
        open={addCategoryModalOpen}
        onOpenChange={(next) => {
          setAddCategoryModalOpen(next);
          if (!next) setNewCategoryLabel("");
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add category</DialogTitle>
            <DialogDescription>
              Create a custom inbound routing category.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Category name</label>
            <Input
              value={newCategoryLabel}
              onChange={(event) => setNewCategoryLabel(event.target.value)}
              placeholder="e.g. Press"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setAddCategoryModalOpen(false);
                setNewCategoryLabel("");
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleCreateCategory}
              disabled={!String(newCategoryLabel || "").trim()}
            >
              Create category
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <StickySaveBar
        isVisible={canSave}
        isSaving={saving || savingRouting}
        onSave={onSaveChanges}
        onDiscard={onDiscardChanges}
      />
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
  const [testMode, setTestMode] = useState(false);
  const [initialTestMode, setInitialTestMode] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [initialTestEmail, setInitialTestEmail] = useState("");
  const [supportLanguage, setSupportLanguage] = useState("en");
  const [initialSupportLanguage, setInitialSupportLanguage] = useState("en");
  const [closeSuggestionDelayHours, setCloseSuggestionDelayHours] = useState(
    String(DEFAULT_CLOSE_SUGGESTION_DELAY_HOURS)
  );
  const [initialCloseSuggestionDelayHours, setInitialCloseSuggestionDelayHours] = useState(
    String(DEFAULT_CLOSE_SUGGESTION_DELAY_HOURS)
  );
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
  const [emailRoutingRows, setEmailRoutingRows] = useState([]);
  const [savingEmailRouting, setSavingEmailRouting] = useState(false);
  const [initialAutoReplyEnabled, setInitialAutoReplyEnabled] = useState(false);
  const [initialAutoReplyTriggerMode, setInitialAutoReplyTriggerMode] = useState("first_inbound_per_thread");
  const [initialAutoReplyCooldownMinutes, setInitialAutoReplyCooldownMinutes] = useState("1440");
  const [initialAutoReplySubjectTemplate, setInitialAutoReplySubjectTemplate] = useState(
    "Tak for din henvendelse"
  );
  const [initialAutoReplyBodyTextTemplate, setInitialAutoReplyBodyTextTemplate] = useState(
    "Hej,\n\nTak for din henvendelse. Vi har modtaget din besked og vender tilbage hurtigst muligt.\n\nMed venlig hilsen\nSona Team"
  );
  const [initialAutoReplyBodyHtmlTemplate, setInitialAutoReplyBodyHtmlTemplate] = useState("");
  const [initialAutoReplyTemplateId, setInitialAutoReplyTemplateId] = useState(null);
  const [initialAutoReplyTemplateName, setInitialAutoReplyTemplateName] = useState("Default template");
  const [initialAutoReplyTemplateHtml, setInitialAutoReplyTemplateHtml] = useState(
    "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#111\">{{content}}</div>"
  );
  const [initialEmailRoutingRows, setInitialEmailRoutingRows] = useState([]);
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
        let workspaceLookup = await supabase
          .from("workspaces")
          .select("id, name, support_language")
          .eq("clerk_org_id", orgId)
          .maybeSingle();
        if (workspaceLookup.error?.code === "42703") {
          workspaceLookup = await supabase
            .from("workspaces")
            .select("id, name")
            .eq("clerk_org_id", orgId)
            .maybeSingle();
        }
        const workspaceRow = workspaceLookup.data;
        const workspaceError = workspaceLookup.error;
        if (workspaceError) throw workspaceError;
        workspaceId = workspaceRow?.id ?? null;
        workspaceName = workspaceRow?.name ?? null;
        setSupportLanguage(normalizeSupportLanguage(workspaceRow?.support_language || "en"));
        setInitialSupportLanguage(normalizeSupportLanguage(workspaceRow?.support_language || "en"));
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
          let workspaceLookup = await supabase
            .from("workspaces")
            .select("id, name, support_language")
            .eq("id", workspaceId)
            .maybeSingle();
          if (workspaceLookup.error?.code === "42703") {
            workspaceLookup = await supabase
              .from("workspaces")
              .select("id, name")
              .eq("id", workspaceId)
              .maybeSingle();
          }
          const workspaceRow = workspaceLookup.data;
          const workspaceError = workspaceLookup.error;
          if (!workspaceError) {
            workspaceName = workspaceRow?.name ?? null;
            setSupportLanguage(normalizeSupportLanguage(workspaceRow?.support_language || "en"));
            setInitialSupportLanguage(normalizeSupportLanguage(workspaceRow?.support_language || "en"));
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
        setTestMode(false);
        setInitialTestMode(false);
        setTestEmail("");
        setInitialTestEmail("");
        setSupportLanguage("en");
        setInitialSupportLanguage("en");
        setCloseSuggestionDelayHours(String(DEFAULT_CLOSE_SUGGESTION_DELAY_HOURS));
        setInitialCloseSuggestionDelayHours(String(DEFAULT_CLOSE_SUGGESTION_DELAY_HOURS));
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
      setTestMode(false);
      setInitialTestMode(false);
      setTestEmail("");
      setInitialTestEmail("");
      setCloseSuggestionDelayHours(String(DEFAULT_CLOSE_SUGGESTION_DELAY_HOURS));
      setInitialCloseSuggestionDelayHours(String(DEFAULT_CLOSE_SUGGESTION_DELAY_HOURS));
      if (!workspaceId) {
        setSupportLanguage("en");
        setInitialSupportLanguage("en");
        setCloseSuggestionDelayHours(String(DEFAULT_CLOSE_SUGGESTION_DELAY_HOURS));
        setInitialCloseSuggestionDelayHours(String(DEFAULT_CLOSE_SUGGESTION_DELAY_HOURS));
      }

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

      if (workspaceId) {
        const testModeResponse = await fetch("/api/settings/test-mode", {
          method: "GET",
          cache: "no-store",
          credentials: "include",
        }).catch(() => null);
        if (testModeResponse?.ok) {
          const testModePayload = await testModeResponse.json().catch(() => ({}));
          const resolvedTestMode = Boolean(testModePayload?.test_mode);
          const resolvedTestEmail = String(testModePayload?.test_email || "").trim();
          const resolvedSupportLanguage = normalizeSupportLanguage(
            testModePayload?.support_language || "en"
          );
          const resolvedCloseSuggestionDelayHours = String(
            normalizeCloseSuggestionDelayHours(testModePayload?.close_suggestion_delay_hours)
          );
          setTestMode(resolvedTestMode);
          setInitialTestMode(resolvedTestMode);
          setTestEmail(resolvedTestEmail);
          setInitialTestEmail(resolvedTestEmail);
          setSupportLanguage(resolvedSupportLanguage);
          setInitialSupportLanguage(resolvedSupportLanguage);
          setCloseSuggestionDelayHours(resolvedCloseSuggestionDelayHours);
          setInitialCloseSuggestionDelayHours(resolvedCloseSuggestionDelayHours);
        }
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
        setInitialAutoReplyEnabled(Boolean(setting?.enabled));
        setAutoReplyTriggerMode(
          String(setting?.trigger_mode || "first_inbound_per_thread")
        );
        setInitialAutoReplyTriggerMode(
          String(setting?.trigger_mode || "first_inbound_per_thread")
        );
        setAutoReplyCooldownMinutes(String(setting?.cooldown_minutes ?? 1440));
        setInitialAutoReplyCooldownMinutes(String(setting?.cooldown_minutes ?? 1440));
        setAutoReplySubjectTemplate(
          String(setting?.subject_template || "Tak for din henvendelse")
        );
        setInitialAutoReplySubjectTemplate(
          String(setting?.subject_template || "Tak for din henvendelse")
        );
        setAutoReplyBodyTextTemplate(
          String(
            setting?.body_text_template ||
              "Hej,\n\nTak for din henvendelse. Vi har modtaget din besked og vender tilbage hurtigst muligt.\n\nMed venlig hilsen\nSona Team"
          )
        );
        setInitialAutoReplyBodyTextTemplate(
          String(
            setting?.body_text_template ||
              "Hej,\n\nTak for din henvendelse. Vi har modtaget din besked og vender tilbage hurtigst muligt.\n\nMed venlig hilsen\nSona Team"
          )
        );
        setAutoReplyBodyHtmlTemplate(String(setting?.body_html_template || ""));
        setInitialAutoReplyBodyHtmlTemplate(String(setting?.body_html_template || ""));
        setAutoReplyTemplateId(template?.id || setting?.template_id || null);
        setInitialAutoReplyTemplateId(template?.id || setting?.template_id || null);
        setAutoReplyTemplateName(String(template?.name || "Default template"));
        setInitialAutoReplyTemplateName(String(template?.name || "Default template"));
        setAutoReplyTemplateHtml(
          String(
            template?.html_layout ||
              "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#111\">{{content}}</div>"
          )
        );
        setInitialAutoReplyTemplateHtml(
          String(
            template?.html_layout ||
              "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#111\">{{content}}</div>"
          )
        );
      }

      const emailRoutingResponse = await fetch("/api/settings/email-routing", {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      }).catch(() => null);
      if (emailRoutingResponse?.ok) {
        const payload = await emailRoutingResponse.json().catch(() => ({}));
        const rows = Array.isArray(payload?.routes) ? payload.routes : [];
        const normalized = normalizeRoutingRows(rows);
        setEmailRoutingRows(normalized);
        setInitialEmailRoutingRows(normalized);
      } else {
        const fallbackRoutes = normalizeRoutingRows([]);
        setEmailRoutingRows(fallbackRoutes);
        setInitialEmailRoutingRows(fallbackRoutes);
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
    () =>
      String(teamName || "").trim() !== String(initialTeamName || "").trim() ||
      Boolean(testMode) !== Boolean(initialTestMode) ||
      String(testEmail || "").trim() !== String(initialTestEmail || "").trim() ||
      normalizeSupportLanguage(supportLanguage) !== normalizeSupportLanguage(initialSupportLanguage) ||
      normalizeCloseSuggestionDelayHours(closeSuggestionDelayHours) !==
        normalizeCloseSuggestionDelayHours(initialCloseSuggestionDelayHours),
    [
      closeSuggestionDelayHours,
      initialCloseSuggestionDelayHours,
      initialSupportLanguage,
      initialTeamName,
      teamName,
      initialTestMode,
      testMode,
      initialTestEmail,
      testEmail,
      supportLanguage,
    ]
  );

  const handleSaveGeneral = useCallback(async () => {
    if (!supabase || !canSave || saving) return;

    setSaving(true);
    try {
      const nextTeamName = String(teamName || "").trim() || "Sona Team";
      const nextTestMode = Boolean(testMode);
      const nextTestEmail = String(testEmail || "").trim() || null;
      const nextSupportLanguage = normalizeSupportLanguage(supportLanguage, "en");
      const nextCloseSuggestionDelayHours = normalizeCloseSuggestionDelayHours(
        closeSuggestionDelayHours
      );
      if (workspaceId) {
        const { error: workspaceNameError } = await supabase
          .from("workspaces")
          .update({ name: nextTeamName })
          .eq("id", workspaceId);
        if (workspaceNameError) throw workspaceNameError;

        const testModeResponse = await fetch("/api/settings/test-mode", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            test_mode: nextTestMode,
            test_email: nextTestEmail,
            support_language: nextSupportLanguage,
            close_suggestion_delay_hours: nextCloseSuggestionDelayHours,
          }),
        });
        const testModePayload = await testModeResponse.json().catch(() => ({}));
        if (!testModeResponse.ok) {
          throw new Error(testModePayload?.error || "Could not save test mode settings.");
        }
        const persistedSupportLanguage = normalizeSupportLanguage(
          testModePayload?.support_language || nextSupportLanguage
        );
        const persistedCloseSuggestionDelayHours = normalizeCloseSuggestionDelayHours(
          testModePayload?.close_suggestion_delay_hours,
          nextCloseSuggestionDelayHours
        );
        setSupportLanguage(persistedSupportLanguage);
        setInitialSupportLanguage(persistedSupportLanguage);
        setCloseSuggestionDelayHours(String(persistedCloseSuggestionDelayHours));
        setInitialCloseSuggestionDelayHours(String(persistedCloseSuggestionDelayHours));
      } else if (shopId) {
        const { error } = await supabase.from("shops").update({ team_name: nextTeamName }).eq("id", shopId);
        if (error) throw error;
      } else {
        throw new Error("No workspace or shop found to save team name.");
      }
      setTeamName(nextTeamName);
      setInitialTeamName(nextTeamName);
      setTestMode(nextTestMode);
      setInitialTestMode(nextTestMode);
      setTestEmail(nextTestEmail || "");
      setInitialTestEmail(nextTestEmail || "");
      if (!workspaceId) {
        setSupportLanguage(nextSupportLanguage);
        setInitialSupportLanguage(nextSupportLanguage);
        setCloseSuggestionDelayHours(String(DEFAULT_CLOSE_SUGGESTION_DELAY_HOURS));
        setInitialCloseSuggestionDelayHours(String(DEFAULT_CLOSE_SUGGESTION_DELAY_HOURS));
      }
      toast.success("Settings saved.");
    } catch (error) {
      if (error?.code === "42703") {
        toast.error("A required settings column is missing. Run the latest SQL schema updates.");
      } else {
        toast.error(error?.message || "Could not save settings.");
      }
    } finally {
      setSaving(false);
    }
  }, [
    canSave,
    saving,
    shopId,
    supabase,
    supportLanguage,
    closeSuggestionDelayHours,
    teamName,
    testEmail,
    testMode,
    workspaceId,
  ]);

  const handleResetGeneral = useCallback(() => {
    setTeamName(String(initialTeamName || "Sona Team"));
    setTestMode(Boolean(initialTestMode));
    setTestEmail(String(initialTestEmail || ""));
    setSupportLanguage(normalizeSupportLanguage(initialSupportLanguage, "en"));
    setCloseSuggestionDelayHours(
      String(normalizeCloseSuggestionDelayHours(initialCloseSuggestionDelayHours))
    );
  }, [
    initialCloseSuggestionDelayHours,
    initialSupportLanguage,
    initialTeamName,
    initialTestEmail,
    initialTestMode,
  ]);

  const handleSaveAutoReply = useCallback(async (overrides = {}, options = {}) => {
    const showToast = options?.showToast !== false;
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
      if (showToast) {
        toast.success("Auto reply settings saved.");
      }
      return { ok: true };
    } catch (error) {
      const message = error?.message || "Could not save auto reply settings.";
      if (showToast) {
        toast.error(message);
      }
      return { ok: false, error: message };
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

  const handleUpdateEmailRoutingRow = useCallback((row) => {
    const rowId = String(row?.id || "").trim();
    if (!rowId) return;
    setEmailRoutingRows((prev) =>
      prev.map((existing) =>
        existing.id === rowId
          ? {
              ...existing,
              label: String(row?.label || existing.label || "").trim(),
              is_active: Boolean(row?.is_active),
              mode: String(row?.mode || "manual_approval") === "auto_forward" ? "auto_forward" : "manual_approval",
              forward_to_email: String(row?.forward_to_email || ""),
              sort_order: Number.isFinite(Number(row?.sort_order))
                ? Number(row?.sort_order)
                : Number(existing.sort_order || 0),
            }
          : existing
      )
    );
  }, []);

  const handleAddEmailRoutingCategory = useCallback((label) => {
    const cleanLabel = String(label || "").trim();
    if (!cleanLabel) return;
    const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const maxSortOrder = normalizeRoutingRows(emailRoutingRows).reduce(
      (max, row) => Math.max(max, Number(row.sort_order || 0)),
      0
    );
    setEmailRoutingRows((prev) =>
      normalizeRoutingRows([
        ...prev,
        {
          id: tempId,
          category_key: tempId,
          label: cleanLabel,
          is_active: false,
          mode: "manual_approval",
          forward_to_email: "",
          is_default: false,
          sort_order: maxSortOrder + 10,
        },
      ])
    );
  }, [emailRoutingRows]);

  const handleDeleteEmailRoutingCategory = useCallback((row) => {
    const id = String(row?.id || "").trim();
    if (!id) return;
    if (!window.confirm(`Delete routing category "${row?.label || row?.category_key}"?`)) return;
    setEmailRoutingRows((prev) => prev.filter((entry) => String(entry?.id || "") !== id));
  }, []);

  const hasAutoReplyChanges = useMemo(() => {
    if (Boolean(autoReplyEnabled) !== Boolean(initialAutoReplyEnabled)) return true;
    if (String(autoReplyTriggerMode || "") !== String(initialAutoReplyTriggerMode || "")) return true;
    if (String(autoReplyCooldownMinutes || "") !== String(initialAutoReplyCooldownMinutes || "")) return true;
    if (String(autoReplySubjectTemplate || "") !== String(initialAutoReplySubjectTemplate || "")) return true;
    if (String(autoReplyBodyTextTemplate || "") !== String(initialAutoReplyBodyTextTemplate || "")) return true;
    if (String(autoReplyBodyHtmlTemplate || "") !== String(initialAutoReplyBodyHtmlTemplate || "")) return true;
    if (String(autoReplyTemplateId || "") !== String(initialAutoReplyTemplateId || "")) return true;
    if (String(autoReplyTemplateName || "") !== String(initialAutoReplyTemplateName || "")) return true;
    if (String(autoReplyTemplateHtml || "") !== String(initialAutoReplyTemplateHtml || "")) return true;
    return false;
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
    initialAutoReplyBodyHtmlTemplate,
    initialAutoReplyBodyTextTemplate,
    initialAutoReplyCooldownMinutes,
    initialAutoReplyEnabled,
    initialAutoReplySubjectTemplate,
    initialAutoReplyTemplateHtml,
    initialAutoReplyTemplateId,
    initialAutoReplyTemplateName,
    initialAutoReplyTriggerMode,
  ]);

  const hasRoutingChanges = useMemo(
    () => routingSnapshot(emailRoutingRows) !== routingSnapshot(initialEmailRoutingRows),
    [emailRoutingRows, initialEmailRoutingRows]
  );

  const canSaveEmailSettings = useMemo(() => {
    return hasAutoReplyChanges || hasRoutingChanges;
  }, [hasAutoReplyChanges, hasRoutingChanges]);

  const handleDiscardEmailSettings = useCallback(() => {
    setAutoReplyEnabled(Boolean(initialAutoReplyEnabled));
    setAutoReplyTriggerMode(String(initialAutoReplyTriggerMode || "first_inbound_per_thread"));
    setAutoReplyCooldownMinutes(String(initialAutoReplyCooldownMinutes || "1440"));
    setAutoReplySubjectTemplate(String(initialAutoReplySubjectTemplate || "Tak for din henvendelse"));
    setAutoReplyBodyTextTemplate(String(initialAutoReplyBodyTextTemplate || ""));
    setAutoReplyBodyHtmlTemplate(String(initialAutoReplyBodyHtmlTemplate || ""));
    setAutoReplyTemplateId(initialAutoReplyTemplateId || null);
    setAutoReplyTemplateName(String(initialAutoReplyTemplateName || "Default template"));
    setAutoReplyTemplateHtml(String(initialAutoReplyTemplateHtml || ""));
    setEmailRoutingRows(normalizeRoutingRows(initialEmailRoutingRows));
  }, [
    initialAutoReplyBodyHtmlTemplate,
    initialAutoReplyBodyTextTemplate,
    initialAutoReplyCooldownMinutes,
    initialAutoReplyEnabled,
    initialAutoReplySubjectTemplate,
    initialAutoReplyTemplateHtml,
    initialAutoReplyTemplateId,
    initialAutoReplyTemplateName,
    initialAutoReplyTriggerMode,
    initialEmailRoutingRows,
  ]);

  const handleSaveEmailSettings = useCallback(async () => {
    if (!canSaveEmailSettings || savingEmailRouting || savingAutoReply) return;
    setSavingEmailRouting(true);
    try {
      if (hasAutoReplyChanges) {
        const autoReplyResult = await handleSaveAutoReply(
          {
            enabled: autoReplyEnabled,
            trigger_mode: autoReplyTriggerMode,
            cooldown_minutes: autoReplyCooldownMinutes,
            subject_template: autoReplySubjectTemplate,
            body_text_template: autoReplyBodyTextTemplate,
            body_html_template: autoReplyBodyHtmlTemplate,
            template_id: autoReplyTemplateId,
            template_name: autoReplyTemplateName,
            template_html: autoReplyTemplateHtml,
            template_text_fallback: autoReplyBodyTextTemplate,
          },
          { showToast: false }
        );
        if (!autoReplyResult?.ok) {
          throw new Error(autoReplyResult?.error || "Could not save auto reply settings.");
        }
      }

      if (hasRoutingChanges) {
        const routingRows = normalizeRoutingRows(emailRoutingRows);
        const initialRows = normalizeRoutingRows(initialEmailRoutingRows);
        const currentIds = new Set(routingRows.map((row) => String(row.id)));
        const deletedRows = initialRows.filter((row) => !currentIds.has(String(row.id)));

        for (const row of deletedRows) {
          const response = await fetch("/api/settings/email-routing", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ id: row.id }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(payload?.error || "Could not delete email route.");
          }
        }

        for (const row of routingRows) {
          const label = String(row.label || "").trim();
          if (!label) {
            throw new Error("Category label is required.");
          }
          const isTemporary = String(row.id).startsWith("tmp_");
          const method = isTemporary ? "POST" : "PUT";
          const requestBody = isTemporary
            ? {
                label,
                is_active: Boolean(row.is_active),
                mode: String(row.mode || "manual_approval"),
                forward_to_email: String(row.forward_to_email || "").trim(),
                sort_order: Number(row.sort_order || 0),
              }
            : {
                id: row.id,
                label,
                is_active: Boolean(row.is_active),
                mode: String(row.mode || "manual_approval"),
                forward_to_email: String(row.forward_to_email || "").trim(),
                sort_order: Number(row.sort_order || 0),
              };
          const response = await fetch("/api/settings/email-routing", {
            method,
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(requestBody),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(payload?.error || "Could not save email route.");
          }
        }

        const refreshResponse = await fetch("/api/settings/email-routing", {
          method: "GET",
          cache: "no-store",
          credentials: "include",
        });
        const refreshPayload = await refreshResponse.json().catch(() => ({}));
        if (!refreshResponse.ok) {
          throw new Error(refreshPayload?.error || "Could not reload email routes.");
        }
        const persistedRows = normalizeRoutingRows(refreshPayload?.routes || []);
        setInitialEmailRoutingRows(persistedRows);
        setEmailRoutingRows(persistedRows);
      }

      if (hasAutoReplyChanges) {
        setInitialAutoReplyEnabled(Boolean(autoReplyEnabled));
        setInitialAutoReplyTriggerMode(String(autoReplyTriggerMode || "first_inbound_per_thread"));
        setInitialAutoReplyCooldownMinutes(String(autoReplyCooldownMinutes || "1440"));
        setInitialAutoReplySubjectTemplate(String(autoReplySubjectTemplate || ""));
        setInitialAutoReplyBodyTextTemplate(String(autoReplyBodyTextTemplate || ""));
        setInitialAutoReplyBodyHtmlTemplate(String(autoReplyBodyHtmlTemplate || ""));
        setInitialAutoReplyTemplateId(autoReplyTemplateId || null);
        setInitialAutoReplyTemplateName(String(autoReplyTemplateName || "Default template"));
        setInitialAutoReplyTemplateHtml(String(autoReplyTemplateHtml || ""));
      }
      toast.success("Email settings saved.");
    } catch (error) {
      toast.error(error?.message || "Could not save email settings.");
    } finally {
      setSavingEmailRouting(false);
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
    canSaveEmailSettings,
    emailRoutingRows,
    hasAutoReplyChanges,
    hasRoutingChanges,
    handleSaveAutoReply,
    initialEmailRoutingRows,
    savingAutoReply,
    savingEmailRouting,
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
            routingRows={emailRoutingRows}
            onUpdateRoutingRow={handleUpdateEmailRoutingRow}
            onAddRoutingCategory={handleAddEmailRoutingCategory}
            onDeleteRoutingCategory={handleDeleteEmailRoutingCategory}
            canSave={canSaveEmailSettings}
            onSaveChanges={handleSaveEmailSettings}
            onDiscardChanges={handleDiscardEmailSettings}
            savingRouting={savingEmailRouting}
            saving={savingAutoReply || savingEmailRouting}
          />
        );
      case "general":
      default:
        return (
          <GeneralTab
            shopDomain={shopDomain}
            teamName={teamName}
            onTeamNameChange={setTeamName}
            testMode={testMode}
            onTestModeChange={setTestMode}
            testEmail={testEmail}
            onTestEmailChange={setTestEmail}
            supportLanguage={supportLanguage}
            onSupportLanguageChange={setSupportLanguage}
            closeSuggestionDelayHours={closeSuggestionDelayHours}
            onCloseSuggestionDelayHoursChange={setCloseSuggestionDelayHours}
            hasWorkspaceScope={Boolean(workspaceId)}
            onSave={handleSaveGeneral}
            onReset={handleResetGeneral}
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
