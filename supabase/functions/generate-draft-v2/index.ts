// supabase/functions/generate-draft-v2/index.ts
import { createClient } from "jsr:@supabase/supabase-js@2";
import { runDraftV2Pipeline } from "./pipeline.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { thread_id, message_id, shop_id, email_data } = await req.json();

    if (!shop_id || (!thread_id && !email_data)) {
      return new Response(
        JSON.stringify({ error: "shop_id and either thread_id or email_data required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "",
    );

    const startTime = Date.now();
    const result = await runDraftV2Pipeline({ thread_id, message_id, shop_id, supabase, eval_payload: email_data });
    const latency_ms = Date.now() - startTime;

    console.log(`[generate-draft-v2] thread=${thread_id} latency=${latency_ms}ms skipped=${result.skipped ?? false}`);

    return new Response(
      JSON.stringify({ ...result, latency_ms }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  } catch (err) {
    console.error("[generate-draft-v2] Error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }
});
