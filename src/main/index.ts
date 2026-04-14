// ============================================================
// Alpha Print — Main Process Entry Point
// App Electron para impressao termica automatica
// ============================================================

import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "path";
import store, { isLoggedIn, clearAuth } from "./store";
import { login, restoreSession, logout, startTokenRefresh } from "./supabase";
import { listPrinters, printTest, getDefaultPrinter } from "./printer";
import { startListening, stopListening, updatePresence } from "./print-listener";
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
    // Someone tried to open a second instance — show our window
    showWindow();
  });
}

// ── App Lifecycle ─────────────────────────────────────────

app.on("ready", async () => {
  // Create tray icon
  createTray(showWindow, quitApp);

  // Try to restore session
  if (isLoggedIn()) {
    const restored = await restoreSession();
    if (restored) {
      // Session valid — start printing
      startPrintService();
    } else {
      // Session expired — show login window
      showWindow();
    }
  } else {
    // No credentials — show login window
    showWindow();
  }
});

app.on("window-all-closed", () => {
  // Don't quit when window is closed — keep running in tray
  // Electron default behavior on macOS is to not quit.
  // On Windows, we prevent quit by not calling app.quit()
});

app.on("before-quit", () => {
  isQuitting = true;
  stopPrintService();
  destroyTray();
});

// ── Window Management ─────────────────────────────────────

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
    minWidth: 380,
    minHeight: 480,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    title: "Alpha Print",
    icon: path.join(__dirname, "..", "..", "assets", "icon.ico"),
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
  // Start token refresh
  tokenRefreshInterval = startTokenRefresh();

  // Start print listener
  startListening((event) => {
    if (event.type === "printed") {
      const now = new Date().toLocaleTimeString("pt-BR");
      updateLastPrintTime(now);
      updateTrayStatus("connected", showWindow, quitApp);
      console.log(`[Print] Job ${event.jobId} printed on ${event.printerName}`);
    } else if (event.type === "failed") {
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

// ── IPC Handlers (communication with renderer) ────────────

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

// List printers
ipcMain.handle("printer:list", async () => {
  const printers = await listPrinters();
  const defaultPrinter = await getDefaultPrinter();
  return { printers, defaultPrinter, selected: store.get("selectedPrinter") };
});

// Select printer
ipcMain.handle("printer:select", async (_event, printerName: string) => {
  store.set("selectedPrinter", printerName);
  // Update presence so web UI knows which printer we're using
  await updatePresence();
  updateTrayStatus("connected", showWindow, quitApp);
  return { success: true };
});

// Test print
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

// Get app info
ipcMain.handle("app:info", () => {
  return {
    version: app.getVersion(),
    deviceId: store.get("deviceId"),
  };
});
