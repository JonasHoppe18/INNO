"use client";

import { InboxSplitView } from "@/components/inbox/InboxSplitView";

export function InboxPageClient({ threads = [], messages = [], attachments = [] }) {
  return (
    <div className="flex min-h-0 flex-1 bg-white pl-2 pb-2">
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-[20px] bg-sidebar">
        <InboxSplitView threads={threads} messages={messages} attachments={attachments} />
      </div>
    </div>
  );
}
