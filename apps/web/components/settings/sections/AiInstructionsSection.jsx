"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useSettingsWorkspace } from "@/components/settings/SettingsWorkspaceProvider";
import { resourcePayload } from "@/lib/settings/resource-map";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Bot, PenLine } from "lucide-react";

function AiPromptModal({ value, onChange, onSave, saving }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  const handleOpen = () => {
    setDraft(value);
    setOpen(true);
  };

  const handleSave = async () => {
    onChange(draft);
    await onSave(draft);
    setOpen(false);
  };

  return (
    <>
      <div className="py-5">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <Bot className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">AI Prompt</p>
            <p className="text-xs text-muted-foreground">The shared instruction Sona reads before drafting every reply.</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleOpen}
            className="shrink-0 gap-1.5 transition-transform duration-150 active:scale-[0.97]"
          >
            <PenLine className="h-3.5 w-3.5" />
            {value ? "Edit" : "Add prompt"}
          </Button>
        </div>

        <div className="mt-4 rounded-lg bg-muted/40 px-4 py-3.5">
          {value ? (
            <p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
              {value}
            </p>
          ) : (
            <div>
              <p className="text-sm font-medium text-foreground">No prompt configured</p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                Add brand context, tone of voice and reply guidelines for Sona.
              </p>
            </div>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>AI Prompt</DialogTitle>
            <DialogDescription>
              Describe your brand and how your AI support agent should sound. This is the primary instruction the AI reads before every reply.
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Example:\nWe are [brand], a Danish webshop selling [products]. Our tone is friendly and direct — we get to the point fast. Replies should be max 4 sentences. We always write in the customer's language.`}
            rows={8}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-input md:text-sm leading-relaxed placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AiInstructionsTab({ value, onChange, onSave, saving }) {
  return (
    <section className="w-full space-y-5">
      <div className="mb-6">
        <h2 className="text-page-heading font-semibold tracking-tight text-foreground">AI instructions</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Define the shared brand context and tone Sona uses when drafting replies.
        </p>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card px-6">
        <AiPromptModal value={value} onChange={onChange} onSave={onSave} saving={saving} />
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        Automation-specific behavior is configured separately under Automation.
      </p>
    </section>
  );
}

export function AiInstructionsSection() {
  const { resources, refreshResource } = useSettingsWorkspace();
  const [aiPrompt, setAiPrompt] = useState(
    () => String(resourcePayload(resources, "/api/persona")?.persona?.instructions || "").trim()
  );

  return (
    <AiInstructionsTab
      value={aiPrompt}
      onChange={setAiPrompt}
      saving={false}
      onSave={async (newPrompt) => {
        const response = await fetch("/api/persona", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ instructions: newPrompt }),
        });
        if (!response.ok) throw new Error("Could not save AI instructions.");
        refreshResource("/api/persona");
        toast.success("AI instructions saved.");
      }}
    />
  );
}
