"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { SettingsWorkspaceProvider, useSettingsWorkspace } from "@/components/settings/SettingsWorkspaceProvider";
import { MediaPickerProvider } from "@/components/media/MediaPicker";
import { TabSkeleton } from "@/components/settings/TabSkeleton";
import { SettingsRouteContext } from "@/components/settings/SettingsRouteContext";
import { GeneralSection } from "@/components/settings/sections/GeneralSection";
import { AiInstructionsSection } from "@/components/settings/sections/AiInstructionsSection";
import { ConfirmationEmailSection, InboxRulesSection } from "@/components/settings/sections/email/EmailSection";
import { MembersSection } from "@/components/settings/sections/MembersSection";
import { BrandSection } from "@/components/settings/sections/BrandSection";
import { ProfileSection } from "@/components/settings/sections/ProfileSection";
import { BillingSection } from "@/components/settings/sections/BillingSection";
import {
  AutomationSection,
  CustomerSatisfactionSection,
  MailboxesSection,
} from "@/components/settings/sections/SimpleSections";
import {
  decideSettingsPopState,
  parseSettingsPathname,
  settingsPath,
  withSearchParams,
} from "@/lib/settings/navigation";

const SECTION_COMPONENTS = {
  general: GeneralSection,
  members: MembersSection,
  brand: BrandSection,
  mailboxes: MailboxesSection,
  ai: AiInstructionsSection,
  automation: AutomationSection,
  "inbox-rules": InboxRulesSection,
  "confirmation-email": ConfirmationEmailSection,
  "customer-satisfaction": CustomerSatisfactionSection,
  profile: ProfileSection,
  billing: BillingSection,
};

function SettingsContent({ section }) {
  const { loading } = useSettingsWorkspace();
  if (loading) return <TabSkeleton />;
  const Section = SECTION_COMPONENTS[section] || GeneralSection;
  return <Section />;
}

export function SettingsWorkspace() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const route = useMemo(
    () => parseSettingsPathname(pathname) || { section: "general" },
    [pathname]
  );
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  useEffect(() => {
    if (!dirty) return undefined;
    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  // The rendered section follows the URL only after the unsaved-changes check, so
  // browser back/forward cannot unmount a dirty section before the user answers.
  const [active, setActive] = useState(route);
  const activeUrlRef = useRef("");
  useLayoutEffect(() => {
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (route.section === active.section) {
      activeUrlRef.current = currentUrl;
      return;
    }
    const decision = decideSettingsPopState({
      previousUrl: activeUrlRef.current,
      nextUrl: currentUrl,
      dirty: dirtyRef.current,
      confirm: (message) => window.confirm(message),
      restore: (url) => window.history.pushState(null, "", url),
    });
    if (decision === "restore") return;
    if (decision === "discard") {
      dirtyRef.current = false;
      setDirty(false);
    }
    activeUrlRef.current = currentUrl;
    setActive(route);
  }, [route, active, searchParams]);

  // Client-side only: pushState keeps section switches instant (no server round trip).
  const navigate = useCallback(
    (section) => {
      const leavingSection = section !== active.section;
      if (leavingSection && dirtyRef.current) {
        if (!window.confirm("Discard your unsaved changes?")) return;
        // Already confirmed here; the URL check above must not ask again.
        dirtyRef.current = false;
        setDirty(false);
      }
      window.history.pushState(
        null,
        "",
        withSearchParams(settingsPath(section), searchParams, ["tab", "section"])
      );
    },
    [active.section, searchParams]
  );

  const routeValue = useMemo(
    () => ({
      section: active.section,
      navigate,
      setDirty,
    }),
    [active.section, navigate]
  );

  return (
    <SettingsWorkspaceProvider>
      <MediaPickerProvider>
        <SettingsRouteContext.Provider value={routeValue}>
          <SettingsShell
            activeSection={active.section}
            onSelectSection={(key) => {
              if (key !== active.section) navigate(key);
            }}
          >
            <SettingsContent section={active.section} />
          </SettingsShell>
        </SettingsRouteContext.Provider>
      </MediaPickerProvider>
    </SettingsWorkspaceProvider>
  );
}
