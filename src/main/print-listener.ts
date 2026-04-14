// ============================================================
// Print Listener — Escuta print_jobs via Supabase Realtime
// Quando um novo job chega com status=pending, imprime e atualiza
// Inclui reconexao automatica quando a internet cair e voltar
// ============================================================

import { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";
import store, { getDeviceId } from "./store";
import { printRaw } from "./printer";

type PrintCallback = (event: {
  type: "printing" | "printed" | "failed";
  jobId: string;
  printerName: string;
  error?: string;
}) => void;

let channel: RealtimeChannel | null = null;
let presenceChannel: RealtimeChannel | null = null;
let callback: PrintCallback | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let isActive = false;
// Track processed job IDs to prevent double-printing
const processedJobs = new Set<string>();

// Clean up processed jobs set periodically (prevent memory leak)
const PROCESSED_JOBS_MAX = 500;

function cleanupProcessedJobs(): void {
  if (processedJobs.size > PROCESSED_JOBS_MAX) {
    const arr = Array.from(processedJobs);
    processedJobs.clear();
    // Keep only the most recent ones
    for (const id of arr.slice(-200)) {
      processedJobs.add(id);
    }
  }
}

/**
 * Start listening for print jobs on the current store.
 * Also tracks presence so the web UI knows we're online.
 * Includes automatic reconnection on connection loss.
 */
export function startListening(onEvent: PrintCallback): void {
  const storeId = store.get("storeId");
  if (!storeId) {
    console.error("[PrintListener] No store_id configured");
    return;
  }

  callback = onEvent;
  isActive = true;

  setupChannels(storeId);

  // Process any pending jobs that were queued while we were offline
  processPendingJobs();

  console.log("[PrintListener] Listening for print jobs on store:", storeId);
}

/**
 * Set up Realtime channels with reconnection handling.
 */
function setupChannels(storeId: string): void {
  const supabase = getSupabase();
  const deviceId = getDeviceId();
  const selectedPrinter = store.get("selectedPrinter");

  // 1. Track presence so the web UI knows Alpha Print is online
  presenceChannel = supabase.channel(`alpha-print:${storeId}`, {
    config: { presence: { key: storeId } },
  });

  presenceChannel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      await presenceChannel!.track({
        device_id: deviceId,
        printer_name: selectedPrinter,
        online_at: new Date().toISOString(),
      });
      console.log("[Presence] Tracking started");
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      console.error("[Presence] Channel error/timeout, scheduling reconnect");
      scheduleReconnect(storeId);
    }
  });

  // 2. Listen for new print jobs via postgres_changes
  channel = supabase
    .channel(`print-jobs-listener:${storeId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "print_jobs",
        filter: `store_id=eq.${storeId}`,
      },
      (payload) => {
        const job = payload.new as {
          id: string;
          status: string;
          printer_name: string;
          raw_data: string;
          copies: number;
        };
        if (job.status === "pending" && !processedJobs.has(job.id)) {
          processJob(job);
        }
      }
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        console.log("[PrintListener] Realtime channel connected");
        // On reconnect, check for any jobs we missed
        processPendingJobs();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.error("[PrintListener] Channel error/timeout, scheduling reconnect");
        scheduleReconnect(storeId);
      }
    });
}

/**
 * Schedule a reconnection attempt after a delay.
 * Uses exponential backoff capped at 30 seconds.
 */
let reconnectAttempts = 0;

function scheduleReconnect(storeId: string): void {
  if (!isActive) return;
  if (reconnectTimer) return; // Already scheduled

  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
  reconnectAttempts++;

  console.log(`[PrintListener] Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempts})`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!isActive) return;

    console.log("[PrintListener] Attempting reconnection...");

    // Clean up old channels
    const supabase = getSupabase();
    if (channel) {
      try { supabase.removeChannel(channel); } catch { /* ignore */ }
      channel = null;
    }
    if (presenceChannel) {
      try { supabase.removeChannel(presenceChannel); } catch { /* ignore */ }
      presenceChannel = null;
    }

    // Re-setup channels
    setupChannels(storeId);

    // Reset attempts on successful reconnect (checked via channel status callback)
    reconnectAttempts = Math.max(0, reconnectAttempts - 1);
  }, delay);
}

/**
 * Stop listening and untrack presence.
 */
export function stopListening(): void {
  isActive = false;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  const supabase = getSupabase();

  if (channel) {
    try { supabase.removeChannel(channel); } catch { /* ignore */ }
    channel = null;
  }
  if (presenceChannel) {
    try { supabase.removeChannel(presenceChannel); } catch { /* ignore */ }
    presenceChannel = null;
  }

  callback = null;
  reconnectAttempts = 0;
  console.log("[PrintListener] Stopped");
}

/**
 * Update presence with new printer info (when user changes printer).
 */
export async function updatePresence(): Promise<void> {
  if (!presenceChannel) return;

  const deviceId = getDeviceId();
  const selectedPrinter = store.get("selectedPrinter");

  try {
    await presenceChannel.track({
      device_id: deviceId,
      printer_name: selectedPrinter,
      online_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[Presence] Failed to update presence:", err);
  }
}

/**
 * Process pending jobs that accumulated while offline.
 */
async function processPendingJobs(): Promise<void> {
  const storeId = store.get("storeId");
  if (!storeId) return;

  const supabase = getSupabase();

  try {
    const { data: jobs, error } = await supabase
      .from("print_jobs")
      .select("id, printer_name, raw_data, copies, status")
      .eq("store_id", storeId)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(50);

    if (error || !jobs) {
      console.error("[PrintListener] Error fetching pending jobs:", error?.message);
      return;
    }

    console.log(`[PrintListener] Found ${jobs.length} pending jobs`);

    for (const job of jobs) {
      if (!processedJobs.has((job as any).id)) {
        await processJob(job as any);
      }
    }
  } catch (err) {
    console.error("[PrintListener] Error in processPendingJobs:", err);
  }
}

/**
 * Process a single print job: print and update status.
 */
async function processJob(job: {
  id: string;
  printer_name: string;
  raw_data: string;
  copies: number;
}): Promise<void> {
  // Mark as being processed to prevent duplicate prints
  if (processedJobs.has(job.id)) return;
  processedJobs.add(job.id);
  cleanupProcessedJobs();

  const supabase = getSupabase();
  const deviceId = getDeviceId();

  // Determine which printer to use
  // If job specifies a printer, use that; otherwise use our selected printer
  const printerName = job.printer_name || store.get("selectedPrinter");

  if (!printerName) {
    // No printer configured — mark as failed
    await supabase
      .from("print_jobs")
      .update({
        status: "failed",
        error: "Nenhuma impressora configurada no Alpha Print",
        device_id: deviceId,
      } as any)
      .eq("id", job.id);

    callback?.({
      type: "failed",
      jobId: job.id,
      printerName: "",
      error: "Nenhuma impressora configurada",
    });
    return;
  }

  // Mark as printing
  await supabase
    .from("print_jobs")
    .update({
      status: "printing",
      device_id: deviceId,
    } as any)
    .eq("id", job.id);

  callback?.({
    type: "printing",
    jobId: job.id,
    printerName,
  });

  try {
    // Print!
    await printRaw(printerName, job.raw_data, job.copies || 1);

    // Mark as printed
    await supabase
      .from("print_jobs")
      .update({
        status: "printed",
        printed_at: new Date().toISOString(),
        device_id: deviceId,
      } as any)
      .eq("id", job.id);

    callback?.({
      type: "printed",
      jobId: job.id,
      printerName,
    });

    // Reset reconnect counter on successful print (connection is healthy)
    reconnectAttempts = 0;

    console.log(`[PrintListener] Job ${job.id} printed on ${printerName}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Erro desconhecido";

    // Mark as failed
    await supabase
      .from("print_jobs")
      .update({
        status: "failed",
        error: errorMsg,
        device_id: deviceId,
      } as any)
      .eq("id", job.id);

    callback?.({
      type: "failed",
      jobId: job.id,
      printerName,
      error: errorMsg,
    });

    console.error(`[PrintListener] Job ${job.id} failed:`, errorMsg);
  }
}
