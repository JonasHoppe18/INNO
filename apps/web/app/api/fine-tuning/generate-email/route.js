import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope } from "@/lib/server/workspace-auth";

const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  ""
).replace(/\/$/, "");

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

const EMAIL_TOPICS = [
  "return request for a product",
  "question about shipping time or tracking",
  "complaint about a defective or damaged product",
  "question about order status",
  "question about a specific product before purchasing",
  "request for refund",
  "exchange request",
  "wrong item received",
];

function pickTopic() {
  return EMAIL_TOPICS[Math.floor(Math.random() * EMAIL_TOPICS.length)];
}

export async function POST() {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  if (!OPENAI_API_KEY) {
    return NextResponse.json({ error: "OpenAI API key is not configured." }, { status: 500 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Supabase configuration is missing." }, { status: 500 });
  }

  let scope;
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  // Fetch shop context
  let shopName = null;
  let productNames = [];
  let policyHints = [];

  if (scope?.workspaceId) {
    const { data: shop } = await serviceClient
      .from("shops")
      .select("id, team_name, policy_refund, policy_shipping")
      .eq("workspace_id", scope.workspaceId)
      .is("uninstalled_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (shop) {
      shopName = shop.team_name || null;

      const { data: products } = await serviceClient
        .from("shop_products")
        .select("title, product_type")
        .eq("shop_id", shop.id)
        .limit(8);

      if (Array.isArray(products) && products.length > 0) {
        productNames = products
          .map((p) => p.title || p.product_type)
          .filter(Boolean)
          .slice(0, 8);
      }

      if (shop.policy_refund) policyHints.push("has a refund/return policy");
      if (shop.policy_shipping) policyHints.push("has a shipping policy");
    }
  }

  const topic = pickTopic();
  const shopContext = shopName ? `The shop is called "${shopName}".` : "This is a generic e-commerce shop.";
  const productContext =
    productNames.length > 0
      ? `Products sold include: ${productNames.join(", ")}.`
      : "The shop sells various consumer products.";
  const policyContext =
    policyHints.length > 0
      ? `The shop ${policyHints.join(" and ")}.`
      : "";

  const systemPrompt =
    "You generate realistic customer support emails for e-commerce shops. " +
    "Write in a natural, human tone. Vary the writing style — sometimes formal, sometimes casual. " +
    "Always respond with valid JSON only, no markdown.";

  const userPrompt =
    `${shopContext} ${productContext} ${policyContext}\n\n` +
    `Generate a realistic customer support email about: ${topic}.\n\n` +
    `Respond with JSON in this exact format:\n` +
    `{\n` +
    `  "from": "customer first name and a plausible email address",\n` +
    `  "subject": "email subject line",\n` +
    `  "body": "the full email body text"\n` +
    `}`;

  let generated;
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.9,
        max_tokens: 500,
        response_format: { type: "json_object" },
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errMsg = data?.error?.message || "OpenAI request failed.";
      return NextResponse.json({ error: errMsg }, { status: 502 });
    }

    const raw = data?.choices?.[0]?.message?.content || "{}";
    generated = JSON.parse(raw);
  } catch (err) {
    return NextResponse.json({ error: "Failed to generate email." }, { status: 502 });
  }

  const from = typeof generated.from === "string" && generated.from.trim() ? generated.from.trim() : "customer@example.com";
  const subject = typeof generated.subject === "string" && generated.subject.trim() ? generated.subject.trim() : "Customer inquiry";
  const body = typeof generated.body === "string" && generated.body.trim() ? generated.body.trim() : "";

  return NextResponse.json({ from, subject, body });
}
