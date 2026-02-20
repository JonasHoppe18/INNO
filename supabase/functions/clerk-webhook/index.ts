import { serve } from "https://deno.land/std/http/server.ts";
import { Webhook } from "https://esm.sh/svix@1";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isValidUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID_REGEX.test(value);

// Finder brugers primære e-mail, Clerk sender både liste og reference-id.
const extractPrimaryEmail = (user: any): string | null => {
  if (!user) return null;
  const addresses = Array.isArray(user.email_addresses)
    ? user.email_addresses
    : [];

  if (!addresses.length) return null;

  const primary =
    addresses.find(
      (address: any) => address?.id === user.primary_email_address_id,
    ) ?? addresses[0];

  return typeof primary?.email_address === "string"
    ? primary.email_address
    : null;
};

// Sikrer at der findes en Supabase auth-bruger tilknyttet Clerk-brugeren og returnerer dens uuid.
type EnsureUserOptions = {
  projectUrl: string | null;
  serviceRoleKey: string | null;
};

const upsertWorkspace = async (
  supabase: any,
  orgId: string,
  name: string | null,
): Promise<string | null> => {
  if (!orgId) return null;
  const payload: Record<string, unknown> = { clerk_org_id: orgId };
  if (typeof name === "string") {
    payload.name = name;
  }
  const { data, error } = await supabase
    .from("workspaces")
    .upsert(payload, { onConflict: "clerk_org_id" })
    .select("id")
    .maybeSingle();
  if (error) {
    throw new Error(`Workspace upsert fejlede: ${error.message}`);
  }
  return data?.id ?? null;
};

const resolveWorkspaceIdByOrgId = async (
  supabase: any,
  orgId: string | null | undefined,
): Promise<string | null> => {
  if (!orgId) return null;
  const { data, error } = await supabase
    .from("workspaces")
    .select("id")
    .eq("clerk_org_id", orgId)
    .maybeSingle();
  if (error) {
    throw new Error(`Workspace lookup fejlede: ${error.message}`);
  }
  return data?.id ?? null;
};

const upsertWorkspaceMember = async (
  supabase: any,
  workspaceId: string,
  clerkUserId: string,
  role: string,
) => {
  const { error } = await supabase
    .from("workspace_members")
    .upsert(
      {
        workspace_id: workspaceId,
        clerk_user_id: clerkUserId,
        role: role || "member",
      },
      { onConflict: "workspace_id,clerk_user_id" },
    );
  if (error) {
    throw new Error(`Workspace member upsert fejlede: ${error.message}`);
  }
};

const resolveAuthUserId = async (
  supabase: any,
  candidateId: string | null | undefined,
  expectedClerkUserId: string,
): Promise<string | null> => {
  if (!isValidUuid(candidateId)) {
    return null;
  }

  const { data, error } = await supabase.auth.admin.getUserById(candidateId);
  if (error || !data?.user?.id) {
    return null;
  }

  const linkedClerkId = data.user?.user_metadata?.clerk_user_id;
  if (linkedClerkId && linkedClerkId !== expectedClerkUserId) {
    return null;
  }

  return data.user.id;
};

const fetchAuthUserByEmail = async (
  email: string,
  expectedClerkUserId: string,
  options: EnsureUserOptions,
): Promise<string | null> => {
  const { projectUrl, serviceRoleKey } = options;
  if (!projectUrl || !serviceRoleKey) return null;

  try {
    const baseUrl = projectUrl.replace(/\/$/, "");
    const url = new URL("/auth/v1/admin/users", baseUrl);
    url.searchParams.set("email", email);

    const response = await fetch(url, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.warn(
        `Kunne ikke hente auth-bruger via e-mail (${response.status}): ${await response
          .text()
          .catch(() => "ukendt fejl")}`,
      );
      return null;
    }

    const payload = await response.json().catch(() => null);
    if (!payload) return null;

    const users = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.users)
      ? payload.users
      : payload?.user
      ? [payload.user]
      : [];

    const candidate = users.find((entry: any) => {
      if (!isValidUuid(entry?.id)) {
        return false;
      }
      const linkedClerkId = entry?.user_metadata?.clerk_user_id;
      if (linkedClerkId && linkedClerkId !== expectedClerkUserId) {
        return false;
      }
      return true;
    });

    return isValidUuid(candidate?.id) ? candidate.id : null;
  } catch (err) {
    console.warn("Kunne ikke slå auth-bruger op via e-mail:", err);
    return null;
  }
};

const collectEmailCandidates = (user: any): Set<string> => {
  const emails = new Set<string>();

  const addresses = Array.isArray(user?.email_addresses)
    ? user.email_addresses
    : [];

  for (const entry of addresses) {
    const value =
      typeof entry?.email_address === "string"
        ? entry.email_address.trim().toLowerCase()
        : null;
    if (value) emails.add(value);
  }

  if (typeof user?.email === "string") {
    emails.add(user.email.trim().toLowerCase());
  }

  if (typeof user?.primary_email_address === "string") {
    emails.add(user.primary_email_address.trim().toLowerCase());
  }

  return emails;
};

const ensureSupabaseUser = async (
  supabase: any,
  clerkUser: any,
  email: string | null,
  options: EnsureUserOptions,
): Promise<string> => {
  const metadataCandidates = [
    clerkUser?.public_metadata?.supabase_uuid,
    clerkUser?.private_metadata?.supabase_uuid,
  ];

  for (const candidate of metadataCandidates) {
    const resolved = await resolveAuthUserId(
      supabase,
      candidate,
      clerkUser.id,
    );
    if (resolved) {
      return resolved;
    }
  }

  const { data: existingProfile, error: profileLookupError } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("clerk_user_id", clerkUser.id)
    .maybeSingle();

  if (profileLookupError) {
    throw new Error(
      `Kunne ikke slå eksisterende profil op: ${profileLookupError.message}`,
    );
  }

  if (existingProfile?.user_id && isValidUuid(existingProfile.user_id)) {
    const resolved = await resolveAuthUserId(
      supabase,
      existingProfile.user_id,
      clerkUser.id,
    );
    if (resolved) {
      return resolved;
    }
  }

  if (email) {
    const { data: profileByEmail, error: profileByEmailError } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("email", email)
      .maybeSingle();

    if (!profileByEmailError && isValidUuid(profileByEmail?.user_id)) {
      const resolved = await resolveAuthUserId(
        supabase,
        profileByEmail?.user_id,
        clerkUser.id,
      );
      if (resolved) {
        return resolved;
      }
    }

    const authIdFromEmail = await fetchAuthUserByEmail(
      email,
      clerkUser.id,
      options,
    );
    if (authIdFromEmail) {
      return authIdFromEmail;
    }
  }

  if (!email) {
    throw new Error(
      "Der kræves en e-mail for at kunne oprette en Supabase-bruger.",
    );
  }

  const randomPassword = `external-${crypto.randomUUID()}`;

  const { data: createdUser, error: createUserError } = await supabase.auth.admin.createUser({
    email,
    password: randomPassword,
    email_confirm: true,
    user_metadata: {
      clerk_user_id: clerkUser.id,
      first_name: clerkUser?.first_name ?? null,
      last_name: clerkUser?.last_name ?? null,
    },
    app_metadata: {
      provider: "clerk",
    },
  });

  if (createUserError) {
    if (email) {
      const duplicateHints: Array<boolean> = [];

      if (typeof createUserError?.message === "string") {
        duplicateHints.push(/(already|duplicate|exists)/i.test(createUserError.message));
      }

      if (typeof createUserError?.code === "string") {
        duplicateHints.push(/(already|duplicate|exists)/i.test(createUserError.code));
      }

      if (typeof createUserError?.status === "number") {
        duplicateHints.push([409, 422].includes(createUserError.status));
      }

      if (duplicateHints.some(Boolean)) {
        const fallbackId = await fetchAuthUserByEmail(
          email,
          clerkUser.id,
          options,
        );
        if (fallbackId) {
          return fallbackId;
        }
      }
    }

    console.error("Kunne ikke oprette Supabase-brugeren:", {
      message: createUserError?.message,
      status: createUserError?.status,
      code: createUserError?.code,
    });

    throw new Error(
      `Kunne ikke oprette Supabase-brugeren: ${createUserError.message}`,
    );
  }

  const supabaseUserId = createdUser?.user?.id;
  if (!isValidUuid(supabaseUserId)) {
    throw new Error("Supabase returnerede et ugyldigt bruger-id.");
  }

  return supabaseUserId;
};

// Simpel Clerk webhook, sørger for at vi kun reagerer på POST
serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Læs rå payload og Svix-headere som Clerk kræver
  const payload = await req.text();
  const headers = {
    "svix-id": req.headers.get("svix-id") ?? "",
    "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
    "svix-signature": req.headers.get("svix-signature") ?? "",
  };

  const CLERK_SECRET = Deno.env.get("CLERK_WEBHOOK_SECRET");
  if (!CLERK_SECRET) {
    return new Response("Missing CLERK_WEBHOOK_SECRET", { status: 500 });
  }

  let evt;
  try {
    const wh = new Webhook(CLERK_SECRET);
    evt = wh.verify(payload, headers);
  } catch (_err) {
    // Clerk/Svix fortæller at signaturen ikke matcher → 400 er forventet
    return new Response("Invalid signature", { status: 400 });
  }

  const { type, data } = evt;

  // Vi forbinder først til Supabase efter vi har verificeret eventet
  const PROJECT_URL = Deno.env.get("PROJECT_URL") ?? Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY =
    Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!PROJECT_URL || !SERVICE_ROLE_KEY) {
    return new Response("Missing Supabase secrets", { status: 500 });
  }

  const supabase = createClient(PROJECT_URL, SERVICE_ROLE_KEY);

  try {
    if (type === "user.created" || type === "user.updated") {
      const email = extractPrimaryEmail(data);
      let supabaseUserId: string;

      try {
        supabaseUserId = await ensureSupabaseUser(supabase, data, email, {
          projectUrl: PROJECT_URL,
          serviceRoleKey: SERVICE_ROLE_KEY,
        });
      } catch (syncError: any) {
        console.error("Kunne ikke synkronisere Supabase-bruger:", syncError);
        return new Response(
          `Supabase sync fejlede: ${syncError?.message ?? syncError}`,
          { status: 500 },
        );
      }

      if (email) {
        const { error: updateAuthError } = await supabase.auth.admin.updateUserById(
          supabaseUserId,
          {
            email,
            email_confirm: true,
            user_metadata: {
              clerk_user_id: data.id,
              first_name: data?.first_name ?? null,
              last_name: data?.last_name ?? null,
            },
          },
        );

        if (updateAuthError) {
          console.warn(
            `Kunne ikke opdatere Supabase-auth-bruger (${supabaseUserId}): ${updateAuthError.message}`,
          );
        }
      }

      // Opdater profil-tabellen når Clerk-bruger oprettes/ændres
      const { error } = await supabase
        .from("profiles")
        .upsert(
          {
            clerk_user_id: data.id,
            email,
            first_name: data.first_name ?? null,
            last_name: data.last_name ?? null,
            image_url: data.image_url ?? null,
            user_id: supabaseUserId,
          },
          { onConflict: "clerk_user_id" }
        );

      if (error) {
        return new Response(`Upsert error: ${error.message}`, { status: 500 });
      }

      // Sikrer default-række i agent_persona og agent_automation
      await supabase
        .from("agent_persona")
        .upsert(
          {
            user_id: supabaseUserId,
            signature: `Venlig hilsen\n${data?.first_name ?? "Din agent"}`,
            scenario: "",
            instructions: "",
          },
          { onConflict: "user_id", ignoreDuplicates: true }
        );

      await supabase
        .from("agent_automation")
        .upsert(
          {
            user_id: supabaseUserId,
          },
          { onConflict: "user_id", ignoreDuplicates: true }
        );
    } else if (type === "user.deleted") {
      const candidateIds = new Set<string>();

      const metadataCandidates = [
        data?.public_metadata?.supabase_uuid,
        data?.private_metadata?.supabase_uuid,
      ];
      metadataCandidates.forEach((value: unknown) => {
        if (typeof value === "string") {
          candidateIds.add(value);
        }
      });

      const emailCandidates = collectEmailCandidates(data);

      const {
        data: profileMatch,
        error: profileLookupError,
      } = await supabase
        .from("profiles")
        .select("user_id")
        .eq("clerk_user_id", data.id)
        .maybeSingle();

      if (profileLookupError) {
        return new Response(
          `Kunne ikke slå profil op ved sletning: ${profileLookupError.message}`,
          { status: 500 },
        );
      }

      if (profileMatch?.user_id) {
        candidateIds.add(profileMatch.user_id);
      }

      const emailLookupOptions: EnsureUserOptions = {
        projectUrl: PROJECT_URL,
        serviceRoleKey: SERVICE_ROLE_KEY,
      };

      for (const email of emailCandidates) {
        const fromEmail = await fetchAuthUserByEmail(
          email,
          data.id,
          emailLookupOptions,
        );
        if (fromEmail) {
          candidateIds.add(fromEmail);
        }
      }

      if (!candidateIds.size) {
        console.warn(
          `Ingen Supabase-auth kandidater fundet for Clerk bruger ${data?.id}`,
        );
      }

      let authDeleteError: string | null = null;

      for (const candidate of candidateIds) {
        const resolved = await resolveAuthUserId(supabase, candidate, data.id);
        if (!resolved) continue;

        const { error: deleteAuthError } = await supabase.auth.admin.deleteUser(
          resolved,
        );

        if (deleteAuthError) {
          authDeleteError = deleteAuthError.message ?? String(deleteAuthError);
          console.warn(
            `Kunne ikke slette Supabase-auth-bruger ${resolved}: ${authDeleteError}`,
          );
        } else {
          authDeleteError = null;
          break;
        }
      }

      if (authDeleteError) {
        return new Response(
          `Kunne ikke slette Supabase-auth-bruger: ${authDeleteError}`,
          { status: 500 },
        );
      }

      const { error: deleteProfileError } = await supabase
        .from("profiles")
        .delete()
        .eq("clerk_user_id", data.id);

      if (deleteProfileError) {
        return new Response(
          `Kunne ikke slette profil: ${deleteProfileError.message}`,
          { status: 500 },
        );
      }
    } else if (type === "organization.created") {
      const orgId = typeof data?.id === "string" ? data.id : "";
      const orgName =
        typeof data?.name === "string" && data.name.trim().length
          ? data.name.trim()
          : null;
      if (!orgId) {
        console.error("organization.created mangler data.id", { data });
        return new Response("organization.created mangler org id", { status: 400 });
      }
      const workspaceId = await upsertWorkspace(supabase, orgId, orgName);
      if (!workspaceId) {
        console.error("organization.created kunne ikke oprette workspace", {
          orgId,
          orgName,
        });
        return new Response("Kunne ikke oprette workspace", { status: 500 });
      }
    } else if (type === "organizationMembership.created") {
      const orgId =
        typeof data?.organization?.id === "string"
          ? data.organization.id
          : typeof data?.organization_id === "string"
          ? data.organization_id
          : "";
      const clerkUserId =
        typeof data?.public_user_data?.user_id === "string"
          ? data.public_user_data.user_id
          : typeof data?.public_user_data?.userId === "string"
          ? data.public_user_data.userId
          : "";
      const role =
        typeof data?.role === "string" && data.role.trim().length
          ? data.role.trim()
          : "member";

      if (!orgId || !clerkUserId) {
        console.error("organizationMembership.created mangler org/user", {
          orgId,
          clerkUserId,
          data,
        });
        return new Response("organizationMembership.created mangler org/user", {
          status: 400,
        });
      }

      let workspaceId = await resolveWorkspaceIdByOrgId(supabase, orgId);
      if (!workspaceId) {
        workspaceId = await upsertWorkspace(supabase, orgId, null);
      }
      if (!workspaceId) {
        console.error("organizationMembership.created kunne ikke finde/oprette workspace", {
          orgId,
          clerkUserId,
        });
        return new Response("Kunne ikke resolve workspace for organizationMembership", {
          status: 500,
        });
      }
      await upsertWorkspaceMember(supabase, workspaceId, clerkUserId, role);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  } catch (error: any) {
    return new Response(`Unhandled error: ${error?.message ?? error}`, {
      status: 500,
    });
  }
});
