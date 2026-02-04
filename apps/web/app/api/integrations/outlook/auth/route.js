import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || "";
const MICROSOFT_REDIRECT_URI =
  process.env.MICROSOFT_REDIRECT_URI ||
  process.env.OUTLOOK_REDIRECT_URI ||
  "";
const MICROSOFT_TENANT_ID = process.env.MICROSOFT_TENANT_ID || "common";

export async function GET() {
  const { userId } = auth();
  if (!userId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  if (!MICROSOFT_CLIENT_ID || !MICROSOFT_REDIRECT_URI) {
    return NextResponse.json(
      { error: "Microsoft OAuth configuration is missing." },
      { status: 500 }
    );
  }

  const authUrl = new URL(
    `https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}/oauth2/v2.0/authorize`
  );
  authUrl.searchParams.set("client_id", MICROSOFT_CLIENT_ID);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", MICROSOFT_REDIRECT_URI);
  authUrl.searchParams.set("response_mode", "query");
  authUrl.searchParams.set(
    "scope",
    ["offline_access", "Mail.ReadWrite", "Mail.Send", "User.Read"].join(" ")
  );
  authUrl.searchParams.set("prompt", "consent");

  return NextResponse.redirect(authUrl.toString());
}
