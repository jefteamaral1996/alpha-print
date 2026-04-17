// ============================================================
// Supabase Client — Auth e conexao para o Alpha Print
// Mesmo projeto Supabase do Alpha Cardapio (portal.alphacardapio.com)
// ============================================================

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import store, { clearAuth, hasSavedCredentials } from "./store";

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

  // Save tokens and credentials for auto re-login
  store.set("accessToken", data.session.access_token);
  store.set("refreshToken", data.session.refresh_token);
  store.set("userEmail", email);
  store.set("savedPassword", password);

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
 * Helper: sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Restore session from stored tokens.
 * Returns true if session is valid and active.
 *
 * NEVER clears auth on failure — preserves credentials for auto re-login.
 * The app should NEVER show login screen unless the user clicks "Sair".
 */
export async function restoreSession(): Promise<boolean> {
  const accessToken = store.get("accessToken");
  const refreshToken = store.get("refreshToken");

  if (!accessToken || !refreshToken) {
    // No tokens stored — try auto re-login with saved credentials
    console.log("[Auth] No tokens — attempting auto re-login with saved credentials");
    return autoReLogin();
  }

  const client = getSupabase();

  // Try setSession first
  const { data, error } = await client.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  if (!error && data.session) {
    // Success — update tokens
    store.set("accessToken", data.session.access_token);
    store.set("refreshToken", data.session.refresh_token);
    return true;
  }

  // setSession failed — try refresh with retry/backoff
  console.log("[Auth] setSession failed, trying refresh with retry...");
  const refreshResult = await refreshWithRetry(refreshToken);

  if (refreshResult) {
    return true;
  }

  // All refresh attempts failed — try auto re-login with saved credentials
  console.log("[Auth] All refresh attempts failed — attempting auto re-login");
  return autoReLogin();
}

/**
 * Try to refresh the token with exponential backoff.
 * Retries up to 5 times: 1s, 2s, 4s, 8s, 16s.
 * Returns true if refresh succeeded.
 */
async function refreshWithRetry(refreshToken: string): Promise<boolean> {
  const client = getSupabase();
  const MAX_RETRIES = 5;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const delay = Math.min(1000 * Math.pow(2, attempt), 16000);

    if (attempt > 0) {
      console.log(`[Auth] Refresh retry ${attempt}/${MAX_RETRIES} — waiting ${delay / 1000}s`);
      await sleep(delay);
    }

    try {
      const { data: refreshData, error: refreshError } =
        await client.auth.refreshSession({ refresh_token: refreshToken });

      if (!refreshError && refreshData.session) {
        store.set("accessToken", refreshData.session.access_token);
        store.set("refreshToken", refreshData.session.refresh_token);
        console.log(`[Auth] Token refresh succeeded on attempt ${attempt + 1}`);
        return true;
      }

      console.log(`[Auth] Refresh attempt ${attempt + 1} failed: ${refreshError?.message || "no session"}`);
    } catch (err) {
      console.error(`[Auth] Refresh attempt ${attempt + 1} threw error:`, err);
    }
  }

  return false;
}

/**
 * Auto re-login using saved credentials (email + password).
 * This is the last resort when tokens are completely dead.
 * Returns true if re-login succeeded.
 *
 * NEVER clears credentials on failure — keeps retrying on next attempt.
 */
export async function autoReLogin(): Promise<boolean> {
  if (!hasSavedCredentials()) {
    console.log("[Auth] No saved credentials — cannot auto re-login");
    return false;
  }

  const email = store.get("userEmail");
  const password = store.get("savedPassword");

  console.log(`[Auth] Auto re-login for ${email}...`);

  const client = getSupabase();
  const MAX_RETRIES = 3;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const delay = Math.min(2000 * Math.pow(2, attempt), 16000);

    if (attempt > 0) {
      console.log(`[Auth] Re-login retry ${attempt}/${MAX_RETRIES} — waiting ${delay / 1000}s`);
      await sleep(delay);
    }

    try {
      const { data, error } = await client.auth.signInWithPassword({
        email,
        password,
      });

      if (!error && data.session) {
        store.set("accessToken", data.session.access_token);
        store.set("refreshToken", data.session.refresh_token);
        console.log(`[Auth] Auto re-login succeeded on attempt ${attempt + 1}`);
        return true;
      }

      console.log(`[Auth] Re-login attempt ${attempt + 1} failed: ${error?.message || "no session"}`);

      // If credentials are invalid (wrong password), don't retry
      if (error?.message?.includes("Invalid login credentials")) {
        console.error("[Auth] Saved credentials are invalid — clearing saved password only");
        store.set("savedPassword", "");
        return false;
      }
    } catch (err) {
      console.error(`[Auth] Re-login attempt ${attempt + 1} threw error:`, err);
    }
  }

  // All retries failed (likely network issue) — DO NOT clear credentials
  // Next attempt will try again
  console.log("[Auth] Auto re-login failed after all retries — credentials preserved for next attempt");
  return false;
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
 *
 * If periodic refresh fails, automatically attempts re-login
 * with saved credentials instead of leaving the session dead.
 */
export function startTokenRefresh(): NodeJS.Timeout {
  return setInterval(async () => {
    const refreshToken = store.get("refreshToken");

    if (!refreshToken) {
      // No refresh token — try auto re-login
      console.log("[Auth] No refresh token during periodic refresh — attempting auto re-login");
      await autoReLogin();
      return;
    }

    const client = getSupabase();
    const { data, error } = await client.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (!error && data.session) {
      store.set("accessToken", data.session.access_token);
      store.set("refreshToken", data.session.refresh_token);
      console.log("[Auth] Token refreshed");
    } else {
      console.error("[Auth] Periodic token refresh failed:", error?.message);
      // Try refresh with retry first, then auto re-login as last resort
      const refreshed = await refreshWithRetry(refreshToken);
      if (!refreshed) {
        console.log("[Auth] Periodic refresh retries exhausted — attempting auto re-login");
        await autoReLogin();
      }
    }
  }, 50 * 60 * 1000); // Every 50 minutes
}
