"use client";

import { InboxSplitView } from "@/components/inbox/InboxSplitView";

export function InboxPageClient({ threads = [], messages = [], attachments = [] }) {
  return <InboxSplitView threads={threads} messages={messages} attachments={attachments} />;
}
