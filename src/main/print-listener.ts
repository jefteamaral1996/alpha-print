// ============================================================
// Print Listener — Escuta print_jobs via Supabase Realtime
// Quando um novo job chega com status=pending, imprime e atualiza
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

/**
 * Start listening for print jobs on the current store.
 * Also tracks presence so the web UI knows we're online.
 */
export function startListening(onEvent: PrintCallback): void {
  const storeId = store.get("storeId");
  if (!storeId) {
    console.error("[PrintListener] No store_id configured");
    return;
  }

  callback = onEvent;
  const supabase = getSupabase();
  const deviceId = getDeviceId();
  const selectedPrinter = store.get("selectedPrinter");

  // 1. Track presence so the web UI knows Alpha Print is online
  presenceChannel = supabase.channel(`alpha-print:${storeId}`, {
    config: { presence: { key: storeId } },
  });

  presenceChannel
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await presenceChannel!.track({
          device_id: deviceId,
          printer_name: selectedPrinter,
          online_at: new Date().toISOString(),
        });
        console.log("[Presence] Tracking started");
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
        if (job.status === "pending") {
          processJob(job);
        }
      }
    )
    .subscribe();

  // 3. Process any pending jobs that were queued while we were offline
  processPendingJobs();

  console.log("[PrintListener] Listening for print jobs on store:", storeId);
}

/**
 * Stop listening and untrack presence.
 */
export function stopListening(): void {
  const supabase = getSupabase();

  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
  if (presenceChannel) {
    supabase.removeChannel(presenceChannel);
    presenceChannel = null;
  }

  callback = null;
  console.log("[PrintListener] Stopped");
}

/**
 * Update presence with new printer info (when user changes printer).
 */
export async function updatePresence(): Promise<void> {
  if (!presenceChannel) return;

  const deviceId = getDeviceId();
  const selectedPrinter = store.get("selectedPrinter");

  await presenceChannel.track({
    device_id: deviceId,
    printer_name: selectedPrinter,
    online_at: new Date().toISOString(),
  });
}

/**
 * Process pending jobs that accumulated while offline.
 */
async function processPendingJobs(): Promise<void> {
  const storeId = store.get("storeId");
  if (!storeId) return;

  const supabase = getSupabase();

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
    await processJob(job as any);
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
