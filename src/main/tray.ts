// ============================================================
// Tray — System tray icon and menu for Alpha Print
// ============================================================

import { app, Tray, Menu, nativeImage, BrowserWindow } from "electron";
import path from "path";
import store from "./store";

let tray: Tray | null = null;
let lastPrintTime = "";

type TrayStatus = "connected" | "disconnected" | "error";

/**
 * Create the system tray icon with context menu.
 * @param onShowWindow Callback to show the login/config window
 * @param onQuit Callback to quit the app
 */
export function createTray(
  onShowWindow: () => void,
  onQuit: () => void
): Tray {
  // Use a simple 16x16 icon — create from path or from native image
  const iconPath = getIconPath("disconnected");
  tray = new Tray(iconPath);
  tray.setToolTip("Alpha Print - Desconectado");

  updateTrayMenu(onShowWindow, onQuit);

  // Double-click opens config window
  tray.on("double-click", onShowWindow);

  return tray;
}

/**
 * Update tray icon and tooltip based on connection status.
 */
export function updateTrayStatus(
  status: TrayStatus,
  onShowWindow: () => void,
  onQuit: () => void
): void {
  if (!tray) return;

  const iconPath = getIconPath(status);
  tray.setImage(iconPath);

  const tooltips: Record<TrayStatus, string> = {
    connected: `Alpha Print - Conectado (${store.get("selectedPrinter") || "Sem impressora"})`,
    disconnected: "Alpha Print - Desconectado",
    error: "Alpha Print - Erro",
  };

  tray.setToolTip(tooltips[status]);
  updateTrayMenu(onShowWindow, onQuit);
}

/**
 * Update the last print time shown in the tray menu.
 */
export function updateLastPrintTime(time: string): void {
  lastPrintTime = time;
}

function updateTrayMenu(
  onShowWindow: () => void,
  onQuit: () => void
): void {
  if (!tray) return;

  const storeName = store.get("storeName") || "Nao conectado";
  const selectedPrinter = store.get("selectedPrinter") || "Nenhuma";
  const userEmail = store.get("userEmail") || "";

  const menuItems: Electron.MenuItemConstructorOptions[] = [
    {
      label: `Alpha Print v${app.getVersion()}`,
      enabled: false,
    },
    { type: "separator" },
    {
      label: `Loja: ${storeName}`,
      enabled: false,
    },
    {
      label: `Impressora: ${selectedPrinter}`,
      enabled: false,
    },
  ];

  if (lastPrintTime) {
    menuItems.push({
      label: `Ultima impressao: ${lastPrintTime}`,
      enabled: false,
    });
  }

  if (userEmail) {
    menuItems.push({
      label: `Usuario: ${userEmail}`,
      enabled: false,
    });
  }

  menuItems.push(
    { type: "separator" },
    {
      label: "Configuracoes...",
      click: onShowWindow,
    },
    { type: "separator" },
    {
      label: "Sair",
      click: onQuit,
    }
  );

  const contextMenu = Menu.buildFromTemplate(menuItems);
  tray.setContextMenu(contextMenu);
}

function getIconPath(status: TrayStatus): string {
  // Try to load custom icons from assets folder
  // Fallback to creating simple colored icons programmatically
  const assetsDir = path.join(__dirname, "..", "..", "assets");

  const fileMap: Record<TrayStatus, string> = {
    connected: "icon-green.ico",
    disconnected: "icon.ico",
    error: "icon-red.ico",
  };

  const filePath = path.join(assetsDir, fileMap[status]);

  try {
    const img = nativeImage.createFromPath(filePath);
    if (!img.isEmpty()) return filePath;
  } catch {
    // Fallback below
  }

  // Fallback: create a simple colored 16x16 icon programmatically
  return createFallbackIcon(status);
}

function createFallbackIcon(status: TrayStatus): string {
  // Create a simple 16x16 PNG with colored circle
  const colors: Record<TrayStatus, [number, number, number]> = {
    connected: [76, 175, 80],    // Green
    disconnected: [158, 158, 158], // Gray
    error: [244, 67, 54],         // Red
  };

  const [r, g, b] = colors[status];

  // Create a minimal 16x16 RGBA buffer
  const size = 16;
  const data = Buffer.alloc(size * size * 4, 0);
  const cx = size / 2;
  const cy = size / 2;
  const radius = 6;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius) {
        const offset = (y * size + x) * 4;
        data[offset] = r;
        data[offset + 1] = g;
        data[offset + 2] = b;
        data[offset + 3] = 255;
      }
    }
  }

  const img = nativeImage.createFromBuffer(data, {
    width: size,
    height: size,
  });

  // nativeImage doesn't have toPNG path, but we can use the nativeImage directly
  // For Tray, we return the nativeImage via a temp path
  const tmpPath = path.join(app.getPath("temp"), `alpha-print-tray-${status}.png`);
  const fs = require("fs");
  fs.writeFileSync(tmpPath, img.toPNG());
  return tmpPath;
}

/**
 * Destroy the tray icon.
 */
export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
