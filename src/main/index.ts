// ============================================================
// Alpha Print — Main Process Entry Point
// App Electron para impressao termica automatica
// Modo: SOMENTE LEITURA / EXECUTOR
// Config vem do portal, app so mapeia impressoras e executa
// ============================================================

import { app, BrowserWindow, ipcMain } from "electron";
import path from "path";
import { existsSync } from "fs";
import store, { isLoggedIn, clearAuth } from "./store";
import { login, restoreSession, logout, startTokenRefresh } from "./supabase";
import { listPrinters, printTest, getDefaultPrinter } from "./printer";
import {
  startListening,
  stopListening,
  updatePresence,
  getCachedAreas,
  getCachedPrinters,
  onAreasChange,
  onPrintersChange,
  onConnectionStatusChange,
  getConnectionStatus,
} from "./print-listener";
import { createTray, updateTrayStatus, updateLastPrintTime, destroyTray } from "./tray";

let mainWindow: BrowserWindow | null = null;
let tokenRefreshInterval: NodeJS.Timeout | null = null;
let isQuitting = false;

// ── Single Instance Lock ──────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showWindow();
  });
}

// ── Auto-Start with Windows ──────────────────────────────
function setupAutoStart(): void {
  try {
    app.setLoginItemSettings({
      openAtLogin: true,
      name: "Alpha Print",
    });
    console.log("[App] Auto-start configured");
  } catch (err) {
    console.error("[App] Failed to set auto-start:", err);
  }
}

// ── App Lifecycle ─────────────────────────────────────────

app.on("ready", async () => {
  setupAutoStart();
  createTray(showWindow, quitApp);

  if (isLoggedIn()) {
    const restored = await restoreSession();
    if (restored) {
      startPrintService();
    } else {
      showWindow();
    }
  } else {
    showWindow();
  }
});

app.on("window-all-closed", () => {
  // Don't quit when window is closed — keep running in tray
});

app.on("before-quit", () => {
  isQuitting = true;
  stopPrintService();
  destroyTray();
});

// ── Window Management ─────────────────────────────────────

function resolveIconPath(): string {
  // Check multiple possible locations (dev vs packaged ASAR vs unpacked)
  // When asarUnpack is used, files are at app.asar.unpacked/assets/
  const possibleDirs = [
    path.join(app.getAppPath() + ".unpacked", "assets"),
    path.join(process.resourcesPath || "", "assets"),
    path.join(app.getAppPath(), "assets"),
    path.join(__dirname, "..", "..", "assets"),
    path.join(__dirname, "..", "assets"),
    path.join(app.getAppPath(), "..", "assets"),
  ];

  for (const dir of possibleDirs) {
    try {
      const icoPath = path.join(dir, "icon.ico");
      const pngPath = path.join(dir, "icon.png");
      if (existsSync(icoPath)) {
        console.log("[App] Icon found at:", icoPath);
        return icoPath;
      }
      if (existsSync(pngPath)) {
        console.log("[App] Icon found at:", pngPath);
        return pngPath;
      }
    } catch {
      // Skip inaccessible dirs
    }
  }

  console.warn("[App] No icon found in any location, using fallback");
  return path.join(app.getAppPath(), "assets", "icon.png");
}

function showWindow(): void {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  const bounds = store.get("windowBounds");

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 400,
    minHeight: 600,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    title: "Alpha Print",
    icon: resolveIconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(
    path.join(__dirname, "..", "..", "src", "renderer", "index.html")
  );

  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("moved", () => {
    if (mainWindow) {
      const [x, y] = mainWindow.getPosition();
      const [width, height] = mainWindow.getSize();
      store.set("windowBounds", { width, height, x, y });
    }
  });

  mainWindow.on("resized", () => {
    if (mainWindow) {
      const [width, height] = mainWindow.getSize();
      const [x, y] = mainWindow.getPosition();
      store.set("windowBounds", { width, height, x, y });
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function quitApp(): void {
  isQuitting = true;
  app.quit();
}

// ── Print Service ─────────────────────────────────────────

function startPrintService(): void {
  tokenRefreshInterval = startTokenRefresh();

  // Register callbacks for UI updates
  onAreasChange((areas) => {
    mainWindow?.webContents.send("areas:updated", areas);
  });

  onPrintersChange((printers) => {
    mainWindow?.webContents.send("printers:updated", printers);
  });

  onConnectionStatusChange((status) => {
    mainWindow?.webContents.send("connection:status", status);
  });

  startListening((event) => {
    if (event.type === "printed") {
      const now = new Date().toLocaleTimeString("pt-BR");
      updateLastPrintTime(now);
      updateTrayStatus("connected", showWindow, quitApp);
      mainWindow?.webContents.send("print:event", event);
      console.log(`[Print] Job ${event.jobId} printed on ${event.printerName}`);
    } else if (event.type === "failed") {
      mainWindow?.webContents.send("print:event", event);
      console.error(`[Print] Job ${event.jobId} failed: ${event.error}`);
    }
  });

  updateTrayStatus("connected", showWindow, quitApp);
  console.log("[App] Print service started");
}

function stopPrintService(): void {
  stopListening();
  if (tokenRefreshInterval) {
    clearInterval(tokenRefreshInterval);
    tokenRefreshInterval = null;
  }
  updateTrayStatus("disconnected", showWindow, quitApp);
}

// ── IPC Handlers ─────────────────────────────────────────

// Login
ipcMain.handle("auth:login", async (_event, email: string, password: string) => {
  const result = await login(email, password);
  if (result.success) {
    startPrintService();
  }
  return result;
});

// Logout
ipcMain.handle("auth:logout", async () => {
  stopPrintService();
  await logout();
  return { success: true };
});

// Check if logged in
ipcMain.handle("auth:status", () => {
  return {
    isLoggedIn: isLoggedIn(),
    email: store.get("userEmail"),
    storeName: store.get("storeName"),
    storeId: store.get("storeId"),
  };
});

// List local printers
ipcMain.handle("printer:list", async () => {
  const printers = await listPrinters();
  const defaultPrinter = await getDefaultPrinter();
  return { printers, defaultPrinter };
});

// Test a specific printer
ipcMain.handle("printer:test", async (_event, printerName: string) => {
  try {
    await printTest(printerName);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Erro desconhecido",
    };
  }
});

// Get areas from portal (cached)
ipcMain.handle("areas:list", () => {
  return {
    areas: getCachedAreas(),
    mappings: store.get("areaMappings"),
  };
});

// Set device friendly name
ipcMain.handle("device:setName", async (_event, name: string) => {
  store.set("deviceName", name);
  await updatePresence();
  return { success: true };
});

// Get connection status
ipcMain.handle("connection:status", () => {
  return getConnectionStatus();
});

// Get app info
ipcMain.handle("app:info", () => {
  return {
    version: app.getVersion(),
    deviceId: store.get("deviceId"),
    deviceName: store.get("deviceName"),
  };
});
