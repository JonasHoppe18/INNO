"use client";

import { Button } from "@/components/ui/button";
import { RefreshCw, Save } from "lucide-react";
import { useFineTuningPanelActions } from "./FineTuningPanel";

export function FineTuningPageHeader() {
  const { refresh, save, loading, saving, dirty } = useFineTuningPanelActions();

  return (
    <header className="flex w-full flex-wrap items-start justify-between gap-4">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold text-foreground">Fine-tuning</h1>
        <p className="text-sm text-muted-foreground">
          Define how the AI sounds and test it against realistic customer emails.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={refresh}
          disabled={loading}
          className="text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Refresh
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={save}
          disabled={saving || !dirty}
          className="bg-black text-white hover:bg-black/90"
        >
          <Save className="mr-1.5 h-3.5 w-3.5" />
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </header>
  );
}
