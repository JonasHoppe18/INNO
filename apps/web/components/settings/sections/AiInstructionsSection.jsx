"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { useSettingsDirty } from "@/components/settings/SettingsRouteContext";
import { useSettingsWorkspace } from "@/components/settings/SettingsWorkspaceProvider";
import {
  SettingsGroup,
  SettingsPage,
  SettingsRow,
  SettingsSaveBar,
} from "@/components/settings/ui/settings-layout";
import { resourcePayload } from "@/lib/settings/resource-map";
import { draftAfterSave } from "@/lib/settings/ai-instructions";

export function AiInstructionsSection() {
  const { resources, setResource } = useSettingsWorkspace();
  const [saved, setSaved] = useState(
    () => String(resourcePayload(resources, "/api/persona")?.persona?.instructions || "").trim()
  );
  const [draft, setDraft] = useState(saved);
  const [saving, setSaving] = useState(false);
  const dirty = draft.trim() !== saved;
  useSettingsDirty(dirty);

  const save = async () => {
    const submitted = draft;
    setSaving(true);
    try {
      const response = await fetch("/api/persona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ instructions: submitted }),
      });
      if (!response.ok) throw new Error("Could not save AI instructions.");
      const next = submitted.trim();
      setSaved(next);
      setDraft((current) => draftAfterSave({ draft: current, submitted, saved: next }));
      setResource("/api/persona", { persona: { instructions: next } });
      toast.success("AI instructions saved.");
    } catch (error) {
      toast.error(error?.message || "Could not save AI instructions.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsPage
      title="AI instructions"
      description="Define the shared brand context and tone Sona uses when drafting replies."
    >
      <SettingsGroup footer="Automation-specific behavior is configured separately under Automation.">
        <SettingsRow
          stacked
          label="AI prompt"
          description="Describe your brand and how your AI support agent should sound. This is the primary instruction the AI reads before every reply."
          htmlFor="settings-ai-prompt"
        >
          <Textarea
            id="settings-ai-prompt"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={`Example:\nWe are [brand], a Danish webshop selling [products]. Our tone is friendly and direct — we get to the point fast. Replies should be max 4 sentences. We always write in the customer's language.`}
            rows={14}
            className="min-h-[280px] resize-y text-input leading-relaxed text-foreground placeholder:text-muted-foreground/50 md:text-sm"
          />
        </SettingsRow>
      </SettingsGroup>
      <SettingsSaveBar visible={dirty} saving={saving} onSave={save} onDiscard={() => setDraft(saved)} />
    </SettingsPage>
  );
}
