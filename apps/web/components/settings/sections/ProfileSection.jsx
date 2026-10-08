"use client";

import { useUser } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StickySaveBar } from "@/components/ui/sticky-save-bar";
import { DEFAULT_THEME, THEME_OPTIONS, normalizeThemePreference } from "@/lib/theme-options";
import { cn } from "@/lib/utils";
import { Lock } from "lucide-react";
import { useTheme } from "next-themes";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

function ProfileTab({ user, isLoaded }) {
  const { setTheme } = useTheme();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [themePreference, setThemePreference] = useState(DEFAULT_THEME);
  const [initialThemePreference, setInitialThemePreference] = useState(DEFAULT_THEME);
  const themePreferenceRef = useRef(DEFAULT_THEME);
  const initialThemePreferenceRef = useRef(DEFAULT_THEME);
  const hasThemeInteractionRef = useRef(false);
  const setThemeRef = useRef(setTheme);
  const [themeLoading, setThemeLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    if (!isLoaded || !user) return;
    setFirstName(user.firstName || "");
    setLastName(user.lastName || "");
  }, [isLoaded, user]);

  useEffect(() => {
    if (!isLoaded || !user?.id) {
      setThemePreference(DEFAULT_THEME);
      setInitialThemePreference(DEFAULT_THEME);
      setThemeLoading(false);
      return;
    }

    let isActive = true;
    hasThemeInteractionRef.current = false;
    setThemeLoading(true);

    const loadThemePreference = async () => {
      try {
        const response = await fetch("/api/settings/theme", {
          method: "GET",
          cache: "no-store",
          credentials: "include",
        });
        if (!response.ok) throw new Error("Could not load theme settings.");
        const payload = await response.json().catch(() => ({}));
        const nextTheme = normalizeThemePreference(payload?.theme_preference, DEFAULT_THEME);
        if (!isActive) return;
        setInitialThemePreference(nextTheme);
        if (!hasThemeInteractionRef.current) {
          setThemePreference(nextTheme);
          setThemeRef.current(nextTheme);
        }
      } catch {
        if (!isActive) return;
        setInitialThemePreference(DEFAULT_THEME);
        if (!hasThemeInteractionRef.current) {
          setThemePreference(DEFAULT_THEME);
          setThemeRef.current(DEFAULT_THEME);
        }
      } finally {
        if (isActive) setThemeLoading(false);
      }
    };

    loadThemePreference().catch(() => null);

    return () => {
      isActive = false;
    };
  }, [isLoaded, user?.id]);

  const email = user?.primaryEmailAddress?.emailAddress || "";
  const hasNameChanges =
    firstName !== (user?.firstName || "") || lastName !== (user?.lastName || "");
  const hasThemeChanges = themePreference !== initialThemePreference;
  const hasChanges =
    isLoaded &&
    Boolean(user) &&
    (hasNameChanges || hasThemeChanges);

  useEffect(() => {
    themePreferenceRef.current = themePreference;
  }, [themePreference]);

  useEffect(() => {
    initialThemePreferenceRef.current = initialThemePreference;
  }, [initialThemePreference]);

  useEffect(() => {
    setThemeRef.current = setTheme;
  }, [setTheme]);

  const handleDiscardProfile = useCallback(() => {
    if (!user) return;
    hasThemeInteractionRef.current = true;
    setFirstName(user.firstName || "");
    setLastName(user.lastName || "");
    const nextTheme = initialThemePreference || DEFAULT_THEME;
    setThemePreference(nextTheme);
    setTheme(nextTheme);
  }, [initialThemePreference, setTheme, user]);

  useEffect(() => {
    return () => {
      if (themePreferenceRef.current !== initialThemePreferenceRef.current) {
        setThemeRef.current(initialThemePreferenceRef.current || DEFAULT_THEME);
      }
    };
  }, []);

  const handleSaveProfile = async () => {
    if (!user || !hasChanges || savingProfile) return;
    setSavingProfile(true);
    try {
      if (hasNameChanges) {
        await user.update({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
        });
      }

      if (hasThemeChanges) {
        const response = await fetch("/api/settings/theme", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ theme_preference: themePreference }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Could not save theme preference.");
        }
        const savedTheme = normalizeThemePreference(payload?.theme_preference, DEFAULT_THEME);
        setTheme(savedTheme);
        setThemePreference(savedTheme);
        setInitialThemePreference(savedTheme);
      }

      if (hasNameChanges && hasThemeChanges) {
        toast.success("Profile and theme updated.");
      } else if (hasThemeChanges) {
        toast.success("Theme updated.");
      } else {
        toast.success("Profile updated.");
      }
    } catch (error) {
      toast.error(
        error?.errors?.[0]?.longMessage || error?.message || "Could not update profile."
      );
    } finally {
      setSavingProfile(false);
    }
  };

  if (!isLoaded) {
    return (
      <section className="max-w-2xl rounded-lg bg-card p-6">
        <div className="h-8 w-44 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-4 w-64 animate-pulse rounded bg-muted" />
        <div className="mt-8 h-20 w-20 animate-pulse rounded-full bg-muted" />
      </section>
    );
  }

  return (
    <>
      <section className="w-full space-y-5">
        <div className="mb-6">
          <p className="text-xs font-bold uppercase tracking-wider text-primary">PROFILE</p>
          <h2 className="mt-1 text-page-heading font-semibold tracking-tight text-foreground">Personal Profile</h2>
          <p className="mt-1 text-sm text-muted-foreground">Manage your account details and preferences.</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-center gap-3">
          {user?.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.imageUrl}
              alt={user.fullName || "Profile avatar"}
              className="h-20 w-20 rounded-full object-cover ring-1 ring-border"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted text-2xl font-semibold text-muted-foreground">
              {`${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase() || "U"}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-2xl font-semibold text-foreground">
              {user?.fullName || `${firstName} ${lastName}`.trim() || "User"}
            </p>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">{email || "No email"}</p>
          </div>
          <Button type="button" variant="outline" className="ml-auto h-9 rounded-lg px-3.5 text-sm">
            Change Avatar
          </Button>
        </div>

        <div className="my-6 h-px bg-border" />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="profile-first-name" className="text-sm font-medium text-foreground">
                First Name
              </label>
              <Input
                id="profile-first-name"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                placeholder="Enter first name"
                className="h-11"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="profile-last-name" className="text-sm font-medium text-foreground">
                Last Name
              </label>
              <Input
                id="profile-last-name"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                placeholder="Enter last name"
                className="h-11"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="profile-email" className="text-sm font-medium text-foreground">
                Email Address
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="profile-email"
                  value={email}
                  disabled
                  readOnly
                  className="h-11 bg-muted pl-9 text-muted-foreground"
                />
              </div>
              <p className="text-xs text-muted-foreground">This is your login email and cannot be changed.</p>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium text-foreground">Theme</label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {THEME_OPTIONS.map((option) => {
                const selected = themePreference === option.id;
                const isDarkOption = option.id === "dark";
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={themeLoading || savingProfile}
                    onClick={() => {
                      hasThemeInteractionRef.current = true;
                      const nextTheme = normalizeThemePreference(option.id, DEFAULT_THEME);
                      setThemePreference(nextTheme);
                      setTheme(nextTheme);
                    }}
                    className={cn(
                      "rounded-xl border p-3 text-left transition-colors",
                      selected ? "border-primary ring-1 ring-primary/30" : "border-border hover:bg-muted",
                      themeLoading || savingProfile ? "cursor-not-allowed opacity-60" : ""
                    )}
                  >
                    <div
                      className={cn(
                        "h-20 rounded-lg border",
                        isDarkOption ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-slate-50"
                      )}
                    >
                      <div className="flex h-full items-start gap-2 p-2">
                        <div className={cn("h-full w-5 rounded", isDarkOption ? "bg-slate-800" : "bg-slate-200")} />
                        <div className="flex-1 space-y-2">
                          <div className={cn("h-4 w-20 rounded", isDarkOption ? "bg-slate-800" : "bg-slate-200")} />
                          <div className={cn("h-3 w-16 rounded", isDarkOption ? "bg-slate-800" : "bg-slate-200")} />
                        </div>
                      </div>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-foreground">{option.label}</p>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">Applies to the logged-in app only.</p>
          </div>
        </div>

        </div>
      </section>
      <StickySaveBar
        isVisible={hasChanges}
        isSaving={savingProfile || themeLoading}
        onSave={handleSaveProfile}
        onDiscard={handleDiscardProfile}
      />
    </>
  );
}

export function ProfileSection() {
  const { user, isLoaded } = useUser();
  return <ProfileTab user={user} isLoaded={isLoaded} />;
}
