"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { SettingsWorkspaceProvider, useSettingsWorkspace } from "@/components/settings/SettingsWorkspaceProvider";
import { TabSkeleton } from "@/components/settings/TabSkeleton";
import { SettingsRouteContext } from "@/components/settings/SettingsRouteContext";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { GeneralSection } from "@/components/settings/sections/GeneralSection";
import { AiInstructionsSection } from "@/components/settings/sections/AiInstructionsSection";
import {
  DEFAULT_EMAIL_SECTION,
  parseSettingsPathname,
  settingsPath,
  withSearchParams,
} from "@/lib/settings/navigation";

// Sections that have moved out of SettingsPanel.
const SECTION_COMPONENTS = {
  general: GeneralSection,
  ai: AiInstructionsSection,
};

function SettingsContent({ section }) {
  const { loading } = useSettingsWorkspace();
  if (loading) return <TabSkeleton />;
  const Section = SECTION_COMPONENTS[section];
  return Section ? <Section /> : <SettingsPanel />;
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
