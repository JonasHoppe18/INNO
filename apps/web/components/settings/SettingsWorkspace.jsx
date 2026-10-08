"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { SettingsWorkspaceProvider, useSettingsWorkspace } from "@/components/settings/SettingsWorkspaceProvider";
import { TabSkeleton } from "@/components/settings/TabSkeleton";
import { SettingsRouteContext } from "@/components/settings/SettingsRouteContext";
import { GeneralSection } from "@/components/settings/sections/GeneralSection";
import { AiInstructionsSection } from "@/components/settings/sections/AiInstructionsSection";
import { EmailSection } from "@/components/settings/sections/email/EmailSection";
import { MembersSection } from "@/components/settings/sections/MembersSection";
import { ProfileSection } from "@/components/settings/sections/ProfileSection";
import { BillingSection } from "@/components/settings/sections/BillingSection";
import {
  AutomationSection,
  CustomerSatisfactionSection,
  MailboxesSection,
  TagsSection,
} from "@/components/settings/sections/SimpleSections";
import {
  DEFAULT_EMAIL_SECTION,
  decideSettingsPopState,
  parseSettingsPathname,
  settingsPath,
  withSearchParams,
} from "@/lib/settings/navigation";

const SECTION_COMPONENTS = {
  general: GeneralSection,
  members: MembersSection,
  mailboxes: MailboxesSection,
  tags: TagsSection,
  ai: AiInstructionsSection,
  automation: AutomationSection,
  email: EmailSection,
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
  const route = parseSettingsPathname(pathname) || { section: "general", emailSection: null };
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

  // Browser back/forward: same unsaved-changes question as the menu.
  const lastUrlRef = useRef("");
  useEffect(() => {
    lastUrlRef.current = `${window.location.pathname}${window.location.search}`;
  }, [pathname, searchParams]);
  useEffect(() => {
    const handlePopState = () => {
      const decision = decideSettingsPopState({
        previousUrl: lastUrlRef.current,
        nextUrl: `${window.location.pathname}${window.location.search}`,
        dirty: dirtyRef.current,
        confirm: (message) => window.confirm(message),
        restore: (url) => window.history.pushState(null, "", url),
      });
      if (decision === "discard") setDirty(false);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Client-side only: pushState keeps section switches instant (no server round trip).
  const navigate = useCallback(
    (section, emailSection = null) => {
      const leavingSection = section !== route.section;
      if (leavingSection && dirtyRef.current && !window.confirm("Discard your unsaved changes?")) return;
      if (leavingSection) setDirty(false);
      window.history.pushState(
        null,
        "",
        withSearchParams(settingsPath(section, emailSection), searchParams, ["tab", "section"])
      );
    },
    [route.section, searchParams]
  );

  const routeValue = useMemo(
    () => ({
      section: route.section,
      emailSection: route.emailSection || DEFAULT_EMAIL_SECTION,
      navigate,
      setDirty,
    }),
    [route.section, route.emailSection, navigate]
  );

  return (
    <SettingsWorkspaceProvider>
      <SettingsRouteContext.Provider value={routeValue}>
        <SettingsShell
          activeSection={route.section}
          onSelectSection={(key) => {
            if (key !== route.section) navigate(key);
          }}
        >
          <SettingsContent section={route.section} />
        </SettingsShell>
      </SettingsRouteContext.Provider>
    </SettingsWorkspaceProvider>
  );
}
