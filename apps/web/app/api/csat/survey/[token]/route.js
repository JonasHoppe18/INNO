import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { hashCustomerSatisfactionToken } from "@/lib/server/customer-satisfaction-surveys";
import { loadCustomerSatisfactionSettings } from "@/lib/server/customer-satisfaction";
import { resolveSupabaseServerConfig } from "@/lib/server/supabase-server-config";

export const dynamic = "force-dynamic";

const { url: SUPABASE_URL, serviceKey: SERVICE_KEY } = resolveSupabaseServerConfig();

function serviceClient() {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  return createClient(SUPABASE_URL, SERVICE_KEY);
}

function response(payload, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function loadRequest(token, client) {
  const safeToken = String(token || "").trim();
  if (!/^[a-f0-9]{32,128}$/i.test(safeToken)) return null;
  const { data, error } = await client
    .from("csat_survey_requests")
    .select("id, workspace_id, thread_id, status, sent_at, responded_at")
    .eq("token_hash", hashCustomerSatisfactionToken(safeToken))
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

export async function GET(_request, { params }) {
  try {
    const client = serviceClient();
    if (!client) return response({ error: "Survey service is unavailable." }, 503);
    const surveyRequest = await loadRequest(params?.token, client);
    if (!surveyRequest) return response({ error: "This survey link is invalid or expired." }, 404);
    const settings = await loadCustomerSatisfactionSettings(client, surveyRequest.workspace_id, { logoExpiresIn: 7 * 24 * 60 * 60 });
    return response({
      status: surveyRequest.status === "responded" ? "responded" : "open",
      settings: {
        company: settings.company,
        senderName: settings.senderName,
        headline: settings.headline,
        intro: settings.intro,
        thankYou: settings.thankYou,
        footer: settings.footer,
        accent: settings.accent,
        logoUrl: settings.logoUrl,
      },
    });
  } catch (error) {
    return response({ error: error.message || "Could not load survey." }, 500);
  }
}

export async function POST(request, { params }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return response({ error: "A score is required." }, 400);
  }
  const score = Number(body?.score);
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    return response({ error: "Score must be an integer from 1 to 5." }, 400);
  }

  try {
    const client = serviceClient();
    if (!client) return response({ error: "Survey service is unavailable." }, 503);
    const surveyRequest = await loadRequest(params?.token, client);
    if (!surveyRequest) return response({ error: "This survey link is invalid or expired." }, 404);
    if (surveyRequest.status === "responded") return response({ status: "responded" });

    const submittedAt = new Date().toISOString();
    const { error: feedbackError } = await client.from("support_feedback").insert({
      workspace_id: surveyRequest.workspace_id,
      thread_id: surveyRequest.thread_id,
      survey_request_id: surveyRequest.id,
      score,
      submitted_at: submittedAt,
    });
    if (feedbackError && !/duplicate key|23505/i.test(String(feedbackError.message || ""))) {
      throw new Error(feedbackError.message);
    }

    const { error: requestError } = await client
      .from("csat_survey_requests")
      .update({ status: "responded", responded_at: submittedAt, updated_at: submittedAt })
      .eq("id", surveyRequest.id);
    if (requestError) throw new Error(requestError.message);
    return response({ status: "responded" });
  } catch (error) {
    return response({ error: error.message || "Could not save your feedback." }, 500);
  }
}
