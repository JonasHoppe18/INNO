"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { Building2, CreditCard, FileSignature, Lock, User, Users2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EditSignatureModal } from "@/components/settings/EditSignatureModal";
import { useClerkSupabase } from "@/lib/useClerkSupabase";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

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

function MembersTab({ members, ownerUserId, onSignatureSaved }) {
  const inviteLink = "mailto:hello@sona-ai.dk?subject=Invite%20member%20to%20workspace";
  const [activeMember, setActiveMember] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  const handleOpenSignatureModal = (member) => {
    setActiveMember(member);
    setModalOpen(true);
  };

  return (
    <>
      <section className="max-w-2xl rounded-lg bg-white p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">Team Members</h2>
            <p className="mt-1 text-sm text-slate-600">Manage who has access.</p>
          </div>
          <Button asChild>
            <a href={inviteLink}>Invite Member</a>
          </Button>
        </div>

        <div className="mt-6 rounded-lg border border-slate-200 bg-white">
          {members.length ? (
            members.map((member) => {
              const displayName = getDisplayName(member);
              const initials = displayName
                .split(" ")
                .map((part) => part[0])
                .join("")
                .slice(0, 2)
                .toUpperCase();
              const role = member.user_id === ownerUserId ? "Owner" : "Member";

              return (
                <div key={member.user_id} className="flex items-center justify-between border-b px-4 py-4 last:border-b-0">
                  <div className="flex items-center gap-3">
                    {member.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={member.image_url}
                        alt={displayName}
                        className="h-9 w-9 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
                        {initials || "U"}
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-medium text-slate-900">{displayName}</p>
                      <p className="text-xs text-slate-500">{member.email || "No email"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{role}</Badge>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-gray-200 bg-white"
                      onClick={() => handleOpenSignatureModal(member)}
                    >
                      <FileSignature className="mr-1.5 h-3.5 w-3.5" />
                      Edit Signature
                    </Button>
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
  const [activeTab, setActiveTab] = useState("general");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [shopId, setShopId] = useState(null);
  const [ownerUserId, setOwnerUserId] = useState(null);
  const [shopDomain, setShopDomain] = useState("");
  const [teamName, setTeamName] = useState("Sona Team");
  const [initialTeamName, setInitialTeamName] = useState("Sona Team");
  const [members, setMembers] = useState([]);

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

      if (!supabaseUserId) {
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;
        supabaseUserId = authData?.user?.id ?? null;
      }

      if (!supabaseUserId) {
        setShopId(null);
        setOwnerUserId(null);
        setShopDomain("");
        setTeamName("Sona Team");
        setInitialTeamName("Sona Team");
        setMembers([]);
        return;
      }

      let shopRow = null;
      let shopError = null;
      const withTeamName = await supabase
        .from("shops")
        .select("id, owner_user_id, shop_domain, team_name")
        .eq("owner_user_id", supabaseUserId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      shopRow = withTeamName.data ?? null;
      shopError = withTeamName.error ?? null;

      if (shopError && shopError.code === "42703") {
        const fallback = await supabase
          .from("shops")
          .select("id, owner_user_id, shop_domain")
          .eq("owner_user_id", supabaseUserId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        shopRow = fallback.data ?? null;
        shopError = fallback.error ?? null;
      }

      if (shopError) throw shopError;

      const resolvedTeamName =
        String(shopRow?.team_name || "").trim() ||
        String(shopRow?.shop_domain || "").replace(".myshopify.com", "") ||
        "Sona Team";

      setShopId(shopRow?.id ?? null);
      setOwnerUserId(shopRow?.owner_user_id ?? supabaseUserId);
      setShopDomain(shopRow?.shop_domain ?? "");
      setTeamName(resolvedTeamName);
      setInitialTeamName(resolvedTeamName);

      const memberOwnerId = shopRow?.owner_user_id ?? supabaseUserId;
      const { data: profileRows, error: membersError } = await supabase
        .from("profiles")
        .select("user_id, first_name, last_name, email, image_url, signature")
        .eq("user_id", memberOwnerId)
        .order("created_at", { ascending: true });

      if (membersError) throw membersError;
      setMembers(Array.isArray(profileRows) ? profileRows : []);
    } catch (error) {
      console.error("Settings load failed:", error);
      toast.error("Could not load settings.");
    } finally {
      setLoading(false);
    }
  }, [supabase, user?.id, user?.publicMetadata?.supabase_uuid]);

  useEffect(() => {
    loadData().catch(() => null);
  }, [loadData]);

  const canSave = useMemo(
    () => String(teamName || "").trim() !== String(initialTeamName || "").trim(),
    [initialTeamName, teamName]
  );

  const handleSaveGeneral = useCallback(async () => {
    if (!supabase || !shopId || !canSave || saving) return;

    setSaving(true);
    try {
      const nextTeamName = String(teamName || "").trim() || "Sona Team";
      const { error } = await supabase.from("shops").update({ team_name: nextTeamName }).eq("id", shopId);
      if (error) throw error;
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
  }, [canSave, saving, shopId, supabase, teamName]);

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
            ownerUserId={ownerUserId}
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
