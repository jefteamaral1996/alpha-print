// ============================================================
// Print Listener — Escuta print_jobs via Supabase Realtime
// Envia impressoras detectadas pro banco
// Recebe config de areas do portal via Realtime
// Usa area mappings para decidir qual impressora usar
// ============================================================

import { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";
import store, { getDeviceId } from "./store";
import { listPrinters, printRaw } from "./printer";

type PrintCallback = (event: {
  type: "printing" | "printed" | "failed" | "skipped";
  jobId: string;
  printerName: string;
  error?: string;
}) => void;

export interface PortalArea {
  id: string;
  name: string;
  area_type: string;
  enabled: boolean;
  copies: number;
  paper_width: number;
  print_receipt_types: string[];
}

type AreasChangeCallback = (areas: PortalArea[]) => void;
type PrintersChangeCallback = (printers: string[]) => void;

type ConnectionStatusCallback = (status: {
  internet: "online" | "offline" | "checking";
  server: "connected" | "disconnected" | "reconnecting";
  serverDetail?: string;
}) => void;

let channel: RealtimeChannel | null = null;
let presenceChannel: RealtimeChannel | null = null;
let areasChannel: RealtimeChannel | null = null;
let mappingsChannel: RealtimeChannel | null = null;
let callback: PrintCallback | null = null;
let areasChangeCallback: AreasChangeCallback | null = null;
let printersChangeCallback: PrintersChangeCallback | null = null;
let connectionStatusCallback: ConnectionStatusCallback | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let printerSyncTimer: NodeJS.Timeout | null = null;
let internetCheckTimer: NodeJS.Timeout | null = null;
let isActive = false;

// Connection status tracking
let currentInternetStatus: "online" | "offline" | "checking" = "checking";
let currentServerStatus: "connected" | "disconnected" | "reconnecting" = "disconnected";
let currentServerDetail: string | undefined;
let cachedAreas: PortalArea[] = [];
let cachedPrinters: string[] = [];

// Track processed job IDs to prevent double-printing
const processedJobs = new Set<string>();
const PROCESSED_JOBS_MAX = 500;

function cleanupProcessedJobs(): void {
  if (processedJobs.size > PROCESSED_JOBS_MAX) {
    const arr = Array.from(processedJobs);
    processedJobs.clear();
    for (const id of arr.slice(-200)) {
      processedJobs.add(id);
    }
  }
}

/**
 * Start listening for print jobs, sync printers, and receive area config.
 */
export function startListening(onEvent: PrintCallback): void {
  const storeId = store.get("storeId");
  if (!storeId) {
    console.error("[PrintListener] No store_id configured");
    return;
  }

  callback = onEvent;
  isActive = true;

  // Start internet connectivity monitoring
  startInternetCheck();

  setupChannels(storeId);

  // Sync printers to DB immediately and periodically
  syncPrintersToDb();
  printerSyncTimer = setInterval(syncPrintersToDb, 60000); // Every 60s

  // Load areas from portal, then load mappings (mappings need areas for names)
  loadAreasFromPortal().then(() => loadMappingsFromDb());

  // Process any pending jobs
  processPendingJobs();

  console.log("[PrintListener] Listening for print jobs on store:", storeId);
}

/**
 * Set up Realtime channels with reconnection handling.
 */
function setupChannels(storeId: string): void {
  const supabase = getSupabase();
  const deviceId = getDeviceId();
  const deviceName = store.get("deviceName") || "";

  // 1. Track presence so the web UI knows Alpha Print is online
  presenceChannel = supabase.channel(`alpha-print:${storeId}`, {
    config: { presence: { key: storeId } },
  });

  presenceChannel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      // Send presence with ALL detected printers (not just one)
      await presenceChannel!.track({
        device_id: deviceId,
        device_name: deviceName,
        printers: cachedPrinters,
        online_at: new Date().toISOString(),
      });
      console.log("[Presence] Tracking started with", cachedPrinters.length, "printers");
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      console.error("[Presence] Channel error/timeout, scheduling reconnect");
      currentServerStatus = "reconnecting";
      currentServerDetail = "Tentando reconectar...";
      emitConnectionStatus();
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
          print_area_id: string | null;
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
        currentServerStatus = "connected";
        currentServerDetail = "Recebendo pedidos";
        emitConnectionStatus();
        processPendingJobs();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.error("[PrintListener] Channel error/timeout, scheduling reconnect");
        currentServerStatus = "reconnecting";
        currentServerDetail = "Tentando reconectar...";
        emitConnectionStatus();
        scheduleReconnect(storeId);
      }
    });

  // 3. Listen for area changes from the portal
  areasChannel = supabase
    .channel(`print-areas-listener:${storeId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "print_areas",
        filter: `store_id=eq.${storeId}`,
      },
      () => {
        console.log("[PrintListener] Areas changed, reloading...");
        loadAreasFromPortal();
      }
    )
    .subscribe();

  // 4. Listen for mapping changes for this device
  mappingsChannel = supabase
    .channel(`device-mappings-listener:${storeId}:${deviceId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "device_area_mappings",
        filter: `store_id=eq.${storeId}`,
      },
      (payload) => {
        // For DELETE events, payload.new is null — use payload.old instead
        const row = (payload.new ?? payload.old) as { device_id?: string } | null;
        // Only reload if it's for our device
        if (row && row.device_id === deviceId) {
          console.log(`[PrintListener] Mappings ${payload.eventType} for this device, reloading...`);
          loadMappingsFromDb();
        }
      }
    )
    .subscribe();
}

/**
 * Schedule a reconnection attempt after a delay.
 */
let reconnectAttempts = 0;

function scheduleReconnect(storeId: string): void {
  if (!isActive) return;
  if (reconnectTimer) return;

  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
  reconnectAttempts++;

  console.log(`[PrintListener] Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempts})`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!isActive) return;

    console.log("[PrintListener] Attempting reconnection...");

    const supabase = getSupabase();
    if (channel) {
      try { supabase.removeChannel(channel); } catch { /* ignore */ }
      channel = null;
    }
    if (presenceChannel) {
      try { supabase.removeChannel(presenceChannel); } catch { /* ignore */ }
      presenceChannel = null;
    }
    if (areasChannel) {
      try { supabase.removeChannel(areasChannel); } catch { /* ignore */ }
      areasChannel = null;
    }
    if (mappingsChannel) {
      try { supabase.removeChannel(mappingsChannel); } catch { /* ignore */ }
      mappingsChannel = null;
    }

    setupChannels(storeId);
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

  if (printerSyncTimer) {
    clearInterval(printerSyncTimer);
    printerSyncTimer = null;
  }

  if (internetCheckTimer) {
    clearInterval(internetCheckTimer);
    internetCheckTimer = null;
  }

  currentServerStatus = "disconnected";
  currentServerDetail = undefined;
  emitConnectionStatus();

  const supabase = getSupabase();

  if (channel) {
    try { supabase.removeChannel(channel); } catch { /* ignore */ }
    channel = null;
  }
  if (presenceChannel) {
    try { supabase.removeChannel(presenceChannel); } catch { /* ignore */ }
    presenceChannel = null;
  }
  if (areasChannel) {
    try { supabase.removeChannel(areasChannel); } catch { /* ignore */ }
    areasChannel = null;
  }
  if (mappingsChannel) {
    try { supabase.removeChannel(mappingsChannel); } catch { /* ignore */ }
    mappingsChannel = null;
  }

  callback = null;
  reconnectAttempts = 0;
  console.log("[PrintListener] Stopped");
}

/**
 * Update presence with new device info.
 */
export async function updatePresence(): Promise<void> {
  if (!presenceChannel) return;

  const deviceId = getDeviceId();
  const deviceName = store.get("deviceName") || "";

  try {
    await presenceChannel.track({
      device_id: deviceId,
      device_name: deviceName,
      printers: cachedPrinters,
      online_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[Presence] Failed to update presence:", err);
  }
}

/**
 * Register callbacks for areas and printers changes.
 */
export function onAreasChange(cb: AreasChangeCallback): void {
  areasChangeCallback = cb;
}

export function onPrintersChange(cb: PrintersChangeCallback): void {
  printersChangeCallback = cb;
}

export function onConnectionStatusChange(cb: ConnectionStatusCallback): void {
  connectionStatusCallback = cb;
}

/**
 * Get the current connection status.
 */
export function getConnectionStatus(): {
  internet: "online" | "offline" | "checking";
  server: "connected" | "disconnected" | "reconnecting";
  serverDetail?: string;
} {
  return {
    internet: currentInternetStatus,
    server: currentServerStatus,
    serverDetail: currentServerDetail,
  };
}

/**
 * Emit connection status change to callback.
 */
function emitConnectionStatus(): void {
  connectionStatusCallback?.({
    internet: currentInternetStatus,
    server: currentServerStatus,
    serverDetail: currentServerDetail,
  });
}

/**
 * Check internet connectivity by fetching a known endpoint.
 */
async function checkInternet(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    await fetch("https://www.google.com/generate_204", {
      method: "HEAD",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return true;
  } catch {
    try {
      // Fallback: try Supabase health endpoint
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const supabase = getSupabase();
      // Just try a simple query as connectivity check
      await supabase.from("stores").select("id").limit(1).abortSignal(controller.signal);
      clearTimeout(timeoutId);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Periodically check internet connectivity and update status.
 */
async function startInternetCheck(): Promise<void> {
  const doCheck = async () => {
    const wasOnline = currentInternetStatus;
    const isOnline = await checkInternet();
    currentInternetStatus = isOnline ? "online" : "offline";

    if (wasOnline !== currentInternetStatus) {
      console.log(`[Connectivity] Internet: ${currentInternetStatus}`);
      emitConnectionStatus();
    }
  };

  await doCheck();
  internetCheckTimer = setInterval(doCheck, 15000); // Check every 15s
}

/**
 * Get currently cached areas from portal.
 */
export function getCachedAreas(): PortalArea[] {
  return [...cachedAreas];
}

/**
 * Get currently cached local printers.
 */
export function getCachedPrinters(): string[] {
  return [...cachedPrinters];
}

// ── Sync printers to DB ──────────────────────────────────

/**
 * Detect local printers and sync to device_printers table.
 * Also updates Presence with current printer list.
 */
async function syncPrintersToDb(): Promise<void> {
  const storeId = store.get("storeId");
  const deviceId = getDeviceId();
  const deviceName = store.get("deviceName") || "";
  if (!storeId) return;

  try {
    const printers = await listPrinters();
    cachedPrinters = printers;
    printersChangeCallback?.(printers);

    const supabase = getSupabase();

    // Get default printer
    const { getDefaultPrinter } = await import("./printer");
    const defaultPrinter = await getDefaultPrinter();

    // Upsert each printer
    for (const printerName of printers) {
      await supabase
        .from("device_printers" as any)
        .upsert(
          {
            store_id: storeId,
            device_id: deviceId,
            device_name: deviceName,
            printer_name: printerName,
            is_default: printerName === defaultPrinter,
            last_seen_at: new Date().toISOString(),
          } as any,
          { onConflict: "store_id,device_id,printer_name" }
        );
    }

    // Delete printers that no longer exist on this device
    if (printers.length > 0) {
      // Fetch current DB entries for this device
      const { data: dbPrinters } = await supabase
        .from("device_printers" as any)
        .select("id, printer_name")
        .eq("store_id", storeId)
        .eq("device_id", deviceId);

      if (dbPrinters) {
        for (const dbp of dbPrinters as any[]) {
          if (!printers.includes(dbp.printer_name)) {
            await supabase
              .from("device_printers" as any)
              .delete()
              .eq("id", dbp.id);
          }
        }
      }
    }

    // Update presence with current printers
    await updatePresence();

    console.log(`[PrinterSync] Synced ${printers.length} printers to DB`);
  } catch (err) {
    console.error("[PrinterSync] Error syncing printers:", err);
  }
}

// ── Load areas from portal ────────────────────────────────

/**
 * Load print areas from the portal (Supabase).
 */
async function loadAreasFromPortal(): Promise<void> {
  const storeId = store.get("storeId");
  if (!storeId) return;

  const supabase = getSupabase();

  try {
    const { data, error } = await supabase
      .from("print_areas")
      .select("id, name, area_type, enabled, copies, paper_width, print_receipt_types")
      .eq("store_id", storeId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[PrintListener] Error loading areas:", error.message);
      return;
    }

    cachedAreas = (data || []) as PortalArea[];
    areasChangeCallback?.(cachedAreas);
    console.log(`[PrintListener] Loaded ${cachedAreas.length} areas from portal`);
  } catch (err) {
    console.error("[PrintListener] Error loading areas:", err);
  }
}

/**
 * Load area mappings from the database for this device.
 */
async function loadMappingsFromDb(): Promise<void> {
  const storeId = store.get("storeId");
  const deviceId = getDeviceId();
  if (!storeId) return;

  const supabase = getSupabase();

  try {
    const { data, error } = await supabase
      .from("device_area_mappings" as any)
      .select("print_area_id, printer_name, enabled")
      .eq("store_id", storeId)
      .eq("device_id", deviceId);

    if (error) {
      console.error("[PrintListener] Error loading mappings:", error.message);
      return;
    }

    if (data) {
      const mappings: Record<string, any> = {};
      for (const row of data as any[]) {
        // Find area info from cached areas
        const area = cachedAreas.find(a => a.id === row.print_area_id);
        mappings[row.print_area_id] = {
          printAreaId: row.print_area_id,
          printerName: row.printer_name,
          areaName: area?.name || "",
          areaType: area?.area_type || "",
          enabled: row.enabled,
        };
      }
      store.set("areaMappings", mappings);
      console.log(`[PrintListener] Loaded ${Object.keys(mappings).length} area mappings from DB`);

      // Re-process pending jobs — mappings may have changed and previously
      // skipped jobs (no mapping for this device) can now be printed
      processPendingJobs();
    }
  } catch (err) {
    console.error("[PrintListener] Error loading mappings:", err);
  }
}

/**
 * Save an area mapping to the database and local store.
 */
export async function saveAreaMapping(
  printAreaId: string,
  printerName: string
): Promise<boolean> {
  const storeId = store.get("storeId");
  const deviceId = getDeviceId();
  if (!storeId) return false;

  const supabase = getSupabase();

  try {
    const { error } = await supabase
      .from("device_area_mappings" as any)
      .upsert(
        {
          store_id: storeId,
          device_id: deviceId,
          print_area_id: printAreaId,
          printer_name: printerName,
          enabled: true,
          updated_at: new Date().toISOString(),
        } as any,
        { onConflict: "store_id,device_id,print_area_id" }
      );

    if (error) {
      console.error("[PrintListener] Error saving mapping:", error.message);
      return false;
    }

    // Update local store
    const mappings = store.get("areaMappings");
    const area = cachedAreas.find(a => a.id === printAreaId);
    mappings[printAreaId] = {
      printAreaId,
      printerName,
      areaName: area?.name || "",
      areaType: area?.area_type || "",
      enabled: true,
    };
    store.set("areaMappings", mappings);

    console.log(`[PrintListener] Mapped area ${printAreaId} -> ${printerName}`);
    return true;
  } catch (err) {
    console.error("[PrintListener] Error saving mapping:", err);
    return false;
  }
}

// ── Process print jobs ────────────────────────────────────

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
      .select("id, printer_name, print_area_id, raw_data, copies, status")
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
 * Resolve which physical printer to use for a job.
 * Priority:
 * 1. print_area_id -> device_area_mappings -> local printer
 * 2. printer_name (legacy/direct)
 * 3. Default printer from cachedPrinters (first one)
 * 4. null (skip this job — no mapping for this device)
 */
function resolveJobPrinter(job: {
  print_area_id?: string | null;
  printer_name?: string;
}): string | null {
  // 1. If job has a print_area_id, use area mapping
  if (job.print_area_id) {
    const mappings = store.get("areaMappings");
    const mapping = mappings[job.print_area_id];
    if (mapping && mapping.enabled && mapping.printerName) {
      return mapping.printerName;
    }
    // No mapping for this area on this device — skip
    // (another Alpha Print instance on another PC might handle it)
    return null;
  }

  // 2. Legacy: job has printer_name directly
  if (job.printer_name) {
    return job.printer_name;
  }

  // 3. No mapping, no printer_name — try default/first available printer
  if (cachedPrinters.length > 0) {
    return cachedPrinters[0];
  }

  // 4. No printers at all
  return "";
}

/**
 * Process a single print job: resolve printer, print, update status.
 */
async function processJob(job: {
  id: string;
  printer_name: string;
  print_area_id?: string | null;
  raw_data: string;
  copies: number;
}): Promise<void> {
  if (processedJobs.has(job.id)) return;
  processedJobs.add(job.id);
  cleanupProcessedJobs();

  const supabase = getSupabase();
  const deviceId = getDeviceId();

  // Resolve which printer to use
  const printerName = resolveJobPrinter(job);

  if (printerName === null) {
    // No mapping for this area on this device — skip silently
    // Another Alpha Print instance may handle it
    processedJobs.delete(job.id); // Allow re-processing if mappings change
    callback?.({
      type: "skipped",
      jobId: job.id,
      printerName: "",
    });
    return;
  }

  if (!printerName) {
    // No printer configured at all
    await supabase
      .from("print_jobs")
      .update({
        status: "failed",
        error: "Nenhuma impressora mapeada para esta area neste dispositivo",
        device_id: deviceId,
      } as any)
      .eq("id", job.id);

    callback?.({
      type: "failed",
      jobId: job.id,
      printerName: "",
      error: "Nenhuma impressora mapeada",
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
    await printRaw(printerName, job.raw_data, job.copies || 1);

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

    reconnectAttempts = 0;
    console.log(`[PrintListener] Job ${job.id} printed on ${printerName}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Erro desconhecido";

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
