// ============================================================
// Supabase Client — Auth e conexao para o Alpha Print
// Mesmo projeto Supabase do Alpha Cardapio (portal.alphacardapio.com)
// ============================================================

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import store, { clearAuth } from "./store";

// Mesmas credenciais do sistema web (anon key — seguro, RLS protege)
const SUPABASE_URL = "https://snpayrjxhjxzrcafaluy.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNucGF5cmp4aGp4enJjYWZhbHV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3Mjc2NDAsImV4cCI6MjA4MzMwMzY0MH0.H8AoRx2QnTnklF_ybnskQcoMIkFIcdfQRPa-JOKpBpE";

let supabase: SupabaseClient;

export function getSupabase(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false, // We manage tokens ourselves via electron-store
        autoRefreshToken: false,
      },
    });
  }
  return supabase;
}

/**
 * Login with email/password. Returns the store_id on success.
 */
export async function login(
  email: string,
  password: string
): Promise<{ success: boolean; error?: string; storeId?: string }> {
  const client = getSupabase();

  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session) {
    return {
      success: false,
      error: error?.message || "Falha no login",
    };
  }

  // Save tokens
  store.set("accessToken", data.session.access_token);
  store.set("refreshToken", data.session.refresh_token);
  store.set("userEmail", email);

  // Fetch store_id from profile
  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("store_id, stores(name)")
    .eq("id", data.user.id)
    .single();

  if (profileError || !profile?.store_id) {
    clearAuth();
    return {
      success: false,
      error: "Conta nao associada a nenhuma loja",
    };
  }

  store.set("storeId", profile.store_id);
  store.set("storeName", (profile as any).stores?.name || "");

  return { success: true, storeId: profile.store_id };
}

/**
 * Restore session from stored tokens.
 * Returns true if session is valid and active.
 */
export async function restoreSession(): Promise<boolean> {
  const accessToken = store.get("accessToken");
  const refreshToken = store.get("refreshToken");

  if (!accessToken || !refreshToken) return false;

  const client = getSupabase();

  const { data, error } = await client.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  if (error || !data.session) {
    // Try refresh
    const { data: refreshData, error: refreshError } =
      await client.auth.refreshSession({ refresh_token: refreshToken });

    if (refreshError || !refreshData.session) {
      clearAuth();
      return false;
    }

    // Save new tokens
    store.set("accessToken", refreshData.session.access_token);
    store.set("refreshToken", refreshData.session.refresh_token);
  } else {
    // Update tokens (may have been refreshed)
    store.set("accessToken", data.session.access_token);
    store.set("refreshToken", data.session.refresh_token);
  }

  return true;
}

/**
 * Logout — clear tokens and sign out from Supabase.
 */
export async function logout(): Promise<void> {
  const client = getSupabase();
  await client.auth.signOut().catch(() => {});
  clearAuth();
}

/**
 * Refresh token periodically (every 50 minutes).
 * Call this on app start; it sets up an interval.
 */
export function startTokenRefresh(): NodeJS.Timeout {
  return setInterval(async () => {
    const refreshToken = store.get("refreshToken");
    if (!refreshToken) return;

    const client = getSupabase();
    const { data, error } = await client.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (!error && data.session) {
      store.set("accessToken", data.session.access_token);
      store.set("refreshToken", data.session.refresh_token);
      console.log("[Auth] Token refreshed");
    } else {
      console.error("[Auth] Token refresh failed:", error?.message);
    }
  }, 50 * 60 * 1000); // Every 50 minutes
}
