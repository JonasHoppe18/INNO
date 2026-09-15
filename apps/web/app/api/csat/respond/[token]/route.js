import { NextResponse } from "next/server";

import { recordCsatResponse } from "@/lib/server/csat-response";
import { createCsatServiceClient } from "@/lib/server/csat-route";

export const dynamic = "force-dynamic";

function responseStatus(reason) {
  if (reason === "invalid_score") return 400;
  if (reason === "missing_token" || reason === "invalid_token") return 404;
  if (reason === "expired_token") return 410;
  return 400;
}

export async function POST(request, { params }) {
  const serviceClient = createCsatServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "CSAT service is unavailable." }, { status: 503 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A rating is required." }, { status: 400 });
  }

  try {
    const routeParams = await params;
    const result = await recordCsatResponse(serviceClient, {
      token: routeParams?.token,
      score: Number(body?.score),
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: responseStatus(result.reason) });
    }
    return NextResponse.json(result, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[csat-response] Failed to record response", error);
    return NextResponse.json({ error: "We could not record that rating." }, { status: 500 });
  }
}
