// Guide-mode detection for the writer's length mode-split.
//
// Human agents answer troubleshooting tickets by pasting the COMPLETE guide;
// the writer's decisive-brevity rules were compressing selected guides into
// 2-3 sentences (send-ready analysis 2026-07-07: dominant non-send-ready
// cause was missing steps, not style). A selected chunk counts as a
// step-by-step guide when it carries 3+ step-shaped lines. Pure module.

const STEP_LINE_RE = /^\s*(?:[-*•]|\d+[.)]|step\s+\d+)\s+\S/gim;

export function detectStepGuideChunks(
  chunks: Array<{ content?: string | null }>,
): boolean {
  for (const chunk of chunks || []) {
    const content = String(chunk?.content || "");
    if (!content) continue;
    const steps = content.match(STEP_LINE_RE);
    if (steps && steps.length >= 3) return true;
  }
  return false;
}
