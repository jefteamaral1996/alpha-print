// ============================================================
// Persistent Store — Configuracoes locais do Alpha Print
// Usa electron-store para persistir entre sessoes
// ============================================================

import Store from "electron-store";
import { randomUUID } from "crypto";
import { hostname } from "os";

export interface AreaMapping {
  printAreaId: string;
  /** @deprecated Use printerNames (array). Mantido para compatibilidade com dados antigos no store. */
  printerName?: string;
  /** Lista de impressoras locais mapeadas para esta área neste device. */
  printerNames?: string[];
  areaName: string;
  areaType: string;
  enabled: boolean;
}

interface StoreSchema {
  // Auth tokens (persisted from login)
  accessToken: string;
  refreshToken: string;

  // User/store info (from profile after login)
  storeId: string;
  userEmail: string;
  storeName: string;

  // Device identity (generated once, persisted forever)
  deviceId: string;

  // Device friendly name (editable by user, e.g. "PC Caixa")
  deviceName: string;

  // Area -> Printer mappings (local config per device)
  // Key: print_area_id, Value: local printer name
  areaMappings: Record<string, AreaMapping>;

  // Window state
  windowBounds: { width: number; height: number; x?: number; y?: number };
}

const store = new Store<StoreSchema>({
  name: "alpha-print-config",
  defaults: {
    accessToken: "",
    refreshToken: "",
    storeId: "",
    userEmail: "",
    storeName: "",
    deviceId: randomUUID(),
    deviceName: process.env.COMPUTERNAME || hostname() || "",
    areaMappings: {},
    windowBounds: { width: 420, height: 600 },
  },
  encryptionKey: "alpha-print-local-enc-2026",
});

// ── Migration: fill deviceName if empty (existing installs) ──
if (!store.get("deviceName")) {
  store.set("deviceName", process.env.COMPUTERNAME || hostname() || "");
}

export default store;

// ── Convenience helpers ──

export function isLoggedIn(): boolean {
  return !!store.get("accessToken") && !!store.get("storeId");
}

export function clearAuth(): void {
  store.set("accessToken", "");
  store.set("refreshToken", "");
  store.set("storeId", "");
  store.set("userEmail", "");
  store.set("storeName", "");
  store.set("areaMappings", {});
}

export function getDeviceId(): string {
  return store.get("deviceId");
}
