"use client";

import { InboxSplitView } from "@/components/inbox/InboxSplitView";

export function InboxPageClient({ threads = [], messages = [], attachments = [] }) {
  return (
    <div className="inbox-theme animate-view-enter flex min-h-0 flex-1 bg-white pb-2">
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-[20px] bg-sidebar">
        <InboxSplitView threads={threads} messages={messages} attachments={attachments} />
      </div>
    </div>
  );
}
