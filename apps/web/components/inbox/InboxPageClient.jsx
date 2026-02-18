"use client";

import Link from "next/link";
import { InboxSplitView } from "@/components/inbox/InboxSplitView";
import { Button } from "@/components/ui/button";
import { useAgentAutomation } from "@/hooks/useAgentAutomation";

export function InboxPageClient({ threads = [], messages = [] }) {
  const { settings, loading } = useAgentAutomation();
  const draftDestination = settings?.draftDestination;

  if (!loading && (draftDestination === "provider_inbox" || draftDestination === "email_provider")) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="max-w-md text-center">
          <h2 className="text-lg font-semibold text-slate-900">Inbox disabled</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            Your draft destination is set to Gmail/Outlook, so drafts are created directly
            in your email provider.
          </p>
          <Button asChild className="mt-3 h-8 text-xs">
            <Link href="/automation">Change draft destination</Link>
          </Button>
        </div>
      </div>
    );
  }

  return <InboxSplitView threads={threads} messages={messages} />;
}
