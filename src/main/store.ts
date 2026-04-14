// ============================================================
// Persistent Store — Configuracoes locais do Alpha Print
// Usa electron-store para persistir entre sessoes
// ============================================================

import Store from "electron-store";
import { randomUUID } from "crypto";

interface StoreSchema {
  // Auth tokens (persisted from login)
  accessToken: string;
  refreshToken: string;

  // User/store info (from profile after login)
  storeId: string;
  userEmail: string;
  storeName: string;

  // Printer config
  selectedPrinter: string;

  // Device identity (generated once, persisted forever)
  deviceId: string;

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
    selectedPrinter: "",
    deviceId: randomUUID(),
    windowBounds: { width: 420, height: 520 },
  },
  encryptionKey: "alpha-print-local-enc-2026",
});

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
}

export function getDeviceId(): string {
  return store.get("deviceId");
}
