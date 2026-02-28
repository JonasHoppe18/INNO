import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope } from "@/lib/server/workspace-auth";

const SUPABASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeInboxName(value = "") {
  return asString(value).replace(/\s+/g, " ").slice(0, 50);
}

function slugifyName(value = "") {
  return normalizeInboxName(value)
    .toLowerCase()
    .replace(/[^a-z0-9-_ ]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function extractInboxesFromTags(threads = []) {
  const map = new Map();
  for (const thread of threads) {
    const tags = Array.isArray(thread?.tags) ? thread.tags : [];
    for (const tag of tags) {
      const text = String(tag || "");
      if (!text.startsWith("inbox:")) continue;
      const slug = text.slice("inbox:".length).trim();
      if (!slug) continue;
      if (!map.has(slug)) {
        map.set(slug, {
          id: `tag-${slug}`,
          slug,
          name: slug
            .split("-")
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(" "),
          source: "mail_threads",
        });
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

const isMissingTableError = (error) =>
  /relation .*workspace_inboxes.* does not exist/i.test(String(error?.message || ""));

async function loadInboxesFromWorkspaceTable(serviceClient, scope) {
  const query = serviceClient
    .from("workspace_inboxes")
    .select("id, name, slug, created_at")
    .eq("workspace_id", scope.workspaceId)
    .order("created_at", { ascending: true });
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    source: "workspace_inboxes",
  }));
}

export async function GET() {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  try {
    const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
    if (!scope.workspaceId) {
      return NextResponse.json({ inboxes: [] }, { status: 200 });
    }

    try {
      const inboxes = await loadInboxesFromWorkspaceTable(serviceClient, scope);
      return NextResponse.json({ inboxes }, { status: 200 });
    } catch (tableError) {
      if (!isMissingTableError(tableError)) {
        return NextResponse.json({ error: tableError.message }, { status: 500 });
      }
    }
    const scoped = await serviceClient
      .from("mail_threads")
      .select("tags")
      .eq("workspace_id", scope.workspaceId)
      .limit(2000);
    if (scoped.error) {
      return NextResponse.json({ error: scoped.error.message }, { status: 500 });
    }
    const inboxes = extractInboxesFromTags(Array.isArray(scoped.data) ? scoped.data : []);
    return NextResponse.json({ inboxes }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load inboxes." },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  let body = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const inboxName = normalizeInboxName(body?.name || "");
  const slug = slugifyName(inboxName);
  if (!inboxName || !slug) {
    return NextResponse.json({ error: "Inbox name is required." }, { status: 400 });
  }

  try {
    const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
    if (!scope.workspaceId) {
      return NextResponse.json(
        { error: "Workspace is required for custom inboxes." },
        { status: 400 }
      );
    }

    const { error: insertError, data } = await serviceClient
      .from("workspace_inboxes")
      .insert({
        name: inboxName,
        slug,
        workspace_id: scope.workspaceId,
        user_id: null,
        created_by: scope.supabaseUserId ?? null,
        updated_by: scope.supabaseUserId ?? null,
      })
      .select("id, name, slug")
      .maybeSingle();

    if (insertError) {
      if (isMissingTableError(insertError)) {
        return NextResponse.json(
          {
            error:
              "Table workspace_inboxes is missing. Create it first before using custom inboxes.",
          },
          { status: 500 }
        );
      }
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json(
      {
        inbox: {
          id: data?.id || `inbox-${slug}`,
          name: data?.name || inboxName,
          slug: data?.slug || slug,
          source: "workspace_inboxes",
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create inbox." },
      { status: 500 }
    );
  }
}

export async function DELETE(request) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  let body = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const slug = slugifyName(body?.slug || "");
  if (!slug) {
    return NextResponse.json({ error: "slug is required." }, { status: 400 });
  }

  try {
    const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
    if (!scope.workspaceId) {
      return NextResponse.json(
        { error: "Workspace is required for custom inboxes." },
        { status: 400 }
      );
    }

    const deleteQuery = serviceClient
      .from("workspace_inboxes")
      .delete()
      .eq("workspace_id", scope.workspaceId)
      .eq("slug", slug)
      .select("id, slug")
      .maybeSingle();
    const { data: deletedInbox, error: deleteError } = await deleteQuery;

    if (deleteError) {
      if (isMissingTableError(deleteError)) {
        return NextResponse.json(
          {
            error:
              "Table workspace_inboxes is missing. Create it first before deleting custom inboxes.",
          },
          { status: 500 }
        );
      }
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }
    if (!deletedInbox?.id) {
      return NextResponse.json({ error: "Inbox not found." }, { status: 404 });
    }

    const inboxTag = `inbox:${slug}`;
    const scopedThreadsQuery = serviceClient
      .from("mail_threads")
      .select("id, tags")
      .eq("workspace_id", scope.workspaceId)
      .contains("tags", [inboxTag]);
    const { data: taggedThreads, error: threadsError } = await scopedThreadsQuery;
    if (threadsError) {
      return NextResponse.json({ error: threadsError.message }, { status: 500 });
    }

    const threadsToUpdate = Array.isArray(taggedThreads) ? taggedThreads : [];
    const cleanupResults = await Promise.all(
      threadsToUpdate.map(async (thread) => {
        const tags = Array.isArray(thread?.tags) ? thread.tags : [];
        const nextTags = tags.filter((tag) => String(tag || "") !== inboxTag);
        const updateQuery = serviceClient
          .from("mail_threads")
          .update({ tags: nextTags })
          .eq("workspace_id", scope.workspaceId)
          .eq("id", thread.id);
        return updateQuery;
      })
    );
    const cleanupError = cleanupResults.find((result) => result?.error)?.error;
    if (cleanupError) {
      return NextResponse.json({ error: cleanupError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, slug }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete inbox." },
      { status: 500 }
    );
  }
}
