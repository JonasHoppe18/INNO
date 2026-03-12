"use client";

import { Button } from "@/components/ui/button";

export function StickySaveBar({
  isVisible,
  isSaving = false,
  onSave,
  onDiscard,
  saveLabel = "Save changes",
  savingLabel = "Saving...",
  message = "Unsaved changes",
  className = "",
}) {
  if (!isVisible) return null;

  return (
    <div
      className={`fixed bottom-4 left-1/2 z-20 w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-medium text-slate-600">{message}</span>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onDiscard}>
            Discard
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onSave}
            disabled={isSaving}
            className="bg-[#6366f1] text-white hover:bg-[#5558db]"
          >
            {isSaving ? savingLabel : saveLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
