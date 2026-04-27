import { createClient } from "jsr:@supabase/supabase-js@2";

type SupabaseClient = ReturnType<typeof createClient>;

export type DefaultTag = {
  name: string;
  color: string;
  category: string;
  ai_prompt: string;
};

export const DEFAULT_WORKSPACE_TAGS: DefaultTag[] = [
  {
    name: "Tracking",
    color: "#3b82f6",
    category: "Shipping",
    ai_prompt: "Customer is asking where their shipment is, wants a tracking number, or reports a delivery problem.",
  },
  {
    name: "Missing item",
    color: "#3b82f6",
    category: "Shipping",
    ai_prompt: "Customer says their parcel arrived but one or more items were missing from the package.",
  },
  {
    name: "Address change",
    color: "#3b82f6",
    category: "Shipping",
    ai_prompt: "Customer wants to change or correct the shipping address on an existing order.",
  },
  {
    name: "Return",
    color: "#f97316",
    category: "Returns",
    ai_prompt: "Customer explicitly wants to send a product back.",
  },
  {
    name: "Exchange",
    color: "#f97316",
    category: "Returns",
    ai_prompt: "Customer wants to swap for a different size or color of the same product.",
  },
  {
    name: "Wrong item",
    color: "#f97316",
    category: "Returns",
    ai_prompt: "Customer received a completely different product than what they ordered — a fulfillment error.",
  },
  {
    name: "Refund",
    color: "#eab308",
    category: "Billing",
    ai_prompt: "Customer wants their money back and has not yet initiated a return.",
  },
  {
    name: "Payment",
    color: "#eab308",
    category: "Billing",
    ai_prompt: "Billing, invoice, receipt, or failed or double charge issue.",
  },
  {
    name: "Fraud / dispute",
    color: "#ef4444",
    category: "Billing",
    ai_prompt: "Customer suspects unauthorized purchase, has filed a chargeback, or reports that someone else made the purchase.",
  },
  {
    name: "Gift card",
    color: "#eab308",
    category: "Billing",
    ai_prompt: "Gift card balance, activation, redemption, or code issue.",
  },
  {
    name: "Cancellation",
    color: "#64748b",
    category: "Order",
    ai_prompt: "Customer wants to cancel an existing order.",
  },
  {
    name: "Product question",
    color: "#8b5cf6",
    category: "Product",
    ai_prompt: "Pre-purchase or general product information question.",
  },
  {
    name: "Technical support",
    color: "#8b5cf6",
    category: "Product",
    ai_prompt: "Product is not working and customer wants help fixing it, not replacing it.",
  },
  {
    name: "Warranty",
    color: "#8b5cf6",
    category: "Product",
    ai_prompt: "Customer is claiming a product defect under warranty and expects coverage — replacement or repair under warranty terms.",
  },
  {
    name: "Complaint",
    color: "#ef4444",
    category: "Feedback",
    ai_prompt: "Customer is expressing general dissatisfaction without a specific actionable request.",
  },
  {
    name: "General",
    color: "#64748b",
    category: "Other",
    ai_prompt: "Does not fit any of the other categories.",
  },
];

export async function seedDefaultWorkspaceTags(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<void> {
  const rows = DEFAULT_WORKSPACE_TAGS.map((tag) => ({
    workspace_id: workspaceId,
    name: tag.name,
    color: tag.color,
    category: tag.category,
    ai_prompt: tag.ai_prompt,
    is_active: true,
  }));

  try {
    const result = await supabase
      .from("workspace_tags")
      // @ts-ignore: Supabase table types not available in JSR client
      .upsert(rows, { onConflict: "workspace_id,name", ignoreDuplicates: true });

    const error = (result as { error?: { message: string } | null }).error;
    if (error) {
      console.error(`seedDefaultWorkspaceTags failed for workspace ${workspaceId}:`, error.message);
    }
  } catch (err) {
    console.error(`seedDefaultWorkspaceTags error for workspace ${workspaceId}:`, err);
  }
}
