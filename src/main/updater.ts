// ============================================================
// updater.ts — Auto-Update via GitHub Releases
// electron-updater: verifica versao ao iniciar, baixa em
// background silenciosamente, pergunta ao usuario ao concluir.
// Tambem expoe IPC para trigger manual e push de status ao renderer.
// ============================================================

import { autoUpdater } from "electron-updater";
import { dialog, BrowserWindow, ipcMain } from "electron";

export interface UpdaterStatusPayload {
  state:
    | "checking"
    | "available"
    | "not-available"
    | "downloading"
    | "downloaded"
    | "error";
  version?: string;
  percent?: number;
  error?: string;
}

function sendStatus(
  getWindow: () => BrowserWindow | null,
  payload: UpdaterStatusPayload
): void {
  const win = getWindow();
  win?.webContents.send("updater:status", payload);
}

export function initAutoUpdater(
  getWindow: () => BrowserWindow | null
): void {
  // Silencioso durante download — nao incomoda o usuario
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // ── Eventos com push ao renderer ─────────────────────────

  autoUpdater.on("checking-for-update", () => {
    console.log("[Updater] Verificando atualizacoes...");
    sendStatus(getWindow, { state: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    console.log(
      `[Updater] Nova versao disponivel: ${info.version} — baixando em background...`
    );
    sendStatus(getWindow, { state: "available", version: info.version });
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[Updater] App esta atualizado.");
    sendStatus(getWindow, { state: "not-available" });
  });

  autoUpdater.on("error", (err) => {
    console.error(
      "[Updater] Erro ao verificar/baixar atualizacao:",
      err.message
    );
    sendStatus(getWindow, { state: "error", error: err.message });
  });

  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.round(progress.percent);
    console.log(
      `[Updater] Download: ${percent}% (${Math.round(progress.transferred / 1024)}KB / ${Math.round(progress.total / 1024)}KB)`
    );
    sendStatus(getWindow, { state: "downloading", percent });
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log(
      `[Updater] Versao ${info.version} baixada. Perguntando ao usuario...`
    );
    sendStatus(getWindow, { state: "downloaded", version: info.version });

    // Usa a janela focada ou a primeira disponivel
    const win =
      getWindow() ||
      BrowserWindow.getFocusedWindow() ||
      BrowserWindow.getAllWindows()[0];

    const dialogOptions: Electron.MessageBoxOptions = {
      type: "info",
      title: "Atualizacao disponivel",
      message: `Uma nova versao do Alpha Print (${info.version}) foi baixada.`,
      detail:
        "Deseja reiniciar o aplicativo agora para instalar a atualizacao?",
      buttons: ["Reiniciar agora", "Depois"],
      defaultId: 0,
      cancelId: 1,
    };

    const dialogPromise = win
      ? dialog.showMessageBox(win, dialogOptions)
      : dialog.showMessageBox(dialogOptions);

    dialogPromise
      .then(({ response }) => {
        if (response === 0) {
          console.log(
            "[Updater] Usuario escolheu reiniciar agora — instalando..."
          );
          autoUpdater.quitAndInstall(false, true);
        } else {
          console.log(
            "[Updater] Usuario escolheu instalar depois — sera instalado ao fechar o app."
          );
        }
      })
      .catch((err) => {
        console.error("[Updater] Erro ao exibir dialog de update:", err);
      });
  });

  // ── IPC: trigger manual pelo renderer ────────────────────

  ipcMain.handle("updater:checkNow", () => {
    console.log("[Updater] Verificacao manual solicitada pelo usuario.");
    autoUpdater.checkForUpdates().catch((err) => {
      console.error("[Updater] checkForUpdates manual falhou:", err.message);
      sendStatus(getWindow, { state: "error", error: err.message });
    });
    return { triggered: true };
  });

  // ── Check automatico ao iniciar (delay 3s) ───────────────

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error("[Updater] checkForUpdates falhou:", err.message);
    });
  }, 3000);
}
