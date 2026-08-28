"use client";

import dynamic from "next/dynamic";
import { InboxLoadingSkeleton } from "@/components/inbox/InboxLoadingSkeleton";

const InboxPageClient = dynamic(
  () => import("@/components/inbox/InboxPageClient").then((mod) => mod.InboxPageClient),
  {
    ssr: false,
    loading: () => <InboxLoadingSkeleton />,
  },
);

export function InboxPageClientOnly(props) {
  return <InboxPageClient {...props} />;
}
