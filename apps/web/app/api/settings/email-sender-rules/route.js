import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope } from "@/lib/server/workspace-auth";

const SUPABASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "").replace(
    /\/$/,
    ""
  );
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

const MATCHER_TYPES = new Set(["email", "domain"]);
const DESTINATION_TYPES = new Set(["classification", "inbox"]);
const RESERVED_CLASSIFICATIONS = new Set(["support", "notification"]);

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function asString(value, fallback = "") {
  const next = typeof value === "string" ? value.trim() : "";
  return next || fallback;
}

function normalizeMatcherType(value) {
  const next = asString(value).toLowerCase();
  return MATCHER_TYPES.has(next) ? next : "";
}

function normalizeEmail(value) {
  const email = asString(value).toLowerCase();
  if (!email) return "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function normalizeDomain(value) {
  const raw = asString(value).toLowerCase().replace(/^@+/, "");
  if (!raw) return "";
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(raw)) return "";
  if (raw.includes("..") || raw.startsWith(".") || raw.endsWith(".")) return "";
  return raw;
}

function normalizeMatcherValue(matcherType, matcherValue) {
  if (matcherType === "email") return normalizeEmail(matcherValue);
  if (matcherType === "domain") return normalizeDomain(matcherValue);
  return "";
}

function normalizeDestinationType(value) {
  const next = asString(value).toLowerCase();
  return DESTINATION_TYPES.has(next) ? next : "";
}

function normalizeClassificationKey(value) {
  return asString(value)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function normalizeInboxSlug(value) {
  return asString(value)
    .toLowerCase()
    .replace(/[^a-z0-9-_ ]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function normalizeLegacyDestinationKey(value) {
  const normalized = normalizeClassificationKey(value);
  if (normalized.startsWith("inbox_")) {
    return {
      destinationType: "inbox",
      destinationValue: normalizeInboxSlug(normalized.slice("inbox_".length)),
    };
  }
  return {
    destinationType: "classification",
    destinationValue: normalized,
  };
}

function normalizeDestinationInput(body, existingRow = null) {
  const explicitType = normalizeDestinationType(body?.destination_type);
  if (explicitType) {
    if (explicitType === "classification") {
      return {
        destinationType: "classification",
        destinationValue: normalizeClassificationKey(body?.destination_value),
      };
    }
    return {
      destinationType: "inbox",
      destinationValue: normalizeInboxSlug(body?.destination_value),
    };
  }

  if (body?.destination_key !== undefined) {
    return normalizeLegacyDestinationKey(body?.destination_key);
  }

  if (existingRow) {
    const type = normalizeDestinationType(existingRow?.destination_type) || "classification";
    const value = asString(existingRow?.destination_value);
    return {
      destinationType: type,
      destinationValue:
        type === "inbox" ? normalizeInboxSlug(value) : normalizeClassificationKey(value),
    };
  }

  return {
    destinationType: "classification",
    destinationValue: "",
  };
}

function formatRuleRow(row) {
  const destinationType = normalizeDestinationType(row?.destination_type) || "classification";
  const destinationValue =
    destinationType === "inbox"
      ? normalizeInboxSlug(row?.destination_value)
      : normalizeClassificationKey(row?.destination_value);
  return {
    id: row.id,
    matcher_type: asString(row.matcher_type).toLowerCase(),
    matcher_value: asString(row.matcher_value).toLowerCase(),
    destination_type: destinationType,
    destination_value: destinationValue,
    // Legacy compatibility for callers still expecting destination_key.
    destination_key:
      destinationType === "classification"
        ? destinationValue
        : `inbox:${destinationValue}`,
    is_active: Boolean(row.is_active),
    updated_at: row.updated_at || null,
    created_at: row.created_at || null,
  };
}

function isMissingTableError(error) {
  const message = String(error?.message || "");
  return (
    /relation .*workspace_email_sender_rules.* does not exist/i.test(message) ||
    /relation .*workspace_inboxes.* does not exist/i.test(message) ||
    /relation .*workspace_email_routes.* does not exist/i.test(message)
  );
}

async function resolveScope(serviceClient) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), scope: null };
  }
  const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  if (!scope.workspaceId) {
    return {
      error: NextResponse.json({ error: "Workspace scope not found." }, { status: 404 }),
      scope: null,
    };
  }
  return { error: null, scope };
}

async function isAllowedClassificationDestination(serviceClient, workspaceId, destinationValue) {
  if (!destinationValue) return false;
  if (RESERVED_CLASSIFICATIONS.has(destinationValue)) return true;
  const { data, error } = await serviceClient
    .from("workspace_email_routes")
    .select("id, is_active")
    .eq("workspace_id", workspaceId)
    .eq("category_key", destinationValue)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data?.id && data?.is_active);
}

async function isAllowedInboxDestination(serviceClient, workspaceId, destinationValue) {
  if (!destinationValue) return false;
  const { data, error } = await serviceClient
    .from("workspace_inboxes")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("slug", destinationValue)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data?.id);
}

async function validateDestination(serviceClient, workspaceId, destinationType, destinationValue) {
  if (destinationType === "classification") {
    return isAllowedClassificationDestination(serviceClient, workspaceId, destinationValue);
  }
  if (destinationType === "inbox") {
    return isAllowedInboxDestination(serviceClient, workspaceId, destinationValue);
  }
  return false;
}

export async function GET() {
  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  try {
    const { error, scope } = await resolveScope(serviceClient);
    if (error) return error;

    const { data, error: queryError } = await serviceClient
      .from("workspace_email_sender_rules")
      .select(
        "id, matcher_type, matcher_value, destination_type, destination_value, destination_key, is_active, created_at, updated_at"
      )
      .eq("workspace_id", scope.workspaceId)
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false });
    if (queryError) throw new Error(queryError.message);

    return NextResponse.json(
      {
        rules: (Array.isArray(data) ? data : []).map((row) => {
          const fallback = normalizeLegacyDestinationKey(row?.destination_key);
          return formatRuleRow({
            ...row,
            destination_type: row?.destination_type || fallback.destinationType,
            destination_value: row?.destination_value || fallback.destinationValue,
          });
        }),
      },
      { status: 200 }
    );
  } catch (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json(
        {
          error:
            "Required sender-rules tables are missing. Run the SQL migrations for sender rules and inboxes first.",
        },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load sender rules." },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  let body = {};
  try {
    body = (await request.json()) || {};
  } catch {
    body = {};
  }

  try {
    const { error, scope } = await resolveScope(serviceClient);
    if (error) return error;

    const matcherType = normalizeMatcherType(body?.matcher_type);
    const matcherValue = normalizeMatcherValue(matcherType, body?.matcher_value);
    const { destinationType, destinationValue } = normalizeDestinationInput(body);

    if (!matcherType || !matcherValue) {
      return NextResponse.json(
        { error: "Valid matcher_type and matcher_value are required." },
        { status: 400 }
      );
    }
    if (!destinationType || !destinationValue) {
      return NextResponse.json(
        { error: "Valid destination_type and destination_value are required." },
        { status: 400 }
      );
    }

    const validDestination = await validateDestination(
      serviceClient,
      scope.workspaceId,
      destinationType,
      destinationValue
    );
    if (!validDestination) {
      return NextResponse.json(
        { error: "Invalid destination for this workspace." },
        { status: 400 }
      );
    }

    const nowIso = new Date().toISOString();
    const { data: existing, error: existingError } = await serviceClient
      .from("workspace_email_sender_rules")
      .select("id")
      .eq("workspace_id", scope.workspaceId)
      .eq("matcher_type", matcherType)
      .eq("matcher_value", matcherValue)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }

    if (existing?.id) {
      const { data, error: updateError } = await serviceClient
        .from("workspace_email_sender_rules")
        .update({
          destination_type: destinationType,
          destination_value: destinationValue,
          destination_key: destinationType === "classification" ? destinationValue : null,
          is_active: typeof body?.is_active === "boolean" ? body.is_active : true,
          updated_at: nowIso,
        })
        .eq("workspace_id", scope.workspaceId)
        .eq("id", existing.id)
        .select(
          "id, matcher_type, matcher_value, destination_type, destination_value, destination_key, is_active, created_at, updated_at"
        )
        .maybeSingle();
      if (updateError || !data?.id) {
        return NextResponse.json(
          { error: updateError?.message || "Could not update sender rule." },
          { status: 500 }
        );
      }
      return NextResponse.json({ rule: formatRuleRow(data), upserted: true }, { status: 200 });
    }

    const { data, error: insertError } = await serviceClient
      .from("workspace_email_sender_rules")
      .insert({
        workspace_id: scope.workspaceId,
        matcher_type: matcherType,
        matcher_value: matcherValue,
        destination_type: destinationType,
        destination_value: destinationValue,
        destination_key: destinationType === "classification" ? destinationValue : null,
        is_active: typeof body?.is_active === "boolean" ? body.is_active : true,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select(
        "id, matcher_type, matcher_value, destination_type, destination_value, destination_key, is_active, created_at, updated_at"
      )
      .maybeSingle();

    if (insertError || !data?.id) {
      return NextResponse.json(
        { error: insertError?.message || "Could not create sender rule." },
        { status: 500 }
      );
    }

    return NextResponse.json({ rule: formatRuleRow(data), upserted: false }, { status: 201 });
  } catch (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json(
        {
          error:
            "Required sender-rules tables are missing. Run the SQL migrations for sender rules and inboxes first.",
        },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save sender rule." },
      { status: 500 }
    );
  }
}

export async function PUT(request) {
  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  let body = {};
  try {
    body = (await request.json()) || {};
  } catch {
    body = {};
  }

  const ruleId = asString(body?.id);
  if (!ruleId) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  try {
    const { error, scope } = await resolveScope(serviceClient);
    if (error) return error;

    const { data: existing, error: existingError } = await serviceClient
      .from("workspace_email_sender_rules")
      .select(
        "id, matcher_type, matcher_value, destination_type, destination_value, destination_key, is_active"
      )
      .eq("workspace_id", scope.workspaceId)
      .eq("id", ruleId)
      .maybeSingle();
    if (existingError || !existing?.id) {
      return NextResponse.json(
        { error: existingError?.message || "Sender rule not found." },
        { status: 404 }
      );
    }

    const nextMatcherType =
      body?.matcher_type !== undefined
        ? normalizeMatcherType(body?.matcher_type)
        : normalizeMatcherType(existing?.matcher_type);
    const nextMatcherValue =
      body?.matcher_value !== undefined
        ? normalizeMatcherValue(nextMatcherType, body?.matcher_value)
        : normalizeMatcherValue(nextMatcherType, existing?.matcher_value);

    const existingFallback = normalizeLegacyDestinationKey(existing?.destination_key);
    const existingRowForDestination = {
      destination_type: existing?.destination_type || existingFallback.destinationType,
      destination_value: existing?.destination_value || existingFallback.destinationValue,
    };

    const nextDestination =
      body?.destination_type !== undefined ||
      body?.destination_value !== undefined ||
      body?.destination_key !== undefined
        ? normalizeDestinationInput(body)
        : normalizeDestinationInput({}, existingRowForDestination);

    if (!nextMatcherType || !nextMatcherValue) {
      return NextResponse.json(
        { error: "Valid matcher_type and matcher_value are required." },
        { status: 400 }
      );
    }
    if (!nextDestination.destinationType || !nextDestination.destinationValue) {
      return NextResponse.json(
        { error: "Valid destination_type and destination_value are required." },
        { status: 400 }
      );
    }

    const validDestination = await validateDestination(
      serviceClient,
      scope.workspaceId,
      nextDestination.destinationType,
      nextDestination.destinationValue
    );
    if (!validDestination) {
      return NextResponse.json(
        { error: "Invalid destination for this workspace." },
        { status: 400 }
      );
    }

    const { data: conflict, error: conflictError } = await serviceClient
      .from("workspace_email_sender_rules")
      .select("id")
      .eq("workspace_id", scope.workspaceId)
      .eq("matcher_type", nextMatcherType)
      .eq("matcher_value", nextMatcherValue)
      .neq("id", ruleId)
      .maybeSingle();
    if (conflictError) {
      return NextResponse.json({ error: conflictError.message }, { status: 500 });
    }
    if (conflict?.id) {
      return NextResponse.json(
        { error: "A sender rule with this matcher already exists." },
        { status: 409 }
      );
    }

    const { data, error: updateError } = await serviceClient
      .from("workspace_email_sender_rules")
      .update({
        matcher_type: nextMatcherType,
        matcher_value: nextMatcherValue,
        destination_type: nextDestination.destinationType,
        destination_value: nextDestination.destinationValue,
        destination_key:
          nextDestination.destinationType === "classification"
            ? nextDestination.destinationValue
            : null,
        is_active:
          typeof body?.is_active === "boolean" ? body.is_active : Boolean(existing?.is_active),
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", scope.workspaceId)
      .eq("id", ruleId)
      .select(
        "id, matcher_type, matcher_value, destination_type, destination_value, destination_key, is_active, created_at, updated_at"
      )
      .maybeSingle();

    if (updateError || !data?.id) {
      return NextResponse.json(
        { error: updateError?.message || "Could not update sender rule." },
        { status: 500 }
      );
    }

    return NextResponse.json({ rule: formatRuleRow(data) }, { status: 200 });
  } catch (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json(
        {
          error:
            "Required sender-rules tables are missing. Run the SQL migrations for sender rules and inboxes first.",
        },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update sender rule." },
      { status: 500 }
    );
  }
}

export const PATCH = PUT;

export async function DELETE(request) {
  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  let body = {};
  try {
    body = (await request.json()) || {};
  } catch {
    body = {};
  }

  const ruleId = asString(body?.id) || asString(new URL(request.url).searchParams.get("id"));
  if (!ruleId) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  try {
    const { error, scope } = await resolveScope(serviceClient);
    if (error) return error;

    const { data: existing, error: existingError } = await serviceClient
      .from("workspace_email_sender_rules")
      .select("id")
      .eq("workspace_id", scope.workspaceId)
      .eq("id", ruleId)
      .maybeSingle();

    if (existingError || !existing?.id) {
      return NextResponse.json(
        { error: existingError?.message || "Sender rule not found." },
        { status: 404 }
      );
    }

    const { error: deleteError } = await serviceClient
      .from("workspace_email_sender_rules")
      .delete()
      .eq("workspace_id", scope.workspaceId)
      .eq("id", ruleId);
    if (deleteError) {
      return NextResponse.json(
        { error: deleteError.message || "Could not delete sender rule." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, id: ruleId }, { status: 200 });
  } catch (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json(
        {
          error:
            "Required sender-rules tables are missing. Run the SQL migrations for sender rules and inboxes first.",
        },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete sender rule." },
      { status: 500 }
    );
  }
}
