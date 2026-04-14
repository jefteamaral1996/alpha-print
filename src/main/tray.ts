// ============================================================
// Tray — System tray icon and menu for Alpha Print
// ============================================================

import { app, Tray, Menu, nativeImage } from "electron";
import path from "path";
import { existsSync, writeFileSync } from "fs";
import store from "./store";

let tray: Tray | null = null;
let lastPrintTime = "";
// Cache generated icons so we don't recreate them every time
const iconCache = new Map<string, Electron.NativeImage>();

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
  const icon = getTrayIcon("disconnected");
  tray = new Tray(icon);
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

  const icon = getTrayIcon(status);
  tray.setImage(icon);

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

/**
 * Get a nativeImage for the tray icon.
 * Tries asset files first (icon.png, icon-green.png, icon-red.png),
 * then falls back to programmatically generated PNG icons.
 */
function getTrayIcon(status: TrayStatus): Electron.NativeImage {
  // Check cache first
  const cached = iconCache.get(status);
  if (cached) return cached;

  // Try to load from assets folder — use PNG (works on all platforms)
  const assetsDir = path.join(__dirname, "..", "..", "assets");

  const fileMap: Record<TrayStatus, string[]> = {
    connected: ["icon-green.png", "icon-green.ico", "icon.png"],
    disconnected: ["icon.png", "icon.ico"],
    error: ["icon-red.png", "icon-red.ico", "icon.png"],
  };

  for (const fileName of fileMap[status]) {
    const filePath = path.join(assetsDir, fileName);
    try {
      if (existsSync(filePath)) {
        const img = nativeImage.createFromPath(filePath);
        if (!img.isEmpty()) {
          // Resize to 16x16 for tray
          const resized = img.resize({ width: 16, height: 16 });
          iconCache.set(status, resized);
          return resized;
        }
      }
    } catch {
      // Try next file
    }
  }

  // Fallback: generate a minimal PNG programmatically
  const icon = createFallbackIcon(status);
  iconCache.set(status, icon);
  return icon;
}

/**
 * Create a simple 16x16 PNG icon with a colored circle.
 * Uses proper PNG format via nativeImage.
 */
function createFallbackIcon(status: TrayStatus): Electron.NativeImage {
  const colors: Record<TrayStatus, [number, number, number]> = {
    connected: [76, 175, 80],     // Green
    disconnected: [158, 158, 158], // Gray
    error: [244, 67, 54],          // Red
  };

  const [r, g, b] = colors[status];
  const size = 16;

  // Build a minimal valid PNG file manually
  // PNG = signature + IHDR chunk + IDAT chunk (raw pixels) + IEND chunk
  const png = buildMinimalPNG(size, size, r, g, b);

  return nativeImage.createFromBuffer(png, {
    width: size,
    height: size,
  });
}

/**
 * Build a minimal valid PNG buffer with a colored circle on transparent background.
 * This avoids the bug of passing raw RGBA to nativeImage.createFromBuffer
 * (which expects PNG/JPEG format, not raw pixel data).
 */
function buildMinimalPNG(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number
): Buffer {
  const cx = width / 2;
  const cy = height / 2;
  const radius = 6;

  // Build raw image data (filter byte + RGBA for each row)
  // Each row: 1 filter byte (0 = None) + width * 4 bytes (RGBA)
  const rawDataSize = height * (1 + width * 4);
  const rawData = Buffer.alloc(rawDataSize, 0);

  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    rawData[rowStart] = 0; // Filter: None
    for (let x = 0; x < width; x++) {
      const dx = x - cx + 0.5;
      const dy = y - cy + 0.5;
      const offset = rowStart + 1 + x * 4;
      if (dx * dx + dy * dy <= radius * radius) {
        rawData[offset] = r;
        rawData[offset + 1] = g;
        rawData[offset + 2] = b;
        rawData[offset + 3] = 255;
      } else {
        // Transparent
        rawData[offset + 3] = 0;
      }
    }
  }

  // Compress with zlib (deflate)
  const zlib = require("zlib");
  const compressed: Buffer = zlib.deflateSync(rawData);

  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // color type (RGBA)
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = buildPNGChunk("IHDR", ihdrData);

  // IDAT chunk
  const idat = buildPNGChunk("IDAT", compressed);

  // IEND chunk
  const iend = buildPNGChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function buildPNGChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuffer, data]);
  // CRC32 over type + data
  const crc = crc32(body);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc >>> 0, 0);
  return Buffer.concat([length, body, crcBuffer]);
}

// Simple CRC32 implementation for PNG chunks
function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xedb88320;
      } else {
        crc = crc >>> 1;
      }
    }
  }
  return crc ^ 0xffffffff;
}

/**
 * Destroy the tray icon.
 */
export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
  iconCache.clear();
}
