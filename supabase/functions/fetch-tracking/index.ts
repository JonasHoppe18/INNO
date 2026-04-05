import { fetchTrackingDetailsForOrders } from "../_shared/tracking.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const body = await req.json().catch(() => ({}));
    const trackingNumber = String(body?.trackingNumber || "").trim();
    const trackingUrl = String(body?.trackingUrl || "").trim();
    const company = String(body?.company || "").trim();

    if (!trackingNumber) {
      return json({ error: "trackingNumber is required" }, 400);
    }

    // Synthetic order shaped to match what collectTrackingCandidates expects
    const syntheticOrder = {
      id: "live-refresh",
      fulfillments: [
        {
          tracking_number: trackingNumber,
          tracking_company: company,
          tracking_url: trackingUrl,
          tracking_numbers: [trackingNumber],
          tracking_urls: trackingUrl ? [trackingUrl] : [],
        },
      ],
    };

    const details = await fetchTrackingDetailsForOrders([syntheticOrder]);
    const detail = details["live-refresh"] ?? null;

    return json({ detail });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Tracking fetch failed";
    return json({ error: message }, 500);
  }
});
