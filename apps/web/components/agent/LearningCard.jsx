"use client";

import { CheckCircle2, BookOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAgentAutomation } from "@/hooks/useAgentAutomation";

export function LearningCard({ exampleCount = 0 }) {
  const { settings, loading, saving, save } = useAgentAutomation();

  const isEnabled = Boolean(settings?.learnFromEdits);

  const handleToggle = async () => {
    await save({ learnFromEdits: !isEnabled });
  };

  return (
    <Card className="relative overflow-hidden border border-indigo-300/60 bg-gradient-to-br from-[#2f2a6f] via-[#43358a] to-[#5a4bb3] shadow-sm">
      <CardContent className="relative flex flex-col gap-6 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <div className="text-sm font-semibold text-white">AI Self Learning</div>
            <p className="max-w-xl text-sm text-indigo-100/80">
              Sona saves the replies you send and uses them as a reference the next time a similar case comes in.
            </p>
            {isEnabled ? (
              <div className="flex items-center gap-2 text-xs text-emerald-200">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Active — new replies are saved automatically.
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-indigo-100/60">
                Disabled — replies are not being saved.
              </div>
            )}
          </div>
          <div className="flex items-center gap-4" />
        </div>

        <div className="rounded-xl border border-white/10 bg-white/10 p-4">
          <div className="flex items-center gap-3">
            <BookOpen className="h-4 w-4 text-indigo-200/70 shrink-0" />
            <div className="flex-1">
              <div className="flex items-center justify-between text-xs font-semibold text-indigo-100/80">
                <span>Saved reply examples</span>
                <span className="text-white/90">{exampleCount}</span>
              </div>
              <p className="mt-1 text-xs text-indigo-100/50">
                {exampleCount === 0
                  ? "No examples yet — send the first reply to get started."
                  : exampleCount === 1
                  ? "1 reply saved. Sona will use it as a reference."
                  : `${exampleCount} replies saved. Sona uses them as reference.`}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end">
          <Button
            type="button"
            size="sm"
            onClick={handleToggle}
            disabled={loading || saving}
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
