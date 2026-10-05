"use client";

import { useCallback } from "react";
import { useScopedReadResource } from "@/hooks/useScopedReadResource";
import { pendingThreadReads } from "@/lib/client/pending-thread-read";

export function useThreadDetailRead() {
  const { scopeKey, ready, readResponse } = useScopedReadResource();
  const readDetail = useCallback((threadId, messagesOnly = false) => {
    const url = `/api/inbox/threads/${encodeURIComponent(threadId)}/detail${messagesOnly ? "?view=messages" : ""}`;
    return pendingThreadReads.read(scopeKey, url, async () => {
      const response = await readResponse(url);
      if (!response.ok) throw new Error("Could not load conversation.");
      return response.json();
    });
  }, [scopeKey, readResponse]);
  return { scopeKey, ready, readDetail };
}
