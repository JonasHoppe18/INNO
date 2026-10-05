import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { GET as members } from "../members/route";
import { GET as testMode } from "../test-mode/route";
import { GET as persona } from "../../persona/route";
import { GET as autoReply } from "../auto-reply/route";
import { GET as emailSignature } from "../email-signature/route";
import { GET as emailRouting } from "../email-routing/route";
import { GET as emailSenderRules } from "../email-sender-rules/route";
import { GET as emailBlocklist } from "../email-blocklist/route";
import { GET as inboxes } from "../../inboxes/route";

const resources = {
  "/api/settings/members": members,
  "/api/settings/test-mode": testMode,
  "/api/persona": persona,
  "/api/settings/auto-reply": autoReply,
  "/api/settings/email-signature": emailSignature,
  "/api/settings/email-routing": emailRouting,
  "/api/settings/email-sender-rules": emailSenderRules,
  "/api/settings/email-blocklist": emailBlocklist,
  "/api/inboxes": inboxes,
};

export async function GET(request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  // Existing handlers keep their own authorization, defaults, and error handling.
  const entries = await Promise.all(Object.entries(resources).map(async ([path, handler]) => {
    try {
      const response = await handler(new NextRequest(new URL(path, request.url), {
        headers: request.headers,
      }));
      return [path, { ok: response.ok, status: response.status, payload: await response.json() }];
    } catch {
      return [path, { ok: false, status: 500, payload: { error: "Could not load settings." } }];
    }
  }));
  return NextResponse.json({ resources: Object.fromEntries(entries) }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
