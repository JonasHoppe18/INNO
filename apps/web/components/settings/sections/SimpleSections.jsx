"use client";

import { MailboxesSettingsTab } from "@/components/settings/MailboxesSettingsTab";
import { TagsSettings } from "@/components/settings/TagsSettings";
import { CustomerSatisfactionSettings } from "@/components/settings/CustomerSatisfactionSettings";
import { AutomationPanel } from "@/components/agent/AutomationPanel";
import { useSettingsWorkspace } from "@/components/settings/SettingsWorkspaceProvider";
import { SettingsPage } from "@/components/settings/ui/settings-layout";

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
    <SettingsPage
      width="wide"
      title="Actions & automation"
      description="Choose what Sona may draft, propose for approval, or carry out for your team."
    >
      <AutomationPanel />
    </SettingsPage>
  );
}

export function CustomerSatisfactionSection() {
  const { workspace } = useSettingsWorkspace();
  return <CustomerSatisfactionSettings workspaceName={workspace.workspaceName} />;
}
