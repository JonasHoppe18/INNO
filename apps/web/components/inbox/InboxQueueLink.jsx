"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { forwardRef } from "react";
import { canNavigateQueueLocally } from "@/lib/inbox/queue-navigation";

// Queue filters use the already loaded thread set. Preserve ordinary Link
// navigation for entering Inbox, server parameters and new-tab clicks.
export const InboxQueueLink = forwardRef(function InboxQueueLink({ href, onClick, target, ...props }, ref) {
  const pathname = usePathname();
  return (
    <Link {...props} ref={ref} href={href} target={target}
      prefetch={pathname === "/inbox" ? false : undefined}
      onClick={(event) => {
        onClick?.(event);
        if (target && target !== "_self") return;
        if (!canNavigateQueueLocally(window.location.href, href, event)) return;
        event.preventDefault();
        window.history.pushState(null, "", href);
      }}
    />
  );
});
