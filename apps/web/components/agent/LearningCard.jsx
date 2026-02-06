"use client";

import { useMemo } from "react";
import { CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAgentAutomation } from "@/hooks/useAgentAutomation";

const EMAIL_GOAL = 20;
const CONVERSATION_GOAL = 5;

export function LearningCard({ sentCount = 0, conversationCount = 0 }) {
  const { settings, loading, saving, save } = useAgentAutomation();

  const isEnabled = Boolean(settings?.learnFromEdits);
  const draftDestination = settings?.draftDestination || "email_provider";
  const requiresSonaInbox = draftDestination !== "sona_inbox";
  const isUnlocked = sentCount >= EMAIL_GOAL;

  const statusLabel = useMemo(
    () => (isEnabled ? "Active" : "Inactive"),
    [isEnabled]
  );

  const handleToggle = async () => {
    const next = !isEnabled;
    await save({ learnFromEdits: next });
  };

  const emailProgress = Math.min(100, Math.round((sentCount / EMAIL_GOAL) * 100));
  const conversationProgress = Math.min(
    100,
    Math.round((conversationCount / CONVERSATION_GOAL) * 100)
  );

  return (
    <Card className="relative overflow-hidden border border-indigo-300/60 bg-gradient-to-br from-[#2f2a6f] via-[#43358a] to-[#5a4bb3] shadow-sm">
      <CardContent className="relative flex flex-col gap-6 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <div className="text-sm font-semibold text-white">AI Self Learning</div>
            <p className="max-w-xl text-sm text-indigo-100/80">
              Learn from your edits in the Sona inbox to match your tone, shorten replies, and
              keep responses consistent.
            </p>
            {requiresSonaInbox ? (
              <p className="text-xs text-amber-200">
                Edit-learning requires Sona inbox. Historic learning still works.
              </p>
            ) : (
              <div className="flex items-center gap-2 text-xs text-emerald-200">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Ready to learn from edits.
              </div>
            )}
          </div>

          <div className="flex items-center gap-4" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-white/10 p-4">
            <div className="flex items-center justify-between text-xs font-semibold text-indigo-100/80">
              <span>Email volume</span>
              <span className="text-white/90">
                {sentCount} / {EMAIL_GOAL} emails
              </span>
            </div>
            <div className="mt-3 h-2.5 w-full rounded-full bg-indigo-900/50">
              <div
                className="h-2.5 rounded-full bg-gradient-to-r from-fuchsia-400 to-indigo-300"
                style={{ width: `${emailProgress}%` }}
              />
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/10 p-4">
            <div className="flex items-center justify-between text-xs font-semibold text-indigo-100/80">
              <span>Conversations learned</span>
              <span className="text-white/90">
                {conversationCount} / {CONVERSATION_GOAL} conversations
              </span>
            </div>
            <div className="mt-3 h-2.5 w-full rounded-full bg-indigo-900/50">
              <div
                className="h-2.5 rounded-full bg-gradient-to-r from-emerald-300 to-teal-300"
                style={{ width: `${conversationProgress}%` }}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-indigo-100/80">
          {!isUnlocked ? (
            <span>
              Locked – needs {Math.max(0, EMAIL_GOAL - sentCount)} sent emails.
            </span>
          ) : (
            <span>&nbsp;</span>
          )}
          <Button
            type="button"
            size="sm"
            onClick={handleToggle}
            disabled={loading || saving || !isUnlocked}
            className="bg-white/10 text-white hover:bg-white/20"
          >
            {isEnabled ? "Self-learning enabled ✓" : "Enable self-learning"}
          </Button>
        </div>
      </CardContent>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.18),transparent_55%)]" />
    </Card>
  );
}
