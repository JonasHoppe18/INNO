"use client";

import { useUser } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TabSkeleton } from "@/components/settings/TabSkeleton";
import {
  SettingsGroup,
  SettingsPage,
  SettingsRow,
  SettingsSaveBar,
} from "@/components/settings/ui/settings-layout";
import { DEFAULT_THEME, THEME_OPTIONS, normalizeThemePreference } from "@/lib/theme-options";
import { cn } from "@/lib/utils";
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
    return <TabSkeleton />;
  }

  return (
    <SettingsPage title="Profile & appearance" description="Manage your account details and preferences.">
      <SettingsGroup title="Profile">
        <SettingsRow label="Avatar" description={user?.fullName || `${firstName} ${lastName}`.trim() || "User"}>
          <div className="flex items-center gap-3">
            {user?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.imageUrl}
                alt={user.fullName || "Profile avatar"}
                className="h-8 w-8 rounded-full object-cover ring-1 ring-border"
              />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                {`${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase() || "U"}
              </div>
            )}
            <Button type="button" variant="outline" size="sm">
              Change avatar
            </Button>
          </div>
        </SettingsRow>
        <SettingsRow label="First name" htmlFor="profile-first-name">
          <Input
            id="profile-first-name"
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            placeholder="Enter first name"
            className="h-8 text-input text-foreground md:text-sm"
          />
        </SettingsRow>
        <SettingsRow label="Last name" htmlFor="profile-last-name">
          <Input
            id="profile-last-name"
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            placeholder="Enter last name"
            className="h-8 text-input text-foreground md:text-sm"
          />
        </SettingsRow>
        <SettingsRow label="Email address" description="This is your login email and cannot be changed.">
          <span className="truncate text-sm text-muted-foreground">{email || "No email"}</span>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Appearance">
        <SettingsRow stacked label="Theme" description="Applies to the logged-in app only.">
          <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3">
            {THEME_OPTIONS.map((option) => {
              const selected = themePreference === option.id;
              const isDarkOption = option.id === "dark";
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={selected}
                  disabled={themeLoading || savingProfile}
                  onClick={() => {
                    hasThemeInteractionRef.current = true;
                    const nextTheme = normalizeThemePreference(option.id, DEFAULT_THEME);
                    setThemePreference(nextTheme);
                    setTheme(nextTheme);
                  }}
                  className={cn(
                    "rounded-lg border bg-card p-2 text-left transition-colors duration-150",
                    selected ? "border-primary ring-1 ring-primary/30" : "border-border hover:bg-muted",
                    themeLoading || savingProfile ? "cursor-not-allowed opacity-60" : ""
                  )}
                >
                  <div
                    className={cn(
                      "h-14 rounded-md border",
                      isDarkOption ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-slate-50"
                    )}
                  >
                    <div className="flex h-full items-start gap-1.5 p-1.5">
                      <div className={cn("h-full w-4 rounded", isDarkOption ? "bg-slate-800" : "bg-slate-200")} />
                      <div className="flex-1 space-y-1.5">
                        <div className={cn("h-3 w-16 rounded", isDarkOption ? "bg-slate-800" : "bg-slate-200")} />
                        <div className={cn("h-2.5 w-12 rounded", isDarkOption ? "bg-slate-800" : "bg-slate-200")} />
                      </div>
                    </div>
                  </div>
                  <p className="mt-1.5 text-sm font-medium text-foreground">{option.label}</p>
                </button>
              );
            })}
          </div>
        </SettingsRow>
      </SettingsGroup>

      <SettingsSaveBar
        visible={hasChanges}
        saving={savingProfile || themeLoading}
        onSave={handleSaveProfile}
        onDiscard={handleDiscardProfile}
      />
    </SettingsPage>
  );
}

export function ProfileSection() {
  const { user, isLoaded } = useUser();
  return <ProfileTab user={user} isLoaded={isLoaded} />;
}
