// Server-side release sealing and activation. Tenant ids come only from the
// authorized context (A1); platform validation comes from prepareSeal (A2/A4);
// the database repeats tenant/membership/pin checks inside one transaction.

import { KnowledgeAuthzError } from "./authz.js";

const SEAL_CAPABILITY_BY_KIND = {
  publish: "knowledge.publish",
  rollback: "knowledge.rollback",
  platform_adoption: "knowledge.platform_migration.approve",
};

export async function sealRelease({ supabase, context, prepared }) {
  if (!prepared?.ok) throw new KnowledgeAuthzError(422, "seal_invalid", "The release did not pass validation.");
  const required = SEAL_CAPABILITY_BY_KIND[prepared.rpc.kind];
  if (!required || context?.capability !== required) {
    throw new KnowledgeAuthzError(403, "forbidden", "Context was not authorized for this release kind.");
  }
  const request = {
    ...prepared.rpc,
    workspace_id: context.workspaceId,
    shop_id: context.shopId,
    sealed_by: context.clerkUserId,
    sealed_role: context.role,
  };
  const { data, error } = await supabase.rpc("kn2_seal_release", { p_request: request });
  if (error) throw new KnowledgeAuthzError(409, "seal_rejected", error.message);
  return data;
}

export async function activateRelease({ supabase, context, seq }) {
  if (context?.capability !== "knowledge.activate") {
    throw new KnowledgeAuthzError(403, "forbidden", "Context was not authorized to activate releases.");
  }
  const { data, error } = await supabase.rpc("kn2_activate_release", {
    p_workspace_id: context.workspaceId,
    p_shop_id: context.shopId,
    p_seq: seq,
    p_activated_by: context.clerkUserId,
  });
  if (error) throw new KnowledgeAuthzError(409, "activation_rejected", error.message);
  return data;
}
