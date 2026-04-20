// ============================================================
// Order Listener — Escuta orders via Supabase Realtime
// Alpha Print imprime autonomamente sem depender do browser
// ============================================================

import { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";
import store, { getDeviceId } from "./store";
import { printRaw } from "./printer";
import { getCachedAreas, getCachedPrinters, getAreaMappings } from "./print-listener";
import { getPrintSettings, getCompanyProfile, shouldAutoAccept, isStoreDataReady } from "./store-data";
import { buildReceipt } from "./printing/receipt-templates";
import { MODALITY_TO_RECEIPT } from "./printing/types";
import type { ReceiptType, PrintJobData, PaperWidth, PrintAreaConfig } from "./printing/types";
import type { Order } from "./printing/order-types";
import type { PortalArea } from "./print-listener";

export type OrderPrintEvent = {
  type: "printing" | "printed" | "failed" | "skipped";
  orderId: string;
  orderNumber: number;
  printerName: string;
  areaType: string;
  error?: string;
};

type OrderPrintCallback = (event: OrderPrintEvent) => void;

let ordersChannel: RealtimeChannel | null = null;
let callback: OrderPrintCallback | null = null;
let isActive = false;

// Track printed order IDs to prevent double-printing
const printedOrders = new Set<string>();
const inFlightOrders = new Set<string>();
const PRINTED_ORDERS_MAX = 500;

function cleanupPrintedOrders(): void {
  if (printedOrders.size > PRINTED_ORDERS_MAX) {
    const arr = Array.from(printedOrders);
    printedOrders.clear();
    for (const id of arr.slice(-200)) {
      printedOrders.add(id);
    }
  }
}

/**
 * Start listening for orders and printing autonomously.
 */
export function startOrderListener(onEvent: OrderPrintCallback): void {
  const storeId = store.get("storeId");
  if (!storeId) {
    console.error("[OrderListener] No store_id configured");
    return;
  }

  callback = onEvent;
  isActive = true;

  const supabase = getSupabase();

  ordersChannel = supabase
    .channel(`orders-auto-print:${storeId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "orders",
        filter: `store_id=eq.${storeId}`,
      },
      (payload) => {
        try {
          const newOrder = payload.new as { id: string; status: string; modality: string };
          if (newOrder.status === "PENDENTE" || newOrder.status === "EM_PREPARO") {
            handleNewOrder(newOrder.id);
          }
        } catch (err) {
          console.error("[OrderListener] Error handling INSERT:", err);
        }
      }
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "orders",
        filter: `store_id=eq.${storeId}`,
      },
      (payload) => {
        try {
          const updatedOrder = payload.new as { id: string; status: string; modality: string };
          if (updatedOrder.status === "EM_PREPARO") {
            handleNewOrder(updatedOrder.id);
          }
        } catch (err) {
          console.error("[OrderListener] Error handling UPDATE:", err);
        }
      }
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        console.log("[OrderListener] Listening for orders on store:", storeId);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.error("[OrderListener] Channel error:", status);
        // The print-listener's reconnect mechanism handles channel recovery
        // via full restart — order-listener channel will be re-created
      }
    });
}

/**
 * Stop listening for orders.
 */
export function stopOrderListener(): void {
  isActive = false;

  if (ordersChannel) {
    try {
      const supabase = getSupabase();
      supabase.removeChannel(ordersChannel);
    } catch { /* ignore */ }
    ordersChannel = null;
  }

  callback = null;
  console.log("[OrderListener] Stopped");
}

/**
 * Handle a new order: fetch, validate, build receipts, print.
 */
async function handleNewOrder(orderId: string): Promise<void> {
  if (!isActive) return;

  // Deduplication
  if (printedOrders.has(orderId)) return;
  if (inFlightOrders.has(orderId)) return;
  inFlightOrders.add(orderId);

  try {
    // Wait for store data to be available
    if (!isStoreDataReady()) {
      console.warn("[OrderListener] Store data not ready yet — skipping order", orderId);
      inFlightOrders.delete(orderId);
      return;
    }

    const companyProfile = getCompanyProfile();
    if (!companyProfile) {
      console.warn("[OrderListener] Company profile not loaded — skipping order", orderId);
      inFlightOrders.delete(orderId);
      return;
    }

    // Fetch full order with all relations
    const storeId = store.get("storeId");
    const supabase = getSupabase();
    const { data: order, error } = await supabase
      .from("orders")
      .select(
        `*,
        customer:customers(*),
        order_items(*, order_item_complements(*), order_item_options(*)),
        order_delivery(*),
        order_payments(*),
        tab:tabs(table_id, tables(name))`
      )
      .eq("id", orderId)
      .single();

    if (error || !order) {
      console.error("[OrderListener] Failed to fetch order:", error?.message);
      inFlightOrders.delete(orderId);
      return;
    }

    const typedOrder = order as unknown as Order;

    // Block cancelled orders
    const BLOCKED_STATUSES = ["CANCELADO", "CANCELANDO", "CANCELAMENTO_SOLICITADO"];
    if (BLOCKED_STATUSES.includes(typedOrder.status)) {
      console.warn(`[OrderListener] Order #${typedOrder.order_number} status ${typedOrder.status} — blocked`);
      inFlightOrders.delete(orderId);
      return;
    }

    // Check auto-accept settings
    if (!shouldAutoAccept(typedOrder.modality)) {
      inFlightOrders.delete(orderId);
      return;
    }

    // Deduplication: Wait briefly to allow the browser to create its print_jobs first.
    // Both browser and Alpha Print receive the Realtime INSERT event nearly simultaneously.
    // The browser creates jobs via alpha-print-service (source='browser'), which then
    // get picked up by print-listener.ts. Without this delay, the order-listener might
    // check before the browser has created its jobs, leading to duplicate prints.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Check if the browser already created print_jobs for this order.
    // If those jobs exist (any status except failed), Alpha Print should NOT
    // print directly to avoid duplicate prints.
    try {
      const { count: browserJobCount } = await supabase
        .from("print_jobs" as any)
        .select("id", { count: "exact", head: true })
        .eq("order_id", orderId)
        .eq("store_id", storeId)
        .in("status", ["pending", "printing", "printed", "retrying"]);

      if (browserJobCount && browserJobCount > 0) {
        console.log(
          `[OrderListener] Order ${orderId} already has ${browserJobCount} print job(s) ` +
          `(browser or previous) — skipping autonomous print to avoid duplicates`
        );
        printedOrders.add(orderId);
        inFlightOrders.delete(orderId);
        return;
      }
    } catch (dedupeErr) {
      // Non-critical — proceed with printing if dedup check fails
      console.warn("[OrderListener] Dedup check failed, proceeding:", dedupeErr);
    }

    // Mark as printed early to prevent duplicates
    printedOrders.add(orderId);
    cleanupPrintedOrders();

    // Build and print receipts for each area
    await printOrderToAreas(typedOrder, companyProfile);
  } catch (err) {
    console.error("[OrderListener] Error processing order:", err);
    printedOrders.delete(orderId); // Allow retry
  } finally {
    inFlightOrders.delete(orderId);
  }
}

/**
 * For a given order, determine which areas need printing and print to each.
 * Mirrors the logic from useAutoPrint.ts in the web panel.
 */
async function printOrderToAreas(order: Order, companyProfile: any): Promise<void> {
  const storeId = store.get("storeId");
  const deviceId = getDeviceId();
  if (!storeId) return;

  const printSettings = getPrintSettings();
  const orderReceiptType: ReceiptType = MODALITY_TO_RECEIPT[order.modality] || "delivery";

  // Get areas from print-listener's cache
  const areas = getCachedAreas();
  const cachedPrinters = getCachedPrinters();
  const areaMappings = getAreaMappings();

  if (areas.length === 0) {
    console.warn("[OrderListener] No print areas configured — skipping");
    return;
  }

  // V2 Smart Filtering: same logic as useAutoPrint
  const candidateAreas = areas.filter((area) => {
    if (!area.enabled) return false;

    const areaReceiptTypes = area.print_receipt_types || [];
    const isKitchenAreaType = area.area_type === "cozinha" || area.area_type === "comanda_producao";

    if (isKitchenAreaType) return true;
    return areaReceiptTypes.includes(orderReceiptType);
  });

  // Modality override filtering
  const areasWithOverride = candidateAreas.filter(
    (area) => area.modality_printer_overrides?.[orderReceiptType]
  );

  const filteredAreas = areasWithOverride.length > 0 ? areasWithOverride : candidateAreas;

  if (filteredAreas.length === 0) {
    return;
  }

  const supabase = getSupabase();

  for (const area of filteredAreas) {
    const isKitchenArea =
      area.area_type === "cozinha" || area.area_type === "comanda_producao";
    const receiptType: ReceiptType = isKitchenArea ? "cozinha" : orderReceiptType;

    const jobData: PrintJobData = {
      receiptType,
      order,
      company: companyProfile,
      printSettings,
      paperWidth: area.paper_width as PaperWidth,
    };

    let rawData: string;
    try {
      rawData = buildReceipt(jobData);
      if (!rawData) {
        console.warn(`[OrderListener] buildReceipt empty for order #${order.order_number}, area ${area.area_type}`);
        continue;
      }
    } catch (err) {
      console.error(`[OrderListener] buildReceipt error for area ${area.area_type}:`, err);
      continue;
    }

    // Resolve printers for this area (same priority as useAutoPrint)
    const printers = resolvePrintersForArea(area, receiptType, cachedPrinters, areaMappings);

    if (printers.length === 0) {
      continue;
    }

    for (const printerName of printers) {
      try {
        callback?.({
          type: "printing",
          orderId: order.id,
          orderNumber: order.order_number,
          printerName,
          areaType: area.area_type,
        });

        // Print directly
        await printRaw(printerName, rawData, area.copies || 1);

        console.log(
          `[OrderListener] Printed order #${order.order_number} ` +
          `(${receiptType}) on ${printerName} (area: ${area.area_type})`
        );

        callback?.({
          type: "printed",
          orderId: order.id,
          orderNumber: order.order_number,
          printerName,
          areaType: area.area_type,
        });

        // Create print_job for audit trail (status already 'printed')
        try {
          await supabase
            .from("print_jobs" as any)
            .insert({
              store_id: storeId,
              order_id: order.id,
              printer_name: printerName,
              printer_area: area.area_type,
              receipt_type: receiptType,
              raw_data: rawData,
              copies: area.copies || 1,
              paper_width: area.paper_width,
              print_area_id: area.id,
              status: "printed",
              printed_at: new Date().toISOString(),
              device_id: deviceId,
              source: "alpha_print",
            } as any);
        } catch (dbErr) {
          // Non-critical — print succeeded even if audit trail fails
          console.warn("[OrderListener] Failed to create audit print_job:", dbErr);
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Erro desconhecido";
        console.error(
          `[OrderListener] Failed to print order #${order.order_number} on ${printerName}:`,
          errorMsg
        );

        callback?.({
          type: "failed",
          orderId: order.id,
          orderNumber: order.order_number,
          printerName,
          areaType: area.area_type,
          error: errorMsg,
        });

        // Create failed print_job for audit trail
        try {
          await supabase
            .from("print_jobs" as any)
            .insert({
              store_id: storeId,
              order_id: order.id,
              printer_name: printerName,
              printer_area: area.area_type,
              receipt_type: receiptType,
              raw_data: rawData,
              copies: area.copies || 1,
              paper_width: area.paper_width,
              print_area_id: area.id,
              status: "failed",
              error: errorMsg,
              device_id: deviceId,
              source: "alpha_print",
            } as any);
        } catch { /* ignore audit failure */ }
      }
    }
  }
}

/**
 * Resolve which printers to use for a given area.
 * Priority:
 * 1. modality_printer_overrides[receiptType] — if it's a local printer
 * 2. device_area_mappings — local printer for this device
 * 3. Skip (no printer for this area on this device)
 */
function resolvePrintersForArea(
  area: PortalArea,
  receiptType: ReceiptType,
  localPrinters: string[],
  areaMappings: Record<string, any>
): string[] {
  const result: string[] = [];

  // 1. Check modality-specific override
  const override = area.modality_printer_overrides?.[receiptType];
  if (override) {
    // Check if override printer is installed on this PC
    const isLocal = localPrinters.some(
      (p) => p.toLowerCase() === override.toLowerCase()
    );
    if (isLocal) {
      result.push(override);
      return result;
    }
    // Override printer not on this PC — fall through to device mappings
  }

  // 2. Device area mappings
  const mapping = areaMappings[area.id];
  if (mapping) {
    const printerNames: string[] = mapping.printerNames || (mapping.printerName ? [mapping.printerName] : []);
    for (const name of printerNames) {
      if (!name) continue;
      const isLocal = localPrinters.some(
        (p) => p.toLowerCase() === name.toLowerCase()
      );
      if (isLocal && !result.includes(name)) {
        result.push(name);
      }
    }
  }

  return result;
}
