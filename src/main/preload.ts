// ============================================================
// Preload — Exposes safe IPC methods to renderer via contextBridge
// Alpha Print v2: read-only executor mode
// ============================================================

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("alphaPrint", {
  // Auth
  login: (email: string, password: string) =>
    ipcRenderer.invoke("auth:login", email, password),
  logout: () => ipcRenderer.invoke("auth:logout"),
  getAuthStatus: () => ipcRenderer.invoke("auth:status"),

  // Printers (read-only — just list and test)
  listPrinters: () => ipcRenderer.invoke("printer:list"),
  testPrint: (name: string) => ipcRenderer.invoke("printer:test", name),

  // Areas (from portal, read-only — mapping done on portal)
  getAreas: () => ipcRenderer.invoke("areas:list"),

  // Device
  setDeviceName: (name: string) => ipcRenderer.invoke("device:setName", name),

  // App info
  getAppInfo: () => ipcRenderer.invoke("app:info"),

  // Connection status
  getConnectionStatus: () => ipcRenderer.invoke("connection:status"),

  // Recent print jobs (last 3)
  getRecentJobs: () => ipcRenderer.invoke("jobs:recent"),

  // Events from main process
  onAreasUpdated: (callback: (areas: any[]) => void) => {
    ipcRenderer.on("areas:updated", (_event, areas) => callback(areas));
  },
  onPrintersUpdated: (callback: (printers: string[]) => void) => {
    ipcRenderer.on("printers:updated", (_event, printers) => callback(printers));
  },
  onPrintEvent: (callback: (event: any) => void) => {
    ipcRenderer.on("print:event", (_event, data) => callback(data));
  },
  onConnectionStatusChanged: (callback: (status: any) => void) => {
    ipcRenderer.on("connection:status", (_event, status) => callback(status));
  },
  onRecentJobsUpdated: (callback: (jobs: any[]) => void) => {
    ipcRenderer.on("jobs:recent-updated", (_event, jobs) => callback(jobs));
  },
  onPrintFailure: (callback: (data: any) => void) => {
    ipcRenderer.on("print:failure", (_event, data) => callback(data));
  },
});
