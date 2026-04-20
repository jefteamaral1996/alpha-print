// ============================================================
// Alpha Print — Main Process Entry Point
// App Electron para impressao termica automatica
// Modo: SOMENTE LEITURA / EXECUTOR
// Config vem do portal, app so mapeia impressoras e executa
// ============================================================

import { app, BrowserWindow, ipcMain } from "electron";
import path from "path";
import { existsSync } from "fs";
import store, { isLoggedIn, hasSavedCredentials } from "./store";
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
  forceReconnect,
  onFullRestartNeeded,
  resetReconnectFailures,
} from "./print-listener";
import { startOrderListener, stopOrderListener } from "./order-listener";
import { refreshStoreData, startStoreDataRefresh, stopStoreDataRefresh } from "./store-data";
import { createTray, updateTrayStatus, updateLastPrintTime, destroyTray } from "./tray";
import { initAutoUpdater } from "./updater";

let mainWindow: BrowserWindow | null = null;
let tokenRefreshInterval: NodeJS.Timeout | null = null;
let isQuitting = false;

// ── Recent Jobs History (last 3) ─────────────────────────
interface RecentJob {
  id: string;
  printerName: string;
  status: "printed" | "failed";
  error?: string;
  timestamp: string;
}
const recentJobs: RecentJob[] = [];
const MAX_RECENT_JOBS = 3;

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
  initAutoUpdater(() => mainWindow);
  createTray(showWindow, quitApp);

  if (isLoggedIn() || hasSavedCredentials()) {
    // Try to restore session (includes retry + auto re-login with saved credentials)
    const restored = await restoreSession();
    if (restored) {
      startPrintService();
    } else if (hasSavedCredentials()) {
      // restoreSession already tried autoReLogin, but it may have failed due to
      // network issues at startup. Start a background retry loop.
      console.log("[App] Session restore failed at startup — starting background retry");
      showWindow(); // Show window but keep credentials for retry
      startBackgroundReloginRetry();
    } else {
      // No credentials at all — need manual login
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
  stopBackgroundReloginRetry();
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

  console.log("[App] Searching for icon. App path:", app.getAppPath());
  console.log("[App] Resources path:", process.resourcesPath);
  console.log("[App] __dirname:", __dirname);

  for (const dir of possibleDirs) {
    try {
      const icoPath = path.join(dir, "icon.ico");
      const pngPath = path.join(dir, "icon.png");
      if (existsSync(icoPath)) {
        console.log("[App] Icon found (ICO):", icoPath);
        return icoPath;
      }
      if (existsSync(pngPath)) {
        console.log("[App] Icon found (PNG):", pngPath);
        return pngPath;
      }
      console.log("[App] Icon NOT found in:", dir);
    } catch {
      console.log("[App] Icon dir inaccessible:", dir);
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

  // Mecanismo 5: Reconectar quando janela ganha foco (usuário abre o app
  // após o PC ficar em sleep ou a rede cair e voltar enquanto estava minimizado)
  mainWindow.on("focus", () => {
    const status = getConnectionStatus();
    if (status.server !== "connected") {
      console.log("[App] Janela ganhou foco com servidor desconectado — forçando reconexão");
      forceReconnect();
    }
  });
}

function quitApp(): void {
  isQuitting = true;
  app.quit();
}

// ── Print Service ─────────────────────────────────────────

// ── Automatic Full Restart (Mecanismo 6) ─────────────────
// Quando reconexão parcial falha repetidamente, faz full restart automaticamente.
// Usa debounce para evitar múltiplos full restarts simultâneos.
let autoFullRestartInProgress = false;

async function performAutoFullRestart(): Promise<void> {
  if (autoFullRestartInProgress) {
    console.log("[AutoFullRestart] Ja em andamento — ignorando duplicata");
    return;
  }

  autoFullRestartInProgress = true;
  console.log("[AutoFullRestart] Reconexao parcial falhou repetidamente — iniciando full restart automatico...");

  try {
    // 1. Para todo o servico de impressao
    stopPrintService();

    // 2. Re-autentica do zero (includes retry + auto re-login)
    const restored = await restoreSession();
    if (!restored) {
      console.warn("[AutoFullRestart] Sessao nao restaurada agora — iniciando retry em background");
      // NEVER send fullRestart:failed — instead start background retry
      startBackgroundReloginRetry();
      autoFullRestartInProgress = false;
      return;
    }

    // 3. Reinicia o servico de impressao
    startPrintService();

    // 4. Reseta contadores de falha
    resetReconnectFailures();

    console.log("[AutoFullRestart] Full restart automatico concluido com sucesso");
  } catch (err) {
    console.error("[AutoFullRestart] Erro durante full restart automatico:", err);
    // NEVER send fullRestart:failed — start background retry instead
    startBackgroundReloginRetry();
  } finally {
    autoFullRestartInProgress = false;
  }
}

// ── Background Re-login Retry ─────────────────────────────
// When session restoration fails (e.g., no network at boot, token fully expired),
// this retries in the background with increasing intervals until it succeeds.
// The app NEVER goes to the login screen — it keeps trying silently.

let backgroundReloginTimer: NodeJS.Timeout | null = null;
let backgroundReloginAttempt = 0;

function startBackgroundReloginRetry(): void {
  if (backgroundReloginTimer) {
    console.log("[BackgroundRelogin] Already running — skipping duplicate");
    return;
  }

  if (!hasSavedCredentials()) {
    console.log("[BackgroundRelogin] No saved credentials — cannot retry");
    return;
  }

  backgroundReloginAttempt = 0;

  const tryRelogin = async () => {
    backgroundReloginAttempt++;
    // Backoff: 5s, 10s, 20s, 30s, 30s, 30s... (cap at 30s)
    const delay = Math.min(5000 * Math.pow(2, backgroundReloginAttempt - 1), 30000);

    console.log(`[BackgroundRelogin] Attempt ${backgroundReloginAttempt} — trying auto re-login...`);

    // Notify renderer that we're reconnecting (not failed)
    mainWindow?.webContents.send("connection:status", {
      internet: "checking",
      server: "reconnecting",
      serverDetail: `Reconectando automaticamente... (tentativa ${backgroundReloginAttempt})`,
    });

    const success = await restoreSession();

    if (success) {
      console.log(`[BackgroundRelogin] Success on attempt ${backgroundReloginAttempt}!`);
      backgroundReloginTimer = null;
      backgroundReloginAttempt = 0;
      startPrintService();

      // Notify renderer of success
      mainWindow?.webContents.send("connection:status", {
        internet: "online",
        server: "connected",
        serverDetail: "Reconectado automaticamente",
      });
      return;
    }

    console.log(`[BackgroundRelogin] Attempt ${backgroundReloginAttempt} failed — next try in ${delay / 1000}s`);
    backgroundReloginTimer = setTimeout(tryRelogin, delay);
  };

  // Start first attempt after 5 seconds
  backgroundReloginTimer = setTimeout(tryRelogin, 5000);
}

function stopBackgroundReloginRetry(): void {
  if (backgroundReloginTimer) {
    clearTimeout(backgroundReloginTimer);
    backgroundReloginTimer = null;
  }
  backgroundReloginAttempt = 0;
}

async function startPrintService(): Promise<void> {
  // Stop any background relogin since we're now connected
  stopBackgroundReloginRetry();
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

  // Mecanismo 6: Full restart automatico quando reconexao parcial falha repetidamente
  onFullRestartNeeded(() => {
    console.log("[App] print-listener solicitou full restart automatico");
    performAutoFullRestart();
  });

  startListening((event) => {
    // Track recent jobs (printed and failed)
    if (event.type === "printed" || event.type === "failed") {
      const job: RecentJob = {
        id: event.jobId,
        printerName: event.printerName,
        status: event.type,
        error: event.error,
        timestamp: new Date().toISOString(),
      };
      recentJobs.unshift(job);
      if (recentJobs.length > MAX_RECENT_JOBS) recentJobs.pop();
      mainWindow?.webContents.send("jobs:recent-updated", recentJobs);
    }

    if (event.type === "printed") {
      const now = new Date().toLocaleTimeString("pt-BR");
      updateLastPrintTime(now);
      updateTrayStatus("connected", showWindow, quitApp);
      console.log(`[Print] Job ${event.jobId} printed on ${event.printerName}`);
    } else if (event.type === "failed") {
      // Send dedicated failure notification to renderer
      mainWindow?.webContents.send("print:failure", {
        jobId: event.jobId,
        printerName: event.printerName,
        error: event.error,
      });
      console.error(`[Print] Job ${event.jobId} failed: ${event.error}`);
    }

    mainWindow?.webContents.send("print:event", event);
  });

  // -- Autonomous Order Printing --
  // Fetch store settings + company profile (needed by receipt templates)
  await refreshStoreData();
  startStoreDataRefresh();

  // Start listening for orders directly (Alpha Print prints autonomously)
  startOrderListener((event) => {
    // Track recent order prints same as job prints
    if (event.type === "printed" || event.type === "failed") {
      const job: RecentJob = {
        id: event.orderId,
        printerName: event.printerName,
        status: event.type,
        error: event.error,
        timestamp: new Date().toISOString(),
      };
      recentJobs.unshift(job);
      if (recentJobs.length > MAX_RECENT_JOBS) recentJobs.pop();
      mainWindow?.webContents.send("jobs:recent-updated", recentJobs);
    }

    if (event.type === "printed") {
      const now = new Date().toLocaleTimeString("pt-BR");
      updateLastPrintTime(now);
      updateTrayStatus("connected", showWindow, quitApp);
      console.log(
        `[OrderPrint] Order #${event.orderNumber} printed on ${event.printerName} (${event.areaType})`
      );
    } else if (event.type === "failed") {
      mainWindow?.webContents.send("print:failure", {
        jobId: event.orderId,
        printerName: event.printerName,
        error: event.error,
      });
      console.error(
        `[OrderPrint] Order #${event.orderNumber} failed on ${event.printerName}: ${event.error}`
      );
    }

    mainWindow?.webContents.send("order-print:event", event);
  });

  updateTrayStatus("connected", showWindow, quitApp);
  console.log("[App] Print service started (with autonomous order printing)");
}

function stopPrintService(): void {
  stopOrderListener();
  stopStoreDataRefresh();
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

// Get recent print jobs (last 3)
ipcMain.handle("jobs:recent", () => {
  return [...recentJobs];
});

// Get app info
ipcMain.handle("app:info", () => {
  return {
    version: app.getVersion(),
    deviceId: store.get("deviceId"),
    deviceName: store.get("deviceName"),
  };
});

// Mecanismo 4: Botão manual "Reconectar agora" da UI
ipcMain.handle("connection:reconnect", () => {
  forceReconnect();
  return { success: true };
});

// Reconexao completa: simula fechar e abrir o app (destroi tudo e refaz do zero)
ipcMain.handle("connection:fullRestart", async () => {
  console.log("[App] Full restart requested — tearing down everything and reconnecting...");

  // 1. Para todo o servico de impressao (canais Realtime, timers, presence)
  stopPrintService();

  // 2. Re-autentica do zero (includes retry + auto re-login with saved credentials)
  const restored = await restoreSession();
  if (!restored) {
    console.warn("[App] Full restart — session not restored immediately, starting background retry");
    // NEVER redirect to login — start background retry instead
    startBackgroundReloginRetry();
    return { success: false, error: "Reconectando em segundo plano..." };
  }

  // 3. Reinicia o servico de impressao (novos canais, nova presence, novo heartbeat)
  startPrintService();

  console.log("[App] Full restart completed successfully");
  return { success: true };
});
