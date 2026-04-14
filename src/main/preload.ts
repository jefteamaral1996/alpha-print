// ============================================================
// Preload — Exposes safe IPC methods to renderer via contextBridge
// ============================================================

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("alphaPrint", {
  // Auth
  login: (email: string, password: string) =>
    ipcRenderer.invoke("auth:login", email, password),
  logout: () => ipcRenderer.invoke("auth:logout"),
  getAuthStatus: () => ipcRenderer.invoke("auth:status"),

  // Printer
  listPrinters: () => ipcRenderer.invoke("printer:list"),
  selectPrinter: (name: string) => ipcRenderer.invoke("printer:select", name),
  testPrint: (name: string) => ipcRenderer.invoke("printer:test", name),

  // App info & settings
  getAppInfo: () => ipcRenderer.invoke("app:info"),
  toggleAutoStart: (enabled: boolean) =>
    ipcRenderer.invoke("app:toggleAutoStart", enabled),
});
