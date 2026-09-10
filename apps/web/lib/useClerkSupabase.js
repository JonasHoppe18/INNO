"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useRef } from "react";
import { createClerkSupabaseClient } from "../../../shared/supabase/createClient";
import { supabaseStorageAdapter } from "../../../shared/storage/tokenStorage";

// Hook der genbruger den fælles Supabase-klient på web.
// Web og mobil deler den samme implementation i /shared, så vi er sikre på at
// RLS + Clerk tokens virker identisk på begge platforme.
export function useClerkSupabase() {
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  const clientRef = useRef(null);

  // Clerk opdaterer getToken når sessionen ændrer sig – sørg for at hooken altid
  // bruger den nyeste reference.
  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  if (!clientRef.current) {
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.EXPO_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

    clientRef.current = createClerkSupabaseClient({
      supabaseUrl,
      supabaseAnonKey,
      // Den almindelige Clerk session token valideres af Supabase's native
      // Clerk-provider.
      getToken: (...args) => getTokenRef.current?.(...args),
      storage: supabaseStorageAdapter,
    });
  }

  return clientRef.current;
}
