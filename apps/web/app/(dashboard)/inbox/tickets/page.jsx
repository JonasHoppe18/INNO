import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { InboxTicketsTable } from "@/components/inbox/InboxTicketsTable";
import { loadInboxData } from "@/lib/server/inbox-data";

export default async function InboxTicketsPage() {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    redirect("/sign-in?redirect_url=/inbox/tickets");
  }

  let mailboxes = [];
  let threads = [];
  let members = [];

  try {
    const data = await loadInboxData({
      clerkUserId,
      orgId,
      includeMessages: false,
      includeAttachments: false,
      includeMembers: true,
    });
    mailboxes = data.mailboxes;
    threads = data.threads;
    members = data.members;
  } catch (error) {
    console.error("Inbox tickets lookup failed:", error);
  }

  if (!mailboxes.length) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="max-w-md text-center">
          <h2 className="text-lg font-semibold text-slate-900">Connect a mailbox</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            You need to connect a support inbox before Sona can fetch your emails.
          </p>
          <Button asChild className="mt-3 h-8 text-xs">
            <Link href="/mailboxes">Go to Mailboxes</Link>
          </Button>
        </div>
      </div>
    );
  }

  return <InboxTicketsTable threads={threads} members={members} />;
}
