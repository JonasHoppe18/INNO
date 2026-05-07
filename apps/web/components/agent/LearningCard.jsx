"use client";

import { BookOpen, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function LearningCard({ exampleCount = 0 }) {
  return (
    <Card className="relative overflow-hidden border border-indigo-300/60 bg-gradient-to-br from-[#2f2a6f] via-[#43358a] to-[#5a4bb3] shadow-sm">
      <CardContent className="relative flex flex-col gap-6 p-6">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-indigo-300" />
            <div className="text-sm font-semibold text-white">AI Self Learning</div>
            <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-200 border border-emerald-400/30">
              Active
            </span>
          </div>
          <p className="max-w-xl text-sm text-indigo-100/70">
            Sona learns from the replies you approve and uses them as reference for similar cases.
          </p>
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

        <p className="text-xs text-indigo-100/50">
          Replies you approve are automatically used to improve future drafts.
        </p>
      </CardContent>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.18),transparent_55%)]" />
    </Card>
  );
}
