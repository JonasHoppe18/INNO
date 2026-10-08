import { redirect } from "next/navigation";

// "All tickets" is the inbox's own view=all, so it follows the viewer's
// split/list layout choice. Kept as a redirect for existing links.
export default function InboxTicketsPage({ searchParams }) {
  const params = new URLSearchParams({ view: "all" });
  const threadId = typeof searchParams?.thread === "string" ? searchParams.thread.trim() : "";
  if (threadId) params.set("thread", threadId);
  redirect(`/inbox?${params.toString()}`);
}
