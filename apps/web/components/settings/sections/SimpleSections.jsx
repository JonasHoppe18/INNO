"use client";

import { MailboxesSettingsTab } from "@/components/settings/MailboxesSettingsTab";
import { TagsSettings } from "@/components/settings/TagsSettings";
import { CustomerSatisfactionSettings } from "@/components/settings/CustomerSatisfactionSettings";
import { AutomationPanel } from "@/components/agent/AutomationPanel";
import { AutomationPageHeader } from "@/components/agent/AutomationPageHeader";
import { useSettingsWorkspace } from "@/components/settings/SettingsWorkspaceProvider";

export function MailboxesSection() {
  return <MailboxesSettingsTab />;
}

export function TagsSection() {
  return (
    <div className="w-full">
      <TagsSettings />
    </div>
  );
}

export function AutomationSection() {
  return (
    <AutomationPanel>
      <AutomationPageHeader />
    </AutomationPanel>
  );
}

export function CustomerSatisfactionSection() {
  const { workspace } = useSettingsWorkspace();
  return <CustomerSatisfactionSettings workspaceName={workspace.workspaceName} />;
}
