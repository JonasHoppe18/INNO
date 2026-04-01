import { useAuth, useUser } from "@clerk/nextjs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useClerkSupabase } from "@/lib/useClerkSupabase";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isValidUuid = (value) => typeof value === "string" && UUID_REGEX.test(value);

const base64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const base64UrlToBase64 = (input) => {
  if (typeof input !== "string" || !input.length) {
    return "";
  }
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (normalized.length % 4)) % 4;
  return normalized.padEnd(normalized.length + padding, "=");
};

const decodeBase64 = (input) => {
  let result = "";
  let buffer = 0;
  let bits = 0;
  for (const char of input) {
    if (char === "=") break;
    const value = base64Alphabet.indexOf(char);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    while (bits >= 8) {
      bits -= 8;
      const byte = (buffer >> bits) & 0xff;
      result += String.fromCharCode(byte);
    }
  }
  return result;
};

const decodeJwtPayload = (token) => {
  if (typeof token !== "string" || !token.includes(".")) {
    return null;
  }
  const [, payloadPart] = token.split(".");
  if (!payloadPart) {
    return null;
  }
  try {
    const normalized = base64UrlToBase64(payloadPart);
    const decoded = decodeBase64(normalized);
    return JSON.parse(decoded);
  } catch (_err) {
    return null;
  }
};

const SUPABASE_TEMPLATE =
  process.env.NEXT_PUBLIC_CLERK_SUPABASE_TEMPLATE?.trim() || "supabase";

export function useAgentPersonaConfig(options = {}) {
  const { lazy = false, userId: providedUserId } = options;
  const supabase = useClerkSupabase();
  const { getToken } = useAuth();
  const { user } = useUser();

  const [persona, setPersona] = useState(null);
  const [loading, setLoading] = useState(!lazy);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [testState, setTestState] = useState({
    loading: false,
    error: null,
    result: "",
  });

  const toPersona = useCallback((row) => {
    if (!row) return null;
    return {
      userId: row.user_id,
      signature: row.signature ?? "",
      scenario: row.scenario ?? "",
      instructions: row.instructions ?? "",
      updatedAt: row.updated_at ?? null,
    };
  }, []);

  const ensureUserId = useCallback(async () => {
    if (providedUserId) return providedUserId;

    const metadataUuid = user?.publicMetadata?.supabase_uuid;
    if (isValidUuid(metadataUuid)) {
      return metadataUuid;
    }

    if (typeof getToken === "function") {
      try {
        const templateToken = await getToken({ template: SUPABASE_TEMPLATE });
        const payload = decodeJwtPayload(templateToken);
        const claimUuid =
          typeof payload?.supabase_user_id === "string" ? payload.supabase_user_id : null;
        const sub = typeof payload?.sub === "string" ? payload.sub : null;
        const candidate = isValidUuid(claimUuid) ? claimUuid : sub;
        if (isValidUuid(candidate)) {
          return candidate;
        }
      } catch (tokenError) {
        console.warn("useAgentPersonaConfig(web): clerk token missing supabase uuid", tokenError);
      }
    }

    if (!supabase || !user?.id) {
      throw new Error("Supabase user ID is not ready yet.");
    }

    const { data, error: profileError } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("clerk_user_id", user.id)
      .maybeSingle();

    if (profileError) {
      throw profileError;
    }

    const candidate = data?.user_id;
    if (isValidUuid(candidate)) {
      return candidate;
    }
    throw new Error("Supabase user ID is not ready yet.");
  }, [providedUserId, user?.publicMetadata?.supabase_uuid, getToken, supabase, user?.id]);

  const loadPersona = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/persona");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Could not load persona.");
      setPersona(toPersona(body.persona));
      return body.persona;
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Could not load persona."));
      throw err;
    } finally {
      setLoading(false);
    }
  }, [toPersona]);

  const savePersona = useCallback(
    async (updates) => {
      setSaving(true);
      setError(null);
      try {
        const payload = {
          signature: updates.signature ?? persona?.signature ?? null,
          scenario: updates.scenario ?? persona?.scenario ?? null,
          instructions: updates.instructions ?? persona?.instructions ?? null,
        };

        const res = await fetch("/api/persona", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || "Could not save persona.");
        setPersona(toPersona(body.persona));
        return body.persona;
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Could not save persona."));
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [persona, toPersona]
  );

  const runPersonaTest = useCallback(
    async (overrides = {}) => {
      setTestState({ loading: true, error: null, result: "" });
      try {
        const signatureInput =
          typeof overrides.signature === "string"
            ? overrides.signature
            : persona?.signature ?? "";
        const scenarioInput =
          typeof overrides.scenario === "string"
            ? overrides.scenario
            : persona?.scenario ?? "";
        const instructionsInput =
          typeof overrides.instructions === "string"
            ? overrides.instructions
            : persona?.instructions ?? "";

        const payload = {
          signature: signatureInput.trim().length
            ? signatureInput.trim()
            : "Best regards\nYour agent",
          scenario: scenarioInput,
          instructions: instructionsInput,
          ...(overrides.emailLanguage ? { emailLanguage: overrides.emailLanguage } : {}),
        };

        const response = await fetch("/api/persona-test", {
          method: "POST",
          body: JSON.stringify(payload),
        });

        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          const errMessage =
            typeof body?.error === "string"
              ? body.error
              : `Persona test failed (${response.status}).`;
          throw new Error(errMessage);
        }

        const reply =
          typeof body?.reply === "string" && body.reply.trim().length
            ? body.reply.trim()
            : "The test returned no response.";
        setTestState({ loading: false, error: null, result: reply });
        return reply;
      } catch (err) {
        const normalized =
          err instanceof Error
            ? err.message === "Failed to fetch"
              ? new Error("Could not reach the persona test. Try again in a moment.")
              : err
            : new Error("Unknown error during the test.");
        setTestState({ loading: false, error: normalized, result: "" });
        throw normalized;
      }
    },
    [getToken, persona?.signature, persona?.scenario, persona?.instructions]
  );

  useEffect(() => {
    if (!lazy) {
      loadPersona().catch(() => null);
    }
  }, [lazy, loadPersona]);

  return useMemo(
    () => ({
      persona,
      loading,
      saving,
      error,
      refresh: loadPersona,
      save: savePersona,
      test: testState,
      testPersona: runPersonaTest,
    }),
    [persona, loading, saving, error, loadPersona, savePersona, testState, runPersonaTest]
  );
}
