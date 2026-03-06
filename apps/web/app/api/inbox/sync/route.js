import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export async function POST() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  return NextResponse.json(
    {
      success: true,
      mode: "forwarding_postmark_only",
      message: "Inbox sync via Gmail/Outlook polling is disabled. Inbound mail is handled via forwarding to Postmark.",
    },
    { status: 200 }
  );
}
