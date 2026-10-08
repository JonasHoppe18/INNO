"use client";

import { Badge } from "@/components/ui/badge";
import { SettingsGroup, SettingsPage, SettingsRow } from "@/components/settings/ui/settings-layout";

export function BillingSection() {
  return (
    <SettingsPage title="Billing" description="Manage your subscription and plan.">
      <SettingsGroup title="Plan">
        <SettingsRow
          label="Current plan"
          description="Your workspace has full beta access. Billing controls will become available before paid plans launch."
        >
          <Badge variant="success">Free Beta</Badge>
        </SettingsRow>
      </SettingsGroup>
    </SettingsPage>
  );
}
